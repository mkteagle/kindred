import Foundation
import Photos

/// Manages interaction with the device photo library using PhotoKit.
/// Tracks which photos have been uploaded to Flickr.
@Observable
final class PhotoLibraryManager {
    static let shared = PhotoLibraryManager()

    private(set) var authorizationStatus: PHAuthorizationStatus = .notDetermined
    private(set) var allPhotos: [PHAsset] = []
    private(set) var notUploadedPhotos: [PHAsset] = []
    private(set) var uploadedCount: Int = 0
    private(set) var totalDevicePhotos: Int = 0
    private(set) var estimatedSavingsBytes: Int64 = 0
    private(set) var isLoading = false

    /// Maps local asset identifier -> Flickr photo ID
    private var uploadedMap: [String: String] = [:]
    private let uploadedMapKey = "kindred_uploaded_photos"

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
        self.uploadedCount = uploadedMap.count
        self.notUploadedPhotos = assets.filter { !uploadedMap.keys.contains($0.localIdentifier) }

        // Estimate storage savings for uploaded photos
        await estimateStorageSavings()

        isLoading = false
    }

    // MARK: - Upload Tracking

    func markAsUploaded(localIdentifier: String, flickrPhotoId: String) {
        uploadedMap[localIdentifier] = flickrPhotoId
        saveUploadedMap()
        uploadedCount = uploadedMap.count
        notUploadedPhotos.removeAll { $0.localIdentifier == localIdentifier }
    }

    func isUploaded(localIdentifier: String) -> Bool {
        uploadedMap[localIdentifier] != nil
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
        allPhotos.filter { uploadedMap.keys.contains($0.localIdentifier) }
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
           let map = try? JSONDecoder().decode([String: String].self, from: data) {
            uploadedMap = map
        }
    }

    private func saveUploadedMap() {
        if let data = try? JSONEncoder().encode(uploadedMap) {
            UserDefaults.standard.set(data, forKey: uploadedMapKey)
        }
    }

    enum PhotoError: LocalizedError {
        case deleteFailed
        case notAuthorized

        var errorDescription: String? {
            switch self {
            case .deleteFailed: return "Failed to delete photos"
            case .notAuthorized: return "Photo library access not authorized"
            }
        }
    }
}
