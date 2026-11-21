import Foundation
import Photos

@Observable
@MainActor
final class UploadViewModel {
    static let copyCheckInterval = 15 * 60
    static let automaticCopyChecksKey = "kindred_automatic_copy_checks"
    private static var lastCopyCheck: [String: Date] = [:]
    private static var activeCopyChecks: Set<String> = []

    var selectedAssets: Set<String> = []
    var isUploading: Bool { FlickrUploader.shared.isUploading }
    var uploadProgress: Float { FlickrUploader.shared.currentProgress }
    var uploadedCount: Int { FlickrUploader.shared.uploadedCount }
    var totalUploadCount: Int { FlickrUploader.shared.totalCount }
    var currentPhotoTitle: String { FlickrUploader.shared.currentAssetTitle }
    var uploadError: String? { FlickrUploader.shared.lastError }
    var cleanupError: String?
    private(set) var isCheckingCopies = false
    private(set) var statusError: String?

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

    @discardableResult
    func uploadSelected() async -> UploadSummary {
        let assetsToUpload = photoManager.notUploadedPhotos.filter {
            selectedAssets.contains($0.localIdentifier)
        }
        guard !assetsToUpload.isEmpty else { return .empty }

        let summary = await FlickrUploader.shared.uploadAssets(assetsToUpload, userInitiated: true)
        selectedAssets.subtract(summary.succeededIdentifiers)
        await photoManager.fetchPhotos()
        return summary
    }

    func refreshBackupStatuses(force: Bool = false) async {
        let automaticallyCheck = UserDefaults.standard.object(forKey: Self.automaticCopyChecksKey) as? Bool ?? true
        guard force || automaticallyCheck else { return }
        guard let accountID = SessionManager.shared.currentUser?.id,
              !Self.activeCopyChecks.contains(accountID) else { return }
        if !force, let last = Self.lastCopyCheck[accountID],
           Date().timeIntervalSince(last) < Double(Self.copyCheckInterval) { return }
        let trackedAssets = photoManager.getTrackedAssets()
        guard !trackedAssets.isEmpty else { return }
        Self.activeCopyChecks.insert(accountID)
        isCheckingCopies = true
        statusError = nil
        defer {
            Self.activeCopyChecks.remove(accountID)
            isCheckingCopies = false
            if !Task.isCancelled { Self.lastCopyCheck[accountID] = Date() }
        }
        do {
            _ = try await verifyCopies(for: trackedAssets, onlyPending: !force)
        } catch where !Task.isCancelled && SessionManager.shared.currentUser?.id == accountID {
            Analytics.backupDiagnostic(.verifyCopies, failure: .init(error))
            statusError = "Could not check backup copies. \(error.localizedDescription)"
        } catch {}
    }

    func freeUpSpace() async throws -> Int {
        cleanupError = nil
        do {
            let trackedAssets = photoManager.getTrackedAssets()
            let (records, statuses) = try await verifyCopies(for: trackedAssets)
            guard !records.isEmpty else { throw PhotoLibraryManager.PhotoError.noVerifiedBackups }
            let safeStatuses = statuses.filter(\.cleanup_safe)
            let safeFlickrIDs = Set(safeStatuses.compactMap(\.flickr_photo_id))
            let safeKindredIDs = Set(safeStatuses.compactMap { $0.kindred_photo_id?.lowercased() })
            let safeLocalIdentifiers = Set(
                records.compactMap { record in
                    let safe = record.flickrPhotoID.map(safeFlickrIDs.contains)
                        ?? record.kindredPhotoID.map { safeKindredIDs.contains($0.lowercased()) } ?? false
                    return safe ? record.localIdentifier : nil
                }
            )
            let verifiedAssets = trackedAssets.filter {
                safeLocalIdentifiers.contains($0.localIdentifier) && PhotoLibraryManager.supportsCleanup($0)
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

    private func verifyCopies(for assets: [PHAsset], onlyPending: Bool = false) async throws -> ([PhotoLibraryManager.BackupRecord], [APIClient.BackupStatus]) {
        let accountID = SessionManager.shared.currentUser?.id
        let records = photoManager.backupRecords(for: assets).filter { !onlyPending || !$0.isSafeForCleanup }
        var statuses: [APIClient.BackupStatus] = []
        for start in stride(from: 0, to: records.count, by: 500) {
            try Task.checkCancellation()
            let batch = records[start..<min(start + 500, records.count)]
            let response = try await APIClient.shared.verifyBackupStatus(
                flickrPhotoIDs: Array(Set(batch.compactMap(\.flickrPhotoID))),
                kindredPhotoIDs: Array(Set(batch.filter { $0.flickrPhotoID == nil }.compactMap(\.kindredPhotoID)))
            )
            statuses.append(contentsOf: response.items)
        }
        try Task.checkCancellation()
        guard SessionManager.shared.currentUser?.id == accountID else { throw CancellationError() }
        photoManager.reconcileBackupStatuses(statuses)
        return (records, statuses)
    }
}
