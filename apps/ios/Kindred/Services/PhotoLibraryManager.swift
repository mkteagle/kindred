import Foundation
import Photos

/// Manages interaction with the device photo library using PhotoKit.
/// Tracks server-confirmed backup copies for the current Kindred account.
@Observable
@MainActor
final class PhotoLibraryManager {
    static let shared = PhotoLibraryManager()

    private(set) var authorizationStatus: PHAuthorizationStatus = .notDetermined
    private(set) var allPhotos: [PHAsset] = []
    private(set) var notUploadedPhotos: [PHAsset] = []
    private(set) var uploadedCount: Int = 0
    private(set) var totalDevicePhotos: Int = 0
    private(set) var estimatedSavingsBytes: Int64 = 0
    private(set) var isLoading = false

    var cleanupEligibleCount: Int {
        let accountID = currentAccountID
        return lock.withLock {
            uploadedMap.values.filter {
                $0.accountID == accountID && $0.isSafeForCleanup
            }.count
        }
    }

    struct BackupRecord: Codable, Sendable {
        let accountID: String
        let localIdentifier: String
        let flickrPhotoID: String
        let kindredPhotoID: String?
        var nasStatus: String?
        var flickrStatus: String?

        var isSafeForCleanup: Bool {
            nasStatus == "available" && flickrStatus == "available"
        }
    }

    /// Composite accountID|localIdentifier -> durable backup receipt.
    private var uploadedMap: [String: BackupRecord] = [:]
    private let uploadedMapKey = "kindred_uploaded_photos_v2"
    private let legacyUploadedMapKey = "kindred_uploaded_photos"

    // Serializes access to uploadedMap and notUploadedPhotos. markAsUploaded
    // is called concurrently from background upload tasks and the URLSession
    // delegate; without this, parallel removeAll calls crash with "Index out of range".
    private let lock = NSLock()

    private init() {
        loadUploadedMap()
    }

    // MARK: - Authorization

    func requestAuthorization() async {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        await MainActor.run {
            self.authorizationStatus = status
        }
        if status == .authorized || status == .limited {
            await fetchPhotos()
        }
    }

    // MARK: - Fetch Photos

    @MainActor
    func fetchPhotos() async {
        isLoading = true

        let fetchOptions = PHFetchOptions()
        fetchOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        fetchOptions.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)

        let results = PHAsset.fetchAssets(with: fetchOptions)
        var assets: [PHAsset] = []
        results.enumerateObjects { asset, _, _ in
            assets.append(asset)
        }

        self.allPhotos = assets
        self.totalDevicePhotos = assets.count

        // Prune the uploaded map — remove entries for photos no longer on the device
        let currentIDs = Set(assets.map(\.localIdentifier))
        let accountID = currentAccountID
        let (mapKeys, newUploadedCount) = lock.withLock { () -> (Set<String>, Int) in
            let accountRecords = uploadedMap.values.filter { $0.accountID == accountID }
            let staleKeys = accountRecords
                .filter { !currentIDs.contains($0.localIdentifier) }
                .map(\.localIdentifier)
            if !staleKeys.isEmpty {
                for localIdentifier in staleKeys {
                    uploadedMap.removeValue(forKey: recordKey(localIdentifier, accountID: accountID))
                }
                saveUploadedMap()
            }
            let remaining = uploadedMap.values.filter { $0.accountID == accountID }
            return (Set(remaining.map(\.localIdentifier)), remaining.count)
        }

        self.uploadedCount = newUploadedCount
        self.notUploadedPhotos = assets.filter { !mapKeys.contains($0.localIdentifier) }

        // Estimate storage savings for uploaded photos
        await estimateStorageSavings()

        isLoading = false
    }

    // MARK: - Upload Tracking

    func markAsUploaded(
        localIdentifier: String,
        flickrPhotoId: String,
        kindredPhotoId: String? = nil,
        nasStatus: String? = nil,
        flickrStatus: String? = "available",
        accountID: String? = nil
    ) {
        let resolvedAccountID = accountID ?? currentAccountID
        let key = recordKey(localIdentifier, accountID: resolvedAccountID)
        lock.lock()
        uploadedMap[key] = BackupRecord(
            accountID: resolvedAccountID,
            localIdentifier: localIdentifier,
            flickrPhotoID: flickrPhotoId,
            kindredPhotoID: kindredPhotoId,
            nasStatus: nasStatus,
            flickrStatus: flickrStatus ?? "available"
        )
        saveUploadedMap()
        let newCount = uploadedMap.values.filter { $0.accountID == resolvedAccountID }.count
        lock.unlock()

        guard resolvedAccountID == currentAccountID else { return }
        uploadedCount = newCount
        notUploadedPhotos.removeAll { $0.localIdentifier == localIdentifier }
    }

    func isUploaded(localIdentifier: String) -> Bool {
        let key = recordKey(localIdentifier, accountID: currentAccountID)
        lock.lock()
        defer { lock.unlock() }
        return uploadedMap[key] != nil
    }

    // MARK: - Delete Local Copies

    /// Delete local copies of photos that have been uploaded to Flickr.
    /// Returns the number of photos deleted.
    func freeUpSpace(assets: [PHAsset]) async throws -> Int {
        try await withCheckedThrowingContinuation { continuation in
            PHPhotoLibrary.shared().performChanges {
                PHAssetChangeRequest.deleteAssets(assets as NSArray)
            } completionHandler: { success, error in
                if success {
                    continuation.resume(returning: assets.count)
                } else {
                    continuation.resume(throwing: error ?? PhotoError.deleteFailed)
                }
            }
        }
    }

    func getUploadedAssets() -> [PHAsset] {
        let accountID = currentAccountID
        lock.lock()
        let mapKeys = Set(uploadedMap.values.compactMap { record in
            record.accountID == accountID && record.isSafeForCleanup
                ? record.localIdentifier
                : nil
        })
        lock.unlock()
        return allPhotos.filter { mapKeys.contains($0.localIdentifier) }
    }

    func getTrackedAssets() -> [PHAsset] {
        let accountID = currentAccountID
        let mapKeys = lock.withLock {
            Set(uploadedMap.values.compactMap { record in
                record.accountID == accountID ? record.localIdentifier : nil
            })
        }
        return allPhotos.filter { mapKeys.contains($0.localIdentifier) }
    }

    func backupRecords(for assets: [PHAsset]) -> [BackupRecord] {
        let accountID = currentAccountID
        let identifiers = Set(assets.map(\.localIdentifier))
        return lock.withLock {
            uploadedMap.values.filter {
                $0.accountID == accountID && identifiers.contains($0.localIdentifier)
            }
        }
    }

    func reconcileBackupStatuses(_ statuses: [APIClient.BackupStatus]) {
        let accountID = currentAccountID
        let byFlickrID = Dictionary(uniqueKeysWithValues: statuses.map { ($0.flickr_photo_id, $0) })
        lock.withLock {
            let keys = uploadedMap.keys.filter { uploadedMap[$0]?.accountID == accountID }
            for key in keys {
                guard var record = uploadedMap[key] else { continue }
                guard let status = byFlickrID[record.flickrPhotoID] else { continue }
                record.nasStatus = status.nas_status
                record.flickrStatus = status.flickr_status
                uploadedMap[key] = record
            }
            saveUploadedMap()
        }
    }

    // MARK: - Storage Estimation

    @MainActor
    private func estimateStorageSavings() async {
        let uploadedAssets = getUploadedAssets()
        var totalBytes: Int64 = 0

        let resources = uploadedAssets.prefix(100).flatMap { PHAssetResource.assetResources(for: $0) }
        for resource in resources {
            if let size = resource.value(forKey: "fileSize") as? Int64 {
                totalBytes += size
            }
        }

        // Extrapolate if we only sampled
        if uploadedAssets.count > 100, !uploadedAssets.isEmpty {
            let avgBytes = totalBytes / Int64(min(uploadedAssets.count, 100))
            totalBytes = avgBytes * Int64(uploadedAssets.count)
        }

        estimatedSavingsBytes = totalBytes
    }

    // MARK: - Persistence

    private func loadUploadedMap() {
        if let data = UserDefaults.standard.data(forKey: uploadedMapKey),
           let map = try? JSONDecoder().decode([String: BackupRecord].self, from: data) {
            uploadedMap = map
            return
        }

        // One-time migration of the old device-global Flickr map. It remains
        // ineligible for cleanup until the server confirms a NAS copy.
        if let data = UserDefaults.standard.data(forKey: legacyUploadedMapKey),
           let legacy = try? JSONDecoder().decode([String: String].self, from: data) {
            let accountID = currentAccountID
            for (localIdentifier, flickrPhotoID) in legacy {
                uploadedMap[recordKey(localIdentifier, accountID: accountID)] = BackupRecord(
                    accountID: accountID,
                    localIdentifier: localIdentifier,
                    flickrPhotoID: flickrPhotoID,
                    kindredPhotoID: nil,
                    nasStatus: nil,
                    flickrStatus: "available"
                )
            }
            saveUploadedMap()
        }
    }

    private func saveUploadedMap() {
        if let data = try? JSONEncoder().encode(uploadedMap) {
            UserDefaults.standard.set(data, forKey: uploadedMapKey)
        }
    }

    private var currentAccountID: String {
        SessionManager.shared.currentUser?.id ?? "unknown"
    }

    private func recordKey(_ localIdentifier: String, accountID: String) -> String {
        "\(accountID)|\(localIdentifier)"
    }

    enum PhotoError: LocalizedError {
        case deleteFailed
        case notAuthorized
        case noVerifiedBackups

        var errorDescription: String? {
            switch self {
            case .deleteFailed: return "Failed to delete photos"
            case .notAuthorized: return "Photo library access not authorized"
            case .noVerifiedBackups:
                return "No items have both a verified NAS copy and a verified Flickr copy yet."
            }
        }
    }
}
