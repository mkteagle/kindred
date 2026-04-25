import Foundation
import Photos

@Observable
final class UploadViewModel {
    var selectedAssets: Set<String> = []
    var isUploading: Bool { FlickrUploader.shared.isUploading }
    var uploadProgress: Float { FlickrUploader.shared.totalProgress }
    var uploadedCount: Int { FlickrUploader.shared.uploadedCount }
    var totalUploadCount: Int { FlickrUploader.shared.totalCount }
    var currentPhotoTitle: String { FlickrUploader.shared.currentPhotoTitle }
    var uploadError: String? { FlickrUploader.shared.lastError }

    var photoManager: PhotoLibraryManager { PhotoLibraryManager.shared }

    func requestAccess() async {
        await photoManager.requestAuthorization()
    }

    func refreshPhotos() async {
        await photoManager.fetchPhotos()
    }

    func toggleSelection(_ identifier: String) {
        if selectedAssets.contains(identifier) {
            selectedAssets.remove(identifier)
        } else {
            selectedAssets.insert(identifier)
        }
    }

    func selectAll() {
        selectedAssets = Set(photoManager.notUploadedPhotos.map(\.localIdentifier))
    }

    func clearSelection() {
        selectedAssets.removeAll()
    }

    func uploadSelected() async {
        let assetsToUpload = photoManager.notUploadedPhotos.filter {
            selectedAssets.contains($0.localIdentifier)
        }
        guard !assetsToUpload.isEmpty else { return }

        await FlickrUploader.shared.uploadAssets(assetsToUpload)
        selectedAssets.removeAll()
        await photoManager.fetchPhotos()
    }

    func freeUpSpace() async throws -> Int {
        let uploadedAssets = photoManager.getUploadedAssets()
        guard !uploadedAssets.isEmpty else { return 0 }
        let count = try await photoManager.freeUpSpace(assets: uploadedAssets)
        await photoManager.fetchPhotos()
        return count
    }

    var formattedSavings: String {
        ByteCountFormatter.string(fromByteCount: photoManager.estimatedSavingsBytes, countStyle: .file)
    }
}
