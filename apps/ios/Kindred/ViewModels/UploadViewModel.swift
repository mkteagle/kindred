import Foundation
import Photos

@Observable
@MainActor
final class UploadViewModel {
    var selectedAssets: Set<String> = []
    var isUploading: Bool { FlickrUploader.shared.isUploading }
    var uploadProgress: Float { FlickrUploader.shared.totalProgress }
    var uploadedCount: Int { FlickrUploader.shared.uploadedCount }
    var totalUploadCount: Int { FlickrUploader.shared.totalCount }
    var currentPhotoTitle: String { FlickrUploader.shared.currentAssetTitle }
    var uploadError: String? { FlickrUploader.shared.lastError }
    var cleanupError: String?

    var photoManager: PhotoLibraryManager { PhotoLibraryManager.shared }

    func requestAccess() async {
        await photoManager.requestAuthorization()
        if photoManager.authorizationStatus == .authorized || photoManager.authorizationStatus == .limited {
            _ = await FlickrUploader.shared.resumeQueuedUploads()
        }
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

        let summary = await FlickrUploader.shared.uploadAssets(assetsToUpload)
        selectedAssets.subtract(summary.succeededIdentifiers)
        await photoManager.fetchPhotos()
    }

    func freeUpSpace() async throws -> Int {
        cleanupError = nil
        do {
            let trackedAssets = photoManager.getTrackedAssets()
            let records = photoManager.backupRecords(for: trackedAssets)
            guard !records.isEmpty else { throw PhotoLibraryManager.PhotoError.noVerifiedBackups }

            var statuses: [APIClient.BackupStatus] = []
            let flickrIDs = records.map(\.flickrPhotoID)
            for start in stride(from: 0, to: flickrIDs.count, by: 500) {
                let end = min(start + 500, flickrIDs.count)
                let response = try await APIClient.shared.verifyBackupStatus(
                    flickrPhotoIDs: Array(flickrIDs[start..<end])
                )
                statuses.append(contentsOf: response.items)
            }
            photoManager.reconcileBackupStatuses(statuses)

            let safeFlickrIDs = Set(
                statuses.filter(\.cleanup_safe).map(\.flickr_photo_id)
            )
            let safeLocalIdentifiers = Set(
                records.compactMap { record in
                    safeFlickrIDs.contains(record.flickrPhotoID)
                        ? record.localIdentifier
                        : nil
                }
            )
            let verifiedAssets = trackedAssets.filter {
                safeLocalIdentifiers.contains($0.localIdentifier)
            }
            guard !verifiedAssets.isEmpty else {
                throw PhotoLibraryManager.PhotoError.noVerifiedBackups
            }
            let count = try await photoManager.freeUpSpace(assets: verifiedAssets)
            await photoManager.fetchPhotos()
            return count
        } catch {
            cleanupError = error.localizedDescription
            throw error
        }
    }

    var formattedSavings: String {
        ByteCountFormatter.string(fromByteCount: photoManager.estimatedSavingsBytes, countStyle: .file)
    }
}
