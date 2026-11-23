import Foundation
import os
import Photos
import UniformTypeIdentifiers

enum UploadQueueState: String, Codable, Sendable {
    case pending
    case preparing
    case uploading
    case failed
    case succeeded
}

struct UploadQueueRecord: Codable, Sendable {
    let id: String
    let requestID: String
    let accountID: String
    let localIdentifier: String
    var state: UploadQueueState
    var attempts: Int
    var lastError: String?
    var flickrPhotoID: String?
    var kindredPhotoID: String?
    var updatedAt: Date
}

/// Durable queue state. Records are account-scoped so switching households
/// cannot make one user's local history look backed up for another user.
actor UploadQueueStore {
    static let shared = UploadQueueStore()

    private let directory: URL
    private var records: [String: UploadQueueRecord] = [:]

    private init() {
        let fileManager = FileManager.default
        let base = (try? fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? fileManager.temporaryDirectory
        directory = base.appendingPathComponent("KindredUploadQueue", isDirectory: true)
        try? fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableDirectory = directory
        try? mutableDirectory.setResourceValues(values)

        let files = (try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )) ?? []
        for file in files where file.pathExtension == "json" {
            guard let data = try? Data(contentsOf: file),
                  let record = try? JSONDecoder().decode(UploadQueueRecord.self, from: data) else {
                continue
            }
            records[record.id] = record
        }
    }

    func enqueue(_ localIdentifiers: [String], accountID: String) -> Bool {
        var persistedAll = true
        for localIdentifier in localIdentifiers {
            let key = Self.key(localIdentifier, accountID: accountID)
            guard records[key] == nil else { continue }
            let record = UploadQueueRecord(
                id: key,
                requestID: UUID().uuidString,
                accountID: accountID,
                localIdentifier: localIdentifier,
                state: .pending,
                attempts: 0,
                lastError: nil,
                flickrPhotoID: nil,
                kindredPhotoID: nil,
                updatedAt: Date()
            )
            if persist(record) {
                records[key] = record
            } else {
                persistedAll = false
            }
        }
        return persistedAll
    }

    func markPreparing(_ localIdentifier: String, accountID: String) -> Bool {
        update(localIdentifier, accountID: accountID) {
            $0.state = .preparing
            $0.attempts += 1
            $0.lastError = nil
        }
    }

    func markUploading(_ localIdentifier: String, accountID: String) -> Bool {
        update(localIdentifier, accountID: accountID) { $0.state = .uploading }
    }

    func markFailed(_ localIdentifier: String, accountID: String, error: String) {
        _ = update(localIdentifier, accountID: accountID) {
            $0.state = .failed
            $0.lastError = error
        }
    }

    func markSucceeded(_ localIdentifier: String, accountID: String, receipt: UploadReceipt) {
        let key = Self.key(localIdentifier, accountID: accountID)
        guard let record = records.removeValue(forKey: key) else { return }
        try? FileManager.default.removeItem(at: recordURL(record))
    }

    func removeAccount(_ accountID: String) {
        for record in activityRecords(accountID: accountID) {
            records.removeValue(forKey: record.id)
            try? FileManager.default.removeItem(at: recordURL(record))
        }
    }

    func resumableIdentifiers(accountID: String, activeIdentifiers: Set<String>) -> [String] {
        activityRecords(accountID: accountID)
            .filter { record in
                switch record.state {
                case .pending, .preparing, .failed:
                    return true
                case .uploading:
                    return !activeIdentifiers.contains(record.localIdentifier)
                case .succeeded:
                    return false
                }
            }
            .map(\.localIdentifier)
    }

    func requestID(for localIdentifier: String, accountID: String) -> String? {
        records[Self.key(localIdentifier, accountID: accountID)]?.requestID
    }

    func activityRecords(accountID: String) -> [UploadQueueRecord] {
        records.values
            .filter { $0.accountID == accountID }
            .sorted { ($0.updatedAt, $0.localIdentifier) < ($1.updatedAt, $1.localIdentifier) }
    }

    private func update(
        _ localIdentifier: String,
        accountID: String,
        mutation: (inout UploadQueueRecord) -> Void
    ) -> Bool {
        let key = Self.key(localIdentifier, accountID: accountID)
        guard var record = records[key] else { return false }
        mutation(&record)
        record.updatedAt = Date()
        guard persist(record) else { return false }
        records[key] = record
        return true
    }

    private func persist(_ record: UploadQueueRecord) -> Bool {
        do {
            let data = try JSONEncoder().encode(record)
            try data.write(
                to: recordURL(record),
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
            return true
        } catch {
            return false
        }
    }

    private func recordURL(_ record: UploadQueueRecord) -> URL {
        directory.appendingPathComponent(record.requestID).appendingPathExtension("json")
    }

    private static func key(_ localIdentifier: String, accountID: String) -> String {
        "\(accountID)|\(localIdentifier)"
    }
}

struct UploadSummary: Sendable {
    let succeededIdentifiers: Set<String>
    let failedIdentifiers: Set<String>
    /// Why nothing was attempted, when that is the reason there are no results.
    ///
    /// "Nothing to upload" and "refused to upload" both produce empty sets, and
    /// conflating them let auto-backup report a successful sync it had not
    /// performed: waiting for Wi-Fi looked identical to being up to date.
    let skippedReason: String?
    let wasCancelled: Bool

    var wasSkipped: Bool { skippedReason != nil }

    init(succeededIdentifiers: Set<String>, failedIdentifiers: Set<String>,
         skippedReason: String? = nil, wasCancelled: Bool = false) {
        self.succeededIdentifiers = succeededIdentifiers
        self.failedIdentifiers = failedIdentifiers
        self.skippedReason = skippedReason
        self.wasCancelled = wasCancelled
    }

    /// Ran, and there was genuinely nothing to do.
    static let empty = UploadSummary(succeededIdentifiers: [], failedIdentifiers: [])

    /// Did not run. Not a success, and not a per-photo failure either.
    static func skipped(_ reason: String) -> UploadSummary {
        UploadSummary(succeededIdentifiers: [], failedIdentifiers: [], skippedReason: reason)
    }
}

struct BackupActivityItem: Identifiable {
    enum Status: String {
        case queued = "Queued"
        case preparing = "Getting original"
        case fetchingICloud = "Downloading from iCloud"
        case uploading = "Uploading"
        case finishing = "Finishing"
        case backedUp = "Backed up"
        case failed = "Needs retry"

        var isActive: Bool {
            switch self {
            case .preparing, .fetchingICloud, .uploading, .finishing: true
            case .queued, .backedUp, .failed: false
            }
        }
    }

    let asset: PHAsset
    var status: Status = .queued
    var error: String?
    var progress: Float = 0
    var id: String { asset.localIdentifier }
    var title: String { asset.mediaType == .video ? "Video" : "Photo" }
}

/// A durable upload queue shared by manual backup and auto-sync.
/// Originals and multipart request bodies are staged on disk, keeping memory
/// bounded even for large iCloud videos.
@MainActor
@Observable
final class FlickrUploader {
    static let shared = FlickrUploader()
    private static let resumableThreshold: Int64 = 50 * 1024 * 1024
    private static let resumableChunkSize = 8 * 1024 * 1024
    // The hosted upload route is an external rewrite to the NAS. A 12 MiB
    // multipart probe reached NAS authentication; allow headroom for the body.
    private static let hostedMultipartThreshold: Int64 = 10 * 1024 * 1024

    private(set) var isUploading = false
    private(set) var totalProgress: Float = 0
    private(set) var uploadedCount = 0
    private(set) var failedCount = 0
    private(set) var totalCount = 0
    private(set) var activeUploadLimit = 1
    private(set) var lastError: String?
    private(set) var activity: [BackupActivityItem] = []
    private(set) var activityAccountID: String?
    private(set) var isPaused = UserDefaults.standard.bool(forKey: "kindred_backup_paused")
    private var runningBackup: Task<UploadSummary, Never>?
    private var activeIndices: Set<Int> = []
    @ObservationIgnored private var didCleanStaging = false

    var currentProgress: Float { activeIndices.min().map { activity[$0].progress } ?? 0 }
    var currentAssetTitle: String {
        guard let index = activeIndices.min() else { return "Preparing backup" }
        if activity[index].status == .fetchingICloud {
            return "Downloading from iCloud · \(index + 1) of \(totalCount)"
        }
        return "\(activity[index].title) \(index + 1) of \(totalCount)"
    }

    private init() {}

    func uploadAssets(_ assets: [PHAsset], userInitiated: Bool = false) async -> UploadSummary {
        guard runningBackup == nil else { return .skipped("A backup is already running.") }
        guard !assets.isEmpty else { return .empty }
        if userInitiated {
            isPaused = false
            UserDefaults.standard.set(false, forKey: "kindred_backup_paused")
            SyncManager.shared.beginContinuedBackup()
        } else if isPaused {
            return .skipped("Backup is paused.")
        }
        let task = Task { await runBackup(assets, userInitiated: userInitiated) }
        runningBackup = task
        defer { runningBackup = nil }
        let result = await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
        if userInitiated {
            SyncManager.shared.finishContinuedBackup(
                success: !result.wasCancelled && !result.wasSkipped && result.failedIdentifiers.isEmpty
            )
            if result.wasCancelled, !isPaused, SessionManager.shared.isAuthenticated {
                SyncManager.shared.scheduleBackgroundSync(after: 0)
            }
        }
        return result
    }

    func pauseBackup() {
        isPaused = true
        UserDefaults.standard.set(true, forKey: "kindred_backup_paused")
        runningBackup?.cancel()
        if let accountID = SessionManager.shared.currentUser?.id {
            BackgroundUploadSession.shared.cancelUploads(accountID: accountID)
        }
    }

    func suspendBackup() { runningBackup?.cancel() }

    private func runBackup(_ assets: [PHAsset], userInitiated: Bool) async -> UploadSummary {
        guard SyncManager.shared.canUploadNow else {
            lastError = "Waiting for Wi-Fi. Turn off \u{201c}Only on Wi-Fi\u{201d} in Settings to back up over cellular."
            if !assets.isEmpty { Analytics.backupDiagnostic(.preflight, failure: .init(.wifiRequired, retryable: true)) }
            return .skipped(lastError!)
        }
        // Skipped, not failed. Marking every asset failed here told iOS the
        // background task had failed on every run, and it responds by
        // scheduling the next one less often -- so an expired session quietly
        // made auto-backup rarer and rarer instead of waiting for a sign-in.
        guard SessionManager.shared.isAuthenticated,
              let accountID = SessionManager.shared.currentUser?.id else {
            lastError = "Your session expired. Please sign in again."
            if !assets.isEmpty { Analytics.backupDiagnostic(.preflight, failure: .init(.signInRequired)) }
            return .skipped(lastError!)
        }

        await cleanupAbandonedStagingFiles()
        let activeIdentifiers = await BackgroundUploadSession.shared.activeLocalIdentifiers(accountID: accountID)
        let toUpload = assets.filter {
            !PhotoLibraryManager.shared.isUploaded(localIdentifier: $0.localIdentifier)
                && !activeIdentifiers.contains($0.localIdentifier)
        }
        guard !toUpload.isEmpty else { return .empty }

        isUploading = true
        totalCount = toUpload.count
        uploadedCount = 0
        failedCount = 0
        totalProgress = 0
        lastError = nil
        activityAccountID = accountID
        activity = toUpload.map { BackupActivityItem(asset: $0) }
        defer {
            isUploading = false
            activeIndices.removeAll()
        }

        let queuedAt = ContinuousClock.now
        let queuePersisted = await UploadQueueStore.shared.enqueue(
            toUpload.map(\.localIdentifier),
            accountID: accountID
        )
        guard queuePersisted else {
            lastError = UploadError.queuePersistenceFailed.localizedDescription
            Analytics.backupDiagnostic(.queue, failure: .init(.queueWriteFailed))
            return UploadSummary(
                succeededIdentifiers: [],
                failedIdentifiers: Set(toUpload.map(\.localIdentifier))
            )
        }
        if userInitiated { SyncManager.shared.scheduleBackgroundSync(after: 0) }

        var succeeded = Set<String>()
        var failed = Set<String>()
        await withTaskGroup(of: (BackupItemResult, isVideo: Bool).self) { group in
            let (videoAssets, stillAssets) = toUpload.indices.reduce(into: ([Int](), [Int]())) { indices, index in
                if toUpload[index].mediaType == .video { indices.0.append(index) }
                else { indices.1.append(index) }
            }
            var videos = videoAssets[...]
            var stills = stillAssets[...]
            var runningCount = 0
            var runningVideos = 0
            var stillsSinceVideo = 0
            var nasLimit = 1
            var nextCapacityCheck = ContinuousClock.now
            var detachedUploads = activeIdentifiers
            while true {
                if !stills.isEmpty || !videos.isEmpty,
                   SessionManager.shared.currentUser?.id == accountID,
                   !Task.isCancelled {
                    if ContinuousClock.now >= nextCapacityCheck {
                        nasLimit = (try? await APIClient.shared.backupUploadCapacity()) ?? 1
                        nextCapacityCheck = .now + .seconds(15)
                    }
                    activeUploadLimit = min(nasLimit, SyncManager.shared.uploadLimit)
                    if !detachedUploads.isEmpty {
                        detachedUploads.formIntersection(
                            await BackgroundUploadSession.shared.activeLocalIdentifiers(accountID: accountID)
                        )
                    }
                    while runningCount + detachedUploads.count < activeUploadLimit,
                          !stills.isEmpty || !videos.isEmpty,
                          !Task.isCancelled, SessionManager.shared.currentUser?.id == accountID {
                        // Keep a slot available for photos while a long video is moving.
                        // With a single lane, give videos a turn after a short run of photos.
                        let isVideo = stills.isEmpty || (!videos.isEmpty && runningVideos == 0 &&
                            (activeUploadLimit > 1 || stillsSinceVideo >= 8))
                        let index = isVideo ? videos.removeFirst() : stills.removeFirst()
                        if isVideo {
                            runningVideos += 1
                            stillsSinceVideo = 0
                        } else {
                            stillsSinceVideo += 1
                        }
                        runningCount += 1
                        group.addTask {
                            let result = await self.backUpItem(toUpload[index], index: index, accountID: accountID, queuedAt: queuedAt)
                            return (result, isVideo)
                        }
                    }
                }
                guard let (result, isVideo) = await group.next() else {
                    guard !detachedUploads.isEmpty, !stills.isEmpty || !videos.isEmpty,
                          !Task.isCancelled, SessionManager.shared.currentUser?.id == accountID else { break }
                    try? await Task.sleep(for: .seconds(1))
                    continue
                }
                runningCount -= 1
                if isVideo { runningVideos -= 1 }
                switch result {
                case let .backedUp(identifier): succeeded.insert(identifier)
                case let .failed(identifier): failed.insert(identifier)
                case .interrupted: break
                }
            }
        }
        let interrupted = Task.isCancelled || SessionManager.shared.currentUser?.id != accountID
        if interrupted {
            lastError = isPaused ? "Backup paused." : "Backup will continue when the iPhone can resume it."
        }
        return UploadSummary(succeededIdentifiers: succeeded, failedIdentifiers: failed, wasCancelled: interrupted)
    }

    private enum BackupItemResult: Sendable {
        case backedUp(String)
        case failed(String)
        case interrupted
    }

    private func backUpItem(
        _ asset: PHAsset, index: Int, accountID: String, queuedAt: ContinuousClock.Instant
    ) async -> BackupItemResult {
        guard !Task.isCancelled, SessionManager.shared.currentUser?.id == accountID else { return .interrupted }
        let queueWait = queuedAt.duration(to: .now)
        activeIndices.insert(index)
        activity[index].status = .uploading
        defer {
            activeIndices.remove(index)
            updateProgress()
        }

        do {
            guard let requestID = await UploadQueueStore.shared.requestID(for: asset.localIdentifier, accountID: accountID) else {
                Analytics.backupDiagnostic(.queue, failure: .init(.queueWriteFailed))
                throw UploadError.queuePersistenceFailed
            }
            let receipt = try await uploadWithRetry(
                asset, index: index, accountID: accountID, requestID: requestID, queueWait: queueWait
            )
            PhotoLibraryManager.shared.markAsUploaded(
                localIdentifier: asset.localIdentifier,
                flickrPhotoId: receipt.photo_id,
                kindredPhotoId: receipt.kindred_photo_id,
                nasStatus: receipt.nas_status,
                flickrStatus: receipt.flickr_status,
                accountID: accountID
            )
            await UploadQueueStore.shared.markSucceeded(asset.localIdentifier, accountID: accountID, receipt: receipt)
            uploadedCount += 1
            activity[index].status = .backedUp
            activity[index].progress = 1
            return .backedUp(asset.localIdentifier)
        } catch {
            if Task.isCancelled || error is CancellationError {
                activity[index].status = .queued
                return .interrupted
            }
            let message = error.localizedDescription
            await UploadQueueStore.shared.markFailed(asset.localIdentifier, accountID: accountID, error: message)
            failedCount += 1
            lastError = "\(failedCount) item\(failedCount == 1 ? "" : "s") failed. \(message)"
            activity[index].status = .failed
            activity[index].error = message
            return .failed(asset.localIdentifier)
        }
    }

    private func updateProgress() {
        let inProgress = activeIndices.reduce(Float(0)) { $0 + activity[$1].progress }
        totalProgress = (Float(uploadedCount + failedCount) + inProgress) / Float(max(1, totalCount))
        SyncManager.shared.updateContinuedBackupProgress(totalProgress)
    }

    /// Resumes queue entries left pending or failed after a previous launch.
    func resumeQueuedUploads() async -> UploadSummary {
        guard runningBackup == nil,
              !isPaused,
              !SessionManager.shared.isReadOnlyReview,
              SessionManager.shared.isAuthenticated,
              let accountID = SessionManager.shared.currentUser?.id else {
            return .empty
        }

        await cleanupAbandonedStagingFiles()

        let active = await BackgroundUploadSession.shared.activeLocalIdentifiers(accountID: accountID)
        let identifiers = await UploadQueueStore.shared.resumableIdentifiers(
            accountID: accountID,
            activeIdentifiers: active
        )
        guard !identifiers.isEmpty else { return .empty }

        let result = PHAsset.fetchAssets(withLocalIdentifiers: identifiers, options: nil)
        var assetsByID: [String: PHAsset] = [:]
        result.enumerateObjects { asset, _, _ in assetsByID[asset.localIdentifier] = asset }
        return await uploadAssets(identifiers.compactMap { assetsByID[$0] })
    }

    private func uploadWithRetry(
        _ asset: PHAsset,
        index: Int,
        accountID: String,
        requestID: String,
        queueWait: Duration
    ) async throws -> UploadReceipt {
        var mostRecentError: Error = BackgroundUploadError.invalidResponse
        var staged: StagedAsset?
        defer {
            if let staged { try? FileManager.default.removeItem(at: staged.url) }
        }

        for attempt in 1...3 {
            if attempt > 1 {
                try await Task.sleep(for: .seconds(attempt == 2 ? 2 : 5))
            }
            let attemptID = UUID()
            var stage = Analytics.BackupStage.queue
            var timing = Analytics.BackupTiming()
            var failure: Analytics.BackupFailure?
            defer {
                timing.record(
                    attemptID: attemptID, attemptNumber: attempt, queueWait: attempt == 1 ? queueWait : nil,
                    isVideo: asset.mediaType == .video, stage: stage, failure: failure
                )
            }
            do {
                try Task.checkCancellation()
                guard SessionManager.shared.currentUser?.id == accountID else { throw CancellationError() }
                guard await UploadQueueStore.shared.markPreparing(
                    asset.localIdentifier,
                    accountID: accountID
                ) else {
                    throw UploadError.queuePersistenceFailed
                }
                activity[index].progress = 0
                activity[index].status = .uploading
                updateProgress()
                let original: StagedAsset
                if let staged {
                    original = staged
                } else {
                    stage = .staging
                    timing.begin(.staging)
                    activity[index].status = .preparing
                    original = try await stageOriginalAsset(asset, index: index, timing: &timing)
                    staged = original
                }
                activity[index].status = .uploading
                let receipt = try await uploadAsset(
                    asset,
                    staged: original,
                    index: index,
                    accountID: accountID,
                    requestID: requestID,
                    attemptID: attemptID,
                    stage: &stage,
                    timing: &timing
                )
                stage = .receipt
                guard receipt.hasNASOriginal else { throw BackgroundUploadError.nasOriginalUnconfirmed }
                return receipt
            } catch {
                mostRecentError = error
                let diagnosed = Analytics.BackupFailure(error)
                failure = diagnosed
                Analytics.backupDiagnostic(stage, failure: diagnosed, attemptID: attemptID)
                if !diagnosed.retryable || attempt == 3 || Task.isCancelled || error is CancellationError { throw error }
            }
        }
        throw mostRecentError
    }

    private func uploadAsset(
        _ asset: PHAsset,
        staged: StagedAsset,
        index: Int,
        accountID: String,
        requestID: String,
        attemptID: UUID,
        stage: inout Analytics.BackupStage,
        timing: inout Analytics.BackupTiming
    ) async throws -> UploadReceipt {
        try Task.checkCancellation()
        guard SessionManager.shared.currentUser?.id == accountID else { throw CancellationError() }

        let title = asset.creationDate.map(Self.formatDate) ?? staged.filename
        let resourceValues = try staged.url.resourceValues(forKeys: [.fileSizeKey])
        guard let fileSize = resourceValues.fileSize, fileSize > 0 else {
            throw UploadError.cannotStageUpload
        }
        timing.bytes = fileSize

        stage = .queue
        timing.begin(.setup)
        guard await UploadQueueStore.shared.markUploading(
            asset.localIdentifier,
            accountID: accountID
        ) else {
            throw UploadError.queuePersistenceFailed
        }

        let baseURL = await APIClient.shared.currentBaseURL()
        let hostedGateway = URL(string: baseURL)?.host == "api.kindredphotos.app"
        let multipartThreshold = hostedGateway ? Self.hostedMultipartThreshold : Self.resumableThreshold
        if Int64(fileSize) > multipartThreshold {
            return try await uploadResumable(
                staged,
                index: index,
                accountID: accountID,
                fileSize: Int64(fileSize),
                hostedGateway: hostedGateway,
                title: title,
                requestID: requestID,
                attemptID: attemptID,
                creationDate: asset.creationDate,
                location: asset.location,
                stage: &stage,
                timing: &timing
            )
        }

        stage = .staging
        timing.begin(.staging)
        let bodyFile = try Self.makeMultipartBody(
            sourceURL: staged.url,
            filename: staged.filename,
            contentType: staged.contentType,
            title: title,
            requestID: requestID,
            creationDate: asset.creationDate,
            location: asset.location
        )

        stage = .multipart
        timing.begin(.transfer)
        guard let url = URL(string: "\(baseURL)/photos/upload") else {
            try? FileManager.default.removeItem(at: bodyFile.url)
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.allowsCellularAccess = !SyncManager.shared.wifiOnly
        request.setValue(
            "multipart/form-data; boundary=\(bodyFile.boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        if let token = await APIClient.shared.currentSessionToken() {
            request.setValue(token, forHTTPHeaderField: "X-Session-Token")
        }

        do {
            return try await BackgroundUploadSession.shared.upload(
                request: request,
                bodyFileURL: bodyFile.url,
                localIdentifier: asset.localIdentifier,
                filename: staged.filename,
                accountID: accountID,
                attemptID: attemptID
            ) { [weak self, identifier = asset.localIdentifier] fraction in
                Task { @MainActor in
                    guard let self, self.activityAccountID == accountID,
                          self.activity.indices.contains(index), self.activity[index].id == identifier,
                          self.activity[index].status == .uploading else { return }
                    self.activity[index].progress = max(self.activity[index].progress, 0.95 * fraction)
                    if fraction >= 1 { self.activity[index].status = .finishing }
                    self.updateProgress()
                }
            }
        } catch BackgroundUploadError.http(status: 413, message: _) {
            return try await uploadResumable(
                staged, index: index, accountID: accountID, fileSize: Int64(fileSize),
                hostedGateway: hostedGateway, title: title, requestID: requestID, attemptID: attemptID,
                creationDate: asset.creationDate, location: asset.location, stage: &stage, timing: &timing
            )
        }
    }

    private func uploadResumable(
        _ staged: StagedAsset,
        index: Int,
        accountID: String,
        fileSize: Int64,
        hostedGateway: Bool,
        title: String,
        requestID: String,
        attemptID: UUID,
        creationDate: Date?,
        location: CLLocation?,
        stage: inout Analytics.BackupStage,
        timing: inout Analytics.BackupTiming
    ) async throws -> UploadReceipt {
        let upload = APIClient.ResumableUploadRequest(
            client_upload_id: requestID,
            filename: staged.filename,
            content_type: staged.contentType,
            byte_size: fileSize,
            title: title,
            description: "",
            taken_at_unix: creationDate.map { Int64($0.timeIntervalSince1970) },
            latitude: location?.coordinate.latitude,
            longitude: location?.coordinate.longitude
        )
        stage = .resumableStart
        var state = try await APIClient.shared.startResumableUpload(upload)
        if let receipt = state.receipt { return receipt }
        guard state.next_offset >= 0, state.next_offset <= fileSize else {
            throw UploadError.invalidServerOffset
        }

        if state.next_offset < fileSize {
            stage = .resumableChunk
            timing.begin(.transfer)
            let source = try FileHandle(forReadingFrom: staged.url)
            defer { try? source.close() }
            try source.seek(toOffset: UInt64(state.next_offset))

            var offset = state.next_offset
            while offset < fileSize {
                try Task.checkCancellation()
                guard SessionManager.shared.currentUser?.id == accountID else { throw CancellationError() }
                let remaining = fileSize - offset
                let amount = min(Self.resumableChunkSize, Int(remaining))
                guard let chunk = try source.read(upToCount: amount), !chunk.isEmpty else {
                    throw UploadError.cannotStageUpload
                }
                let request = try await APIClient.shared.resumableChunkRequest(
                    uploadID: state.upload_id, offset: offset,
                    finalize: offset + Int64(chunk.count) == fileSize,
                    allowsCellularAccess: !SyncManager.shared.wifiOnly
                )
                try Task.checkCancellation()
                let body = try Self.stagingDirectory().appendingPathComponent("\(UUID().uuidString).chunk")
                try chunk.write(to: body, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                let response = try await BackgroundUploadSession.shared.uploadChunk(
                    request: request, bodyFileURL: body,
                    localIdentifier: activity[index].id, filename: staged.filename,
                    accountID: accountID, attemptID: attemptID
                )
                state = try JSONDecoder().decode(APIClient.ResumableUploadResponse.self, from: response)
                guard state.next_offset == offset + Int64(chunk.count) else {
                    throw UploadError.invalidServerOffset
                }
                offset = state.next_offset
                activity[index].progress = min(0.9, 0.9 * Float(offset) / Float(fileSize))
                updateProgress()
            }
        }

        timing.begin(.finalize)
        if state.status != "finalizing" && state.status != "completed" {
            try Task.checkCancellation()
            stage = .resumableComplete
            state = try await APIClient.shared.completeResumableUpload(
                uploadID: state.upload_id
            )
        }

        activity[index].status = .finishing
        let deadline = ContinuousClock.now + .seconds(hostedGateway ? 120 : 1800)
        var pollDelay = hostedGateway ? 1 : 5
        while true {
            try Task.checkCancellation()
            guard SessionManager.shared.currentUser?.id == accountID else { throw CancellationError() }
            if let receipt = state.receipt { return receipt }
            guard ContinuousClock.now < deadline else { throw UploadError.finalizationTimedOut }
            if state.status == "ready" {
                stage = .resumableComplete
                state = try await APIClient.shared.completeResumableUpload(
                    uploadID: state.upload_id
                )
            } else {
                stage = .resumablePoll
                activity[index].progress = 0.95
                updateProgress()
                try await Task.sleep(for: .seconds(pollDelay))
                pollDelay = min(pollDelay * 2, 8)
                state = try await APIClient.shared.startResumableUpload(upload)
            }
        }
    }

    private struct StagedAsset {
        let url: URL
        let filename: String
        let contentType: String
    }

    private func stageOriginalAsset(
        _ asset: PHAsset, index: Int, timing: inout Analytics.BackupTiming
    ) async throws -> StagedAsset {
        let resources = PHAssetResource.assetResources(for: asset)
        let resource: PHAssetResource?
        if asset.mediaType == .video {
            resource = resources.first(where: { $0.type == .video })
                ?? resources.first(where: { $0.type == .fullSizeVideo })
                ?? resources.first
        } else {
            resource = resources.first(where: { $0.type == .photo })
                ?? resources.first(where: { $0.type == .fullSizePhoto })
                ?? resources.first
        }
        guard let resource else { throw UploadError.noAssetData }

        let filename = Self.safeFilename(resource.originalFilename)
        let url = try Self.stagingDirectory()
            .appendingPathComponent("\(UUID().uuidString)-\(filename)")
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        let firstCloudProgress = OSAllocatedUnfairLock<ContinuousClock.Instant?>(initialState: nil)
        let identifier = asset.localIdentifier
        options.progressHandler = { [weak self] _ in
            let started = firstCloudProgress.withLock { first in
                guard first == nil else { return false }
                first = .now
                return true
            }
            guard started else { return }
            Task { @MainActor in
                guard let self, self.activity.indices.contains(index),
                      self.activity[index].id == identifier,
                      self.activity[index].status == .preparing else { return }
                self.activity[index].status = .fetchingICloud
            }
        }
        defer {
            timing.iCloudFetch = firstCloudProgress.withLock { $0?.duration(to: .now) }
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHAssetResourceManager.default().writeData(
                for: resource,
                toFile: url,
                options: options
            ) { error in
                if let error {
                    try? FileManager.default.removeItem(at: url)
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }

        let contentType = UTType(resource.uniformTypeIdentifier)?.preferredMIMEType
            ?? Self.mimeTypeFromFilename(filename)
        return StagedAsset(url: url, filename: filename, contentType: contentType)
    }

    private static func makeMultipartBody(
        sourceURL: URL,
        filename: String,
        contentType: String,
        title: String,
        requestID: String,
        creationDate: Date?,
        location: CLLocation?
    ) throws -> (url: URL, boundary: String) {
        let boundary = "Boundary-\(UUID().uuidString)"
        let outputURL = try stagingDirectory()
            .appendingPathComponent("\(UUID().uuidString).multipart")
        guard FileManager.default.createFile(atPath: outputURL.path, contents: nil) else {
            throw UploadError.cannotStageUpload
        }

        let output = try FileHandle(forWritingTo: outputURL)
        do {
            func write(_ value: String) throws {
                try output.write(contentsOf: Data(value.utf8))
            }
            func field(_ name: String, _ value: String) throws {
                try write("--\(boundary)\r\n")
                try write("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
                try write("\(value)\r\n")
            }

            try field("title", title)
            try field("description", "")
            try field("client_upload_id", requestID)
            if let creationDate {
                try field("taken_at_unix", String(Int(creationDate.timeIntervalSince1970)))
            }
            if let location {
                try field("latitude", String(location.coordinate.latitude))
                try field("longitude", String(location.coordinate.longitude))
            }
            try write("--\(boundary)\r\n")
            try write("Content-Disposition: form-data; name=\"photo\"; filename=\"\(safeFilename(filename))\"\r\n")
            try write("Content-Type: \(contentType)\r\n\r\n")

            let source = try FileHandle(forReadingFrom: sourceURL)
            defer { try? source.close() }
            while let chunk = try source.read(upToCount: 1024 * 1024), !chunk.isEmpty {
                try output.write(contentsOf: chunk)
            }
            try write("\r\n--\(boundary)--\r\n")
            try output.close()
            return (outputURL, boundary)
        } catch {
            try? output.close()
            try? FileManager.default.removeItem(at: outputURL)
            throw error
        }
    }

    private static func stagingDirectory() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appendingPathComponent("KindredUploads", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableDirectory = directory
        try mutableDirectory.setResourceValues(values)
        return directory
    }

    func cleanupAbandonedStagingFiles() async {
        guard !didCleanStaging else { return }
        let activeBodies = await BackgroundUploadSession.shared.activeBodyPaths()
        guard !didCleanStaging else { return }
        didCleanStaging = true
        let directories = [
            try? Self.stagingDirectory(),
            FileManager.default.temporaryDirectory
                .appendingPathComponent("kindred_uploads", isDirectory: true),
        ].compactMap { $0 }

        for directory in directories {
            guard let files = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            ) else { continue }
            for file in files where !activeBodies.contains(file.path) {
                try? FileManager.default.removeItem(at: file)
            }
        }
    }

    private static func safeFilename(_ filename: String) -> String {
        let component = URL(fileURLWithPath: filename).lastPathComponent
        return component
            .replacingOccurrences(of: "\r", with: "_")
            .replacingOccurrences(of: "\n", with: "_")
            .replacingOccurrences(of: "\"", with: "_")
    }

    private static func mimeTypeFromFilename(_ filename: String) -> String {
        switch (filename as NSString).pathExtension.lowercased() {
        case "heic", "heif": return "image/heic"
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "mov": return "video/quicktime"
        case "mp4", "m4v": return "video/mp4"
        default: return "application/octet-stream"
        }
    }

    private static func formatDate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        return formatter.string(from: date)
    }

    enum UploadError: LocalizedError, Equatable {
        case noAssetData
        case cannotStageUpload
        case queuePersistenceFailed
        case invalidServerOffset
        case finalizationTimedOut

        var errorDescription: String? {
            switch self {
            case .noAssetData: return "Could not load the original item from Photos."
            case .cannotStageUpload: return "Could not prepare the item for background upload."
            case .queuePersistenceFailed:
                return "Could not save the upload queue. Check available device storage and try again."
            case .invalidServerOffset:
                return "The server returned an invalid upload position. The original was not deleted."
            case .finalizationTimedOut:
                return "The NAS is still finishing this upload. Kindred will check it again later."
            }
        }
    }
}
