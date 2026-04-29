import Foundation
import Photos
import BackgroundTasks
import UIKit

/// Manages automatic background sync of device photos/videos to Flickr.
/// Detects new assets, uploads them in batches, and triggers backend processing.
@Observable
final class SyncManager: NSObject, PHPhotoLibraryChangeObserver {
    static let shared = SyncManager()

    static let backgroundTaskId = "com.kindlingsignal.kindred.sync"

    private(set) var isSyncing = false
    private(set) var syncProgress: Float = 0
    private(set) var syncedCount = 0
    private(set) var totalToSync = 0
    private(set) var lastSyncDate: Date?
    private(set) var syncError: String?
    private(set) var failedCount = 0
    private(set) var autoSyncEnabled = false

    private let lastSyncKey = "kindred_last_sync_date"
    private let autoSyncKey = "kindred_auto_sync_enabled"

    override private init() {
        super.init()
        lastSyncDate = UserDefaults.standard.object(forKey: lastSyncKey) as? Date
        autoSyncEnabled = UserDefaults.standard.bool(forKey: autoSyncKey)
    }

    // MARK: - Setup

    /// Call from app init to register background tasks and start observing photo library.
    func configure() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.backgroundTaskId,
            using: nil
        ) { task in
            self.handleBackgroundTask(task as! BGProcessingTask)
        }

        if autoSyncEnabled {
            PHPhotoLibrary.shared().register(self)
            scheduleBackgroundSync()
            // Start syncing immediately on launch — don't wait for background task interval
            Task {
                // Brief delay to let session restore from keychain
                try? await Task.sleep(for: .seconds(1))
                await syncNewPhotos()
            }
        }
    }

    func setAutoSync(_ enabled: Bool) {
        autoSyncEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: autoSyncKey)

        if enabled {
            PHPhotoLibrary.shared().register(self)
            scheduleBackgroundSync()
            // Start syncing right away when user enables auto-backup
            Task { await syncNewPhotos() }
        } else {
            PHPhotoLibrary.shared().unregisterChangeObserver(self)
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.backgroundTaskId)
        }
    }

    // MARK: - Photo Library Change Observer

    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        // New photos detected — schedule a sync if auto-sync is on
        Task { @MainActor in
            if self.autoSyncEnabled && !self.isSyncing {
                await self.syncNewPhotos()
            }
        }
    }

    // MARK: - Background Task

    private func scheduleBackgroundSync() {
        let request = BGProcessingTaskRequest(identifier: Self.backgroundTaskId)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        // Allow sync on cellular, not just wifi
        // Schedule for within the next hour
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 15)

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("[SyncManager] Failed to schedule background sync: \(error)")
        }
    }

    private func handleBackgroundTask(_ task: BGProcessingTask) {
        // Schedule the next one
        scheduleBackgroundSync()

        let syncTask = Task {
            await syncNewPhotos()
        }

        task.expirationHandler = {
            syncTask.cancel()
        }

        Task {
            await syncTask.value
            task.setTaskCompleted(success: syncError == nil)
        }
    }

    // MARK: - Sync

    /// Sync all new (not yet uploaded) photos and videos to Flickr.
    @MainActor
    func syncNewPhotos() async {
        guard !isSyncing else { return }
        guard SessionManager.shared.isAuthenticated else {
            syncError = "Not signed in"
            return
        }

        isSyncing = true
        syncError = nil
        syncedCount = 0
        failedCount = 0

        // Fetch current library state
        await PhotoLibraryManager.shared.fetchPhotos()
        let toSync = PhotoLibraryManager.shared.notUploadedPhotos
        totalToSync = toSync.count

        if toSync.isEmpty {
            isSyncing = false
            lastSyncDate = Date()
            UserDefaults.standard.set(lastSyncDate, forKey: lastSyncKey)
            return
        }

        // Request background execution time so iOS doesn't suspend us mid-sync
        var bgTaskId: UIBackgroundTaskIdentifier = .invalid
        bgTaskId = UIApplication.shared.beginBackgroundTask(withName: "kindred.sync") {
            UIApplication.shared.endBackgroundTask(bgTaskId)
            bgTaskId = .invalid
        }
        defer {
            if bgTaskId != .invalid {
                UIApplication.shared.endBackgroundTask(bgTaskId)
            }
        }

        // Upload up to 3 assets concurrently
        await withTaskGroup(of: Void.self) { group in
            var inFlight = 0
            var pending = toSync.enumerated().makeIterator()

            func addNext() {
                guard let (index, asset) = pending.next() else { return }
                inFlight += 1
                group.addTask {
                    defer {
                        Task { @MainActor in
                            self.syncProgress = Float(index + 1) / Float(self.totalToSync)
                        }
                    }

                    if PhotoLibraryManager.shared.isUploaded(localIdentifier: asset.localIdentifier) {
                        await MainActor.run { self.syncedCount += 1 }
                        return
                    }

                    do {
                        let (data, filename, contentType) = try await self.getAssetData(asset)
                        let title = asset.creationDate.map { self.formatDate($0) } ?? "Photo \(index + 1)"
                        let photoId = try await FlickrUploader.shared.uploadData(
                            data, filename: filename, contentType: contentType, title: title,
                            localIdentifier: asset.localIdentifier
                        )
                        // Mark uploaded before ML processing so a crash doesn't re-upload
                        PhotoLibraryManager.shared.markAsUploaded(
                            localIdentifier: asset.localIdentifier,
                            flickrPhotoId: photoId
                        )
                        await MainActor.run { self.syncedCount += 1 }
                        // Non-blocking ML pipeline
                        if asset.mediaType == .image {
                            try? await APIClient.shared.processPhoto(photoId: photoId, url: nil)
                        }
                    } catch {
                        let mediaLabel = asset.mediaType == .video ? "video" : "photo"
                        print("[SyncManager] Failed to sync \(mediaLabel) \(index + 1)/\(self.totalToSync): \(error.localizedDescription)")
                        await MainActor.run {
                            self.failedCount += 1
                            self.syncError = "\(self.failedCount) item\(self.failedCount == 1 ? "" : "s") failed to upload"
                        }
                    }
                }
            }

            for _ in 0..<min(3, toSync.count) { addNext() }

            for await _ in group {
                inFlight -= 1
                if !Task.isCancelled { addNext() }
            }
        }

        lastSyncDate = Date()
        UserDefaults.standard.set(lastSyncDate, forKey: lastSyncKey)
        isSyncing = false
    }

    // MARK: - Helpers

    private func getAssetData(_ asset: PHAsset) async throws -> (Data, String, String) {
        let resources = PHAssetResource.assetResources(for: asset)

        let resource: PHAssetResource
        if asset.mediaType == .video {
            resource = resources.first(where: { $0.type == .video })
                ?? resources.first(where: { $0.type == .fullSizeVideo })
                ?? resources.first!
        } else {
            resource = resources.first(where: { $0.type == .photo })
                ?? resources.first(where: { $0.type == .fullSizePhoto })
                ?? resources.first!
        }

        let filename = resource.originalFilename
        let uti = resource.uniformTypeIdentifier
        let contentType: String
        if #available(iOS 14.0, *), let utType = UTType(uti) {
            contentType = utType.preferredMIMEType ?? "application/octet-stream"
        } else {
            contentType = "application/octet-stream"
        }

        let data = try await loadResourceData(resource)
        return (data, filename, contentType)
    }

    private func loadResourceData(_ resource: PHAssetResource) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            var buffer = Data()
            let options = PHAssetResourceRequestOptions()
            options.isNetworkAccessAllowed = true

            PHAssetResourceManager.default().requestData(for: resource, options: options) { chunk in
                buffer.append(chunk)
            } completionHandler: { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: buffer)
                }
            }
        }
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter.string(from: date)
    }
}
