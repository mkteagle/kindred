import Foundation
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
            if records[key]?.state == .succeeded { continue }
            let record = UploadQueueRecord(
                id: key,
                requestID: records[key]?.requestID ?? UUID().uuidString,
                accountID: accountID,
                localIdentifier: localIdentifier,
                state: .pending,
                attempts: records[key]?.attempts ?? 0,
                lastError: records[key]?.lastError,
                flickrPhotoID: records[key]?.flickrPhotoID,
                kindredPhotoID: records[key]?.kindredPhotoID,
                updatedAt: Date()
            )
            records[key] = record
            persistedAll = persist(record) && persistedAll
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

    func resumableIdentifiers(accountID: String, activeIdentifiers: Set<String>) -> [String] {
        records.values
            .filter { record in
                guard record.accountID == accountID else { return false }
                switch record.state {
                case .pending, .preparing, .failed:
                    return true
                case .uploading:
                    return !activeIdentifiers.contains(record.localIdentifier)
                case .succeeded:
                    return false
                }
            }
            .sorted { $0.updatedAt < $1.updatedAt }
            .map(\.localIdentifier)
    }

    func requestID(for localIdentifier: String, accountID: String) -> String? {
        records[Self.key(localIdentifier, accountID: accountID)]?.requestID
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
        records[key] = record
        return persist(record)
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

    static let empty = UploadSummary(succeededIdentifiers: [], failedIdentifiers: [])
}

/// Serial, durable upload coordinator used by manual backup and auto-sync.
/// Originals and multipart request bodies are staged on disk, keeping memory
/// bounded even for large iCloud videos.
@MainActor
@Observable
final class FlickrUploader {
    static let shared = FlickrUploader()
    private static let resumableThreshold: Int64 = 50 * 1024 * 1024
    private static let resumableChunkSize = 8 * 1024 * 1024

    private(set) var isUploading = false
    private(set) var currentProgress: Float = 0
    private(set) var totalProgress: Float = 0
    private(set) var uploadedCount = 0
    private(set) var failedCount = 0
    private(set) var totalCount = 0
    private(set) var currentAssetTitle = ""
    private(set) var lastError: String?

    private init() {}

    func uploadAssets(_ assets: [PHAsset]) async -> UploadSummary {
        guard !isUploading else {
            lastError = "A backup is already running."
            return .empty
        }
        guard SyncManager.shared.canUploadNow else {
            lastError = "Waiting for Wi-Fi. Turn off \u{201c}Only on Wi-Fi\u{201d} in Settings to back up over cellular."
            return .empty
        }
        guard SessionManager.shared.isAuthenticated,
              let accountID = SessionManager.shared.currentUser?.id else {
            lastError = "Your session expired. Please sign in again."
            return UploadSummary(
                succeededIdentifiers: [],
                failedIdentifiers: Set(assets.map(\.localIdentifier))
            )
        }

        let activeIdentifiers = await BackgroundUploadSession.shared.activeLocalIdentifiers()
        let toUpload = assets.filter {
            !PhotoLibraryManager.shared.isUploaded(localIdentifier: $0.localIdentifier)
                && !activeIdentifiers.contains($0.localIdentifier)
        }
        guard !toUpload.isEmpty else { return .empty }

        isUploading = true
        totalCount = toUpload.count
        uploadedCount = 0
        failedCount = 0
        currentProgress = 0
        totalProgress = 0
        currentAssetTitle = "Preparing backup"
        lastError = nil
        defer {
            isUploading = false
            currentAssetTitle = ""
        }

        let queuePersisted = await UploadQueueStore.shared.enqueue(
            toUpload.map(\.localIdentifier),
            accountID: accountID
        )
        guard queuePersisted else {
            lastError = UploadError.queuePersistenceFailed.localizedDescription
            return UploadSummary(
                succeededIdentifiers: [],
                failedIdentifiers: Set(toUpload.map(\.localIdentifier))
            )
        }

        var succeeded = Set<String>()
        var failed = Set<String>()

        for (index, asset) in toUpload.enumerated() {
            if Task.isCancelled { break }

            let mediaLabel = asset.mediaType == .video ? "Video" : "Photo"
            currentAssetTitle = "\(mediaLabel) \(index + 1) of \(toUpload.count)"

            do {
                guard let requestID = await UploadQueueStore.shared.requestID(
                    for: asset.localIdentifier,
                    accountID: accountID
                ) else {
                    throw UploadError.cannotStageUpload
                }
                let receipt = try await uploadWithRetry(
                    asset,
                    accountID: accountID,
                    requestID: requestID
                )
                PhotoLibraryManager.shared.markAsUploaded(
                    localIdentifier: asset.localIdentifier,
                    flickrPhotoId: receipt.photo_id,
                    kindredPhotoId: receipt.kindred_photo_id,
                    nasStatus: receipt.nas_status,
                    flickrStatus: receipt.flickr_status
                )
                await UploadQueueStore.shared.markSucceeded(
                    asset.localIdentifier,
                    accountID: accountID,
                    receipt: receipt
                )
                succeeded.insert(asset.localIdentifier)
                uploadedCount += 1
            } catch {
                let message = error.localizedDescription
                await UploadQueueStore.shared.markFailed(
                    asset.localIdentifier,
                    accountID: accountID,
                    error: message
                )
                failed.insert(asset.localIdentifier)
                failedCount += 1
                lastError = "\(failedCount) item\(failedCount == 1 ? "" : "s") failed. \(message)"
            }

            let completed = uploadedCount + failedCount
            totalProgress = Float(completed) / Float(totalCount)
            currentProgress = 1
        }

        return UploadSummary(
            succeededIdentifiers: succeeded,
            failedIdentifiers: failed
        )
    }

    /// Resumes queue entries left pending or failed after a previous launch.
    func resumeQueuedUploads() async -> UploadSummary {
        guard !isUploading,
              SessionManager.shared.isAuthenticated,
              let accountID = SessionManager.shared.currentUser?.id else {
            return .empty
        }

        Self.cleanupAbandonedStagingFiles()

        let active = await BackgroundUploadSession.shared.activeLocalIdentifiers()
        let identifiers = await UploadQueueStore.shared.resumableIdentifiers(
            accountID: accountID,
            activeIdentifiers: active
        )
        guard !identifiers.isEmpty else { return .empty }

        let result = PHAsset.fetchAssets(withLocalIdentifiers: identifiers, options: nil)
        var assets: [PHAsset] = []
        result.enumerateObjects { asset, _, _ in assets.append(asset) }
        return await uploadAssets(assets)
    }

    private func uploadWithRetry(
        _ asset: PHAsset,
        accountID: String,
        requestID: String
    ) async throws -> UploadReceipt {
        var mostRecentError: Error = BackgroundUploadError.invalidResponse

        for attempt in 1...3 {
            do {
                guard await UploadQueueStore.shared.markPreparing(
                    asset.localIdentifier,
                    accountID: accountID
                ) else {
                    throw UploadError.queuePersistenceFailed
                }
                currentProgress = 0
                return try await uploadAsset(
                    asset,
                    accountID: accountID,
                    requestID: requestID
                )
            } catch {
                mostRecentError = error
                let retryable = Self.isRetryable(error)
                if !retryable || attempt == 3 || Task.isCancelled { throw error }
                try? await Task.sleep(for: .seconds(attempt == 1 ? 2 : 5))
            }
        }
        throw mostRecentError
    }

    private func uploadAsset(
        _ asset: PHAsset,
        accountID: String,
        requestID: String
    ) async throws -> UploadReceipt {
        let staged = try await stageOriginalAsset(asset)
        defer { try? FileManager.default.removeItem(at: staged.url) }

        let title = asset.creationDate.map(Self.formatDate) ?? staged.filename
        let resourceValues = try staged.url.resourceValues(forKeys: [.fileSizeKey])
        guard let fileSize = resourceValues.fileSize, fileSize > 0 else {
            throw UploadError.cannotStageUpload
        }

        guard await UploadQueueStore.shared.markUploading(
            asset.localIdentifier,
            accountID: accountID
        ) else {
            throw UploadError.queuePersistenceFailed
        }

        if Int64(fileSize) > Self.resumableThreshold {
            return try await uploadResumable(
                staged,
                fileSize: Int64(fileSize),
                title: title,
                requestID: requestID,
                creationDate: asset.creationDate,
                location: asset.location
            )
        }

        let bodyFile = try Self.makeMultipartBody(
            sourceURL: staged.url,
            filename: staged.filename,
            contentType: staged.contentType,
            title: title,
            requestID: requestID,
            creationDate: asset.creationDate,
            location: asset.location
        )

        let baseURL = await APIClient.shared.currentBaseURL()
        guard let url = URL(string: "\(baseURL)/photos/upload") else {
            try? FileManager.default.removeItem(at: bodyFile.url)
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 60 * 30
        request.setValue(
            "multipart/form-data; boundary=\(bodyFile.boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        if let token = await APIClient.shared.currentSessionToken() {
            request.setValue(token, forHTTPHeaderField: "X-Session-Token")
        }

        return try await BackgroundUploadSession.shared.upload(
            request: request,
            bodyFileURL: bodyFile.url,
            localIdentifier: asset.localIdentifier,
            filename: staged.filename,
            accountID: accountID
        )
    }

    private func uploadResumable(
        _ staged: StagedAsset,
        fileSize: Int64,
        title: String,
        requestID: String,
        creationDate: Date?,
        location: CLLocation?
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
        var state = try await APIClient.shared.startResumableUpload(upload)
        if let receipt = state.receipt { return receipt }
        guard state.next_offset >= 0, state.next_offset <= fileSize else {
            throw UploadError.invalidServerOffset
        }

        if state.next_offset < fileSize {
            let source = try FileHandle(forReadingFrom: staged.url)
            defer { try? source.close() }
            try source.seek(toOffset: UInt64(state.next_offset))

            var offset = state.next_offset
            while offset < fileSize {
                try Task.checkCancellation()
                let remaining = fileSize - offset
                let amount = min(Self.resumableChunkSize, Int(remaining))
                guard let chunk = try source.read(upToCount: amount), !chunk.isEmpty else {
                    throw UploadError.cannotStageUpload
                }
                state = try await APIClient.shared.uploadResumableChunk(
                    uploadID: state.upload_id,
                    offset: offset,
                    data: chunk
                )
                guard state.next_offset == offset + Int64(chunk.count) else {
                    throw UploadError.invalidServerOffset
                }
                offset = state.next_offset
                currentProgress = min(0.9, 0.9 * Float(offset) / Float(fileSize))
            }
        }

        if state.status != "finalizing" && state.status != "completed" {
            state = try await APIClient.shared.completeResumableUpload(
                uploadID: state.upload_id
            )
        }

        // Flickr mirroring happens server-side after a quick acknowledgement,
        // avoiding Cloudflare's origin response timeout for large videos.
        for _ in 0..<360 {
            try Task.checkCancellation()
            if let receipt = state.receipt {
                currentProgress = 1
                return receipt
            }
            if state.status == "ready" {
                state = try await APIClient.shared.completeResumableUpload(
                    uploadID: state.upload_id
                )
            } else {
                currentProgress = 0.95
                try await Task.sleep(for: .seconds(5))
                state = try await APIClient.shared.startResumableUpload(upload)
            }
        }
        throw UploadError.finalizationTimedOut
    }

    private struct StagedAsset {
        let url: URL
        let filename: String
        let contentType: String
    }

    private func stageOriginalAsset(_ asset: PHAsset) async throws -> StagedAsset {
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

    private static func cleanupAbandonedStagingFiles() {
        let cutoff = Date().addingTimeInterval(-7 * 24 * 60 * 60)
        let directories = [
            try? stagingDirectory(),
            FileManager.default.temporaryDirectory
                .appendingPathComponent("kindred_uploads", isDirectory: true),
        ].compactMap { $0 }

        for directory in directories {
            guard let files = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: [.skipsHiddenFiles]
            ) else { continue }
            for file in files {
                let modified = try? file.resourceValues(
                    forKeys: [.contentModificationDateKey]
                ).contentModificationDate
                if let modified, modified < cutoff {
                    try? FileManager.default.removeItem(at: file)
                }
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

    private static func isRetryable(_ error: Error) -> Bool {
        if let uploadError = error as? BackgroundUploadError {
            return uploadError.isRetryable
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cancelled, .badURL, .userAuthenticationRequired,
                 .dataNotAllowed, .fileDoesNotExist:
                return false
            default:
                return true
            }
        }
        if let apiError = error as? APIClient.APIError {
            return apiError.isRetryable
        }
        return false
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
