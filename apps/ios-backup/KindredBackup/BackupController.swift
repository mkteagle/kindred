import Foundation
import Photos
import BackgroundTasks
import Network
import UIKit

@Observable @MainActor
final class BackupController: NSObject, PHPhotoLibraryChangeObserver {
    static let shared = BackupController()
    static let taskID = "com.kindlingsignal.kindredbackup.sync"
    private(set) var account = BackupKeychain.load()
    private(set) var albums: [DeviceAlbum] = []
    private(set) var records: [BackupRecord] = []
    private(set) var permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    private(set) var busy = false
    private(set) var isWiFi = false
    var message: String?
    var selectedAlbums: Set<String> = []
    var automatic = false
    var wifiOnly = true
    private(set) var paused = false
    private var pumping = false
    private var configured = false
    private var debounce: Task<Void, Never>?
    private var polling: Task<Void, Never>?
    private let monitor = NWPathMonitor()
    private var store: BackupStore { .shared }
    var selectedKey: String { "backup.albums." + (account?.scope ?? "none") }
    var verified: [BackupRecord] { records.filter { $0.phase == .verified } }
    var pending: Int { records.filter { ![BackupPhase.verified,.deleted].contains($0.phase) }.count }
    var backedUpBytes: Int64 { verified.reduce(0) { $0 + $1.bytes } }
    var deviceID: UUID {
        if let value = UserDefaults.standard.string(forKey: "backup.device"), let id = UUID(uuidString: value) { return id }
        let id = UUID(); UserDefaults.standard.set(id.uuidString, forKey: "backup.device"); return id
    }
    override private init() { super.init(); restorePreferences(); refreshRecords() }
    func configure() {
        guard !configured else { return }; configured = true
        _ = BackgroundTransfer.shared
        PHPhotoLibrary.shared().register(self)
        monitor.pathUpdateHandler = { path in
            Task { @MainActor in
                self.isWiFi = path.status == .satisfied && !path.isExpensive && !path.isConstrained && (path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet))
                if !self.paused { await self.pump() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "KindredBackup.network"))
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.taskID, using: nil) { task in
            guard let task = task as? BGProcessingTask else { task.setTaskCompleted(success: false); return }
            Task { @MainActor in
                self.schedule()
                let run = Task { @MainActor in await self.syncNow() }
                task.expirationHandler = { run.cancel() }
                await run.value
                task.setTaskCompleted(success: !run.isCancelled)
            }
        }
        schedule()
    }
    func restorePreferences() {
        selectedAlbums = Set(UserDefaults.standard.stringArray(forKey: selectedKey) ?? [])
        automatic = UserDefaults.standard.bool(forKey: "backup.auto." + (account?.scope ?? "none"))
        wifiOnly = UserDefaults.standard.object(forKey: "backup.wifi") as? Bool ?? true
        paused = UserDefaults.standard.bool(forKey:"backup.paused." + (account?.scope ?? "none"))
    }
    func savePreferences() {
        UserDefaults.standard.set(Array(selectedAlbums), forKey: selectedKey)
        UserDefaults.standard.set(automatic, forKey: "backup.auto." + (account?.scope ?? "none"))
        UserDefaults.standard.set(wifiOnly, forKey: "backup.wifi")
        if automatic { schedule(); Task { await syncNow() } }
        else { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskID) }
    }
    func schedule() {
        guard automatic, account != nil else { return }
        let request = BGProcessingTaskRequest(identifier: Self.taskID)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        Task { @MainActor in
            guard self.automatic else { return }
            self.debounce?.cancel()
            self.debounce = Task { @MainActor in
                try? await Task.sleep(for: .seconds(3))
                if !Task.isCancelled { await self.syncNow() }
            }
        }
    }
    func activate() async {
        permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if permission == .authorized || permission == .limited { albums = PhotoAccess.albums() }
        refreshRecords()
        if automatic { await syncNow() } else { await pump() }
    }
    func requestPhotos() async {
        permission = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        if permission == .authorized || permission == .limited { albums = PhotoAccess.albums() }
    }
    func refreshRecords() {
        records = store.records.values.filter { $0.scope == account?.scope }.sorted { $0.updatedAt > $1.updatedAt }
    }
    func save(_ record: BackupRecord) throws { try store.save(record); refreshRecords() }
    func connect(server input: String, code: String, username: String, password: String) async throws {
        guard !busy else { return }; busy = true; defer { busy = false }
        guard let url = URL(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil else { throw BackupFailure("Enter your Kindred server's HTTPS address.") }
        let server = url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        struct Session: Decodable { let token: String }
        struct User: Decodable { let id: String }
        struct SignIn: Decodable { let user: User; let session: Session }
        let body: [String: String] = code.isEmpty ? ["username": username,"password":password] : ["code":code,"device_name":UIDevice.current.name]
        let temporary = BackupAccount(server: server,userID: "",token: "")
        let response: SignIn = try await BackupAPI.request(temporary, code.isEmpty ? "/auth/login" : "/public/pairing/claim",method:"POST",body:JSONEncoder().encode(body))
        let signedIn = BackupAccount(server: server,userID:response.user.id,token:response.session.token)
        try BackupKeychain.save(signedIn); account = signedIn; restorePreferences(); refreshRecords()
        await requestPhotos()
    }
    func disconnect() async throws {
        guard !busy else { return }
        await BackgroundTransfer.shared.cancelAll()
        polling?.cancel(); debounce?.cancel(); automatic = false
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.taskID)
        try BackupKeychain.save(nil); account = nil; records = []; selectedAlbums = []
    }
    func syncNow() async {
        guard let account, !busy else { return }
        guard permission == .authorized || permission == .limited else { message = "Allow Photos access to choose what to back up."; return }
        guard !selectedAlbums.isEmpty else { message = "Choose an album to back up."; return }
        paused = false
        UserDefaults.standard.set(false,forKey:"backup.paused." + account.scope)
        busy = true
        for (asset, names) in PhotoAccess.selectedAssets(selectedAlbums) {
            if Task.isCancelled { break }
            let revision = PhotoAccess.revision(asset)
            let id = digest(Data((account.scope + "|" + asset.localIdentifier + "|" + revision).utf8))
            if store.records[id] != nil { continue }
            let record = BackupRecord(id:id,scope:account.scope,assetID:asset.localIdentifier,revision:revision,albums:names,createdAt:asset.creationDate?.timeIntervalSince1970)
            do { try store.save(record) } catch { message = error.localizedDescription; break }
        }
        busy = false; refreshRecords(); await pump()
    }
    func retry() async {
        paused = false
        if let account { UserDefaults.standard.set(false,forKey:"backup.paused." + account.scope) }
        for var record in records where record.phase == .failed {
            if record.resources.contains(where:{ resource in resource.filePath.map { !FileManager.default.fileExists(atPath:$0) } ?? true }) { record.resources=[] }
            record.phase = .pending; record.error = nil; try? save(record)
        }
        await pump()
    }
    func pause() async {
        paused = true
        if let account { UserDefaults.standard.set(true,forKey:"backup.paused." + account.scope) }
        automatic = false; savePreferences()
        polling?.cancel()
        await BackgroundTransfer.shared.cancelAll()
        message = "Paused. Your saved NAS upload positions are kept for the next sync."
    }
    func fail(_ record: inout BackupRecord, _ error: Error) {
        record.phase = .failed; record.error = error.localizedDescription; record.updatedAt = Date()
        try? save(record); message = error.localizedDescription
    }
    func assertRunning(_ scope:String) throws {
        guard !paused, account?.scope == scope else { throw CancellationError() }
    }
    func pump() async {
        guard !pumping, !paused, !busy, let account, !wifiOnly || isWiFi else { return }
        guard !(await BackgroundTransfer.shared.active()) else { return }
        guard var record = records.first(where: { [.pending,.preparing,.uploading,.verifying].contains($0.phase) }) else { return }
        pumping = true; defer { pumping = false }
        do {
            guard let asset = PHAsset.fetchAssets(withLocalIdentifiers:[record.assetID],options:nil).firstObject else { throw BackupFailure("This original is no longer accessible in Photos.") }
            guard PhotoAccess.revision(asset) == record.revision else { throw BackupFailure("This item was edited. Sync again to back up its latest version.") }
            if record.resources.isEmpty {
                record.phase = .preparing; try save(record)
                record.resources = try await PhotoAccess.export(asset,record:record)
                try Task.checkCancellation(); try assertRunning(account.scope); try save(record)
            }
            let manifest: BackupManifest
            if let id = record.serverID {
                manifest = try await BackupAPI.request(account,"/phone-backups/\(id)")
            } else {
                let resources = record.resources.map { resource -> [String:Any] in
                    ["key":resource.key,"filename":resource.filename,"media_type":resource.media_type,
                     "byte_size":resource.byte_size,"sha256":resource.sha256,"is_primary":resource.is_primary]
                }
                var body: [String:Any] = ["device_id":deviceID.uuidString,"asset_identifier":record.assetID,
                    "revision":record.revision,"albums":record.albums,"resources":resources]
                if let created = record.createdAt { body["created_at"] = created }
                manifest = try await BackupAPI.request(account,"/phone-backups/plan",method:"POST",body:JSONSerialization.data(withJSONObject:body))
                record.serverID = manifest.id
            }
            try assertRunning(account.scope)
            try record.validate(manifest)
            for index in record.resources.indices {
                let resource = manifest.resources.first { $0.key == record.resources[index].key }!
                record.resources[index].id = resource.id
                record.resources[index].received_bytes = resource.received_bytes
            }
            if manifest.state == "verified" {
                guard manifest.resources.allSatisfy({ $0.received_bytes == $0.byte_size }) else { throw BackupFailure("The receipt is incomplete.") }
                record.phase = .verified; record.error = nil; record.updatedAt = Date(); try save(record)
                store.discardStaging(record.id)
                schedulePump(); return
            }
            if manifest.state == "verifying" {
                record.phase = .verifying; try save(record); schedulePump(); return
            }
            if let index = record.resources.firstIndex(where: { ($0.received_bytes ?? 0) < $0.byte_size }) {
                let resource = record.resources[index]
                guard let filePath = resource.filePath, FileManager.default.fileExists(atPath:filePath) else { throw BackupFailure("The staged original is unavailable. Retry this backup from Photos.") }
                let offset = resource.received_bytes ?? 0
                let file = try FileHandle(forReadingFrom:URL(fileURLWithPath:filePath)); defer { try? file.close() }
                try file.seek(toOffset:UInt64(offset))
                guard let data = try file.read(upToCount:8*1024*1024), !data.isEmpty else { throw BackupFailure("The staged original ended unexpectedly.") }
                let chunk = try store.directory(record.id).appendingPathComponent(UUID().uuidString + ".chunk")
                try data.write(to:chunk,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
                let url = URL(string:account.server + "/phone-backups/\(manifest.id)/\(resource.id!)?offset=\(offset)")!
                var request = URLRequest(url:url); request.httpMethod = "PUT"
                request.setValue(account.token,forHTTPHeaderField:"X-Session-Token")
                request.setValue("application/octet-stream",forHTTPHeaderField:"Content-Type")
                request.allowsCellularAccess = !wifiOnly; request.allowsExpensiveNetworkAccess = !wifiOnly
                request.allowsConstrainedNetworkAccess = false
                try assertRunning(account.scope)
                record.phase = .uploading; record.error = nil; try save(record)
                try BackgroundTransfer.shared.enqueue(request,file:chunk,metadata:ChunkTask(scope:account.scope,recordID:record.id,resourceIndex:index,chunkPath:chunk.path,expectedEnd:offset+Int64(data.count)))
            } else {
                let _: VerificationJob = try await BackupAPI.request(account,"/phone-backups/\(manifest.id)/verify",method:"POST")
                record.phase = .verifying; try save(record); schedulePump()
            }
        } catch is CancellationError {
            record.phase = .pending; record.error = nil; try? save(record)
        } catch { fail(&record,error) }
    }
    func schedulePump() {
        polling?.cancel()
        polling = Task { @MainActor in
            try? await Task.sleep(for:.seconds(2))
            if !Task.isCancelled { await self.pump() }
        }
    }
    func completeChunk(_ metadata: ChunkTask, result: Result<ResourceOffset,Error>) async {
        defer { try? FileManager.default.removeItem(atPath:metadata.chunkPath) }
        guard var record = store.records[metadata.recordID], record.scope == metadata.scope else { return }
        do {
            let receipt = try result.get()
            guard record.resources.indices.contains(metadata.resourceIndex), receipt.received_bytes >= metadata.expectedEnd,
                  receipt.received_bytes <= record.resources[metadata.resourceIndex].byte_size else { throw BackupFailure("The NAS returned an invalid upload position.") }
            record.resources[metadata.resourceIndex].received_bytes = receipt.received_bytes
            try save(record)
            if account?.scope == record.scope { await pump() }
        } catch {
            if (error as NSError).code == NSURLErrorCancelled && (paused || account?.scope != record.scope) {
                record.phase = .pending; record.error = nil; try? save(record)
            } else { fail(&record,error) }
        }
    }
    func deleteVerified(_ selection: Set<String>) async throws {
        guard let account, !busy, !selection.isEmpty, selection.count <= 50 else { throw BackupFailure("Choose up to 50 verified items to review.") }
        busy = true; defer { busy = false }
        let chosen = records.filter { selection.contains($0.id) }
        guard chosen.count == selection.count else { throw BackupFailure("Your selection changed. Review it again.") }
        var assets: [PHAsset] = []
        for record in chosen {
            guard let asset = PHAsset.fetchAssets(withLocalIdentifiers:[record.assetID],options:nil).firstObject,
                  record.canReviewForCleanup(scope:account.scope,revision:PhotoAccess.revision(asset)), let id = record.serverID else { throw BackupFailure("An item changed or is not verified. Nothing was deleted.") }
            let job: VerificationJob = try await BackupAPI.request(account,"/phone-backups/\(id)/verify",method:"POST")
            var confirmed = false
            for _ in 0..<300 {
                try Task.checkCancellation()
                let manifest: BackupManifest = try await BackupAPI.request(account,"/phone-backups/\(id)")
                try record.validate(manifest)
                guard manifest.verification_id == job.verification_id else { throw BackupFailure("Verification changed. Please review this item again.") }
                if manifest.state == "failed" { throw BackupFailure("The NAS copy could not be verified. Nothing was deleted.") }
                if manifest.state == "verified", manifest.verified_at != nil,
                   manifest.resources.allSatisfy({ $0.received_bytes == $0.byte_size }) { confirmed = true; break }
                try await Task.sleep(for:.seconds(2))
            }
            guard confirmed else { throw BackupFailure("NAS verification is taking longer than expected. Nothing was deleted.") }
            assets.append(asset)
        }
        for (index,record) in chosen.enumerated() {
            guard let latest = PHAsset.fetchAssets(withLocalIdentifiers:[record.assetID],options:nil).firstObject,
                  PhotoAccess.revision(latest) == record.revision else { throw BackupFailure("Photos changed during review. Nothing was deleted.") }
            assets[index] = latest
        }
        try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.deleteAssets(assets as NSArray) }
        for var record in chosen { record.phase = .deleted; try save(record) }
    }
}
