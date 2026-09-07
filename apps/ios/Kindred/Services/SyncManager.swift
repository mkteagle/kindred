import BackgroundTasks
import Foundation
import Photos

/// Schedules automatic backup while delegating every transfer to the same
/// durable uploader used by the manual Backup screen.
@MainActor
@Observable
final class SyncManager: NSObject, PHPhotoLibraryChangeObserver {
    static let shared = SyncManager()
    static let backgroundTaskId = "com.kindlingsignal.kindred.sync"

    var isSyncing: Bool { FlickrUploader.shared.isUploading }
    var syncProgress: Float { FlickrUploader.shared.totalProgress }
    var syncedCount: Int { FlickrUploader.shared.uploadedCount }
    var failedCount: Int { FlickrUploader.shared.failedCount }
    var syncError: String? { FlickrUploader.shared.lastError }

    private(set) var totalToSync = 0
    private(set) var lastSyncDate: Date?
    private(set) var autoSyncEnabled = false
    private(set) var lastRunSucceeded = true

    private let lastSyncKey = "kindred_last_successful_sync_date"
    private let autoSyncKey = "kindred_auto_sync_enabled"

    override private init() {
        super.init()
        lastSyncDate = UserDefaults.standard.object(forKey: lastSyncKey) as? Date
        autoSyncEnabled = UserDefaults.standard.bool(forKey: autoSyncKey)
    }

    func configure() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.backgroundTaskId,
            using: nil
        ) { task in
            guard let processingTask = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in self.handleBackgroundTask(processingTask) }
        }

        if autoSyncEnabled {
            PHPhotoLibrary.shared().register(self)
            scheduleBackgroundSync()
            Task {
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
            Task { await syncNewPhotos() }
        } else {
            PHPhotoLibrary.shared().unregisterChangeObserver(self)
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.backgroundTaskId)
        }
    }

    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        Task { @MainActor in
            if self.autoSyncEnabled && !self.isSyncing {
                await self.syncNewPhotos()
            }
        }
    }

    private func scheduleBackgroundSync() {
        let request = BGProcessingTaskRequest(identifier: Self.backgroundTaskId)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("[SyncManager] Failed to schedule background sync: \(error)")
        }
    }

    private func handleBackgroundTask(_ task: BGProcessingTask) {
        scheduleBackgroundSync()
        let syncTask = Task { @MainActor in
            await syncNewPhotos()
            return lastRunSucceeded
        }
        task.expirationHandler = { syncTask.cancel() }
        Task {
            let success = await syncTask.value
            task.setTaskCompleted(success: success)
        }
    }

    func syncNewPhotos() async {
        guard !FlickrUploader.shared.isUploading else { return }
        guard SessionManager.shared.isAuthenticated else {
            lastRunSucceeded = false
            return
        }

        await PhotoLibraryManager.shared.fetchPhotos()
        let toSync = PhotoLibraryManager.shared.notUploadedPhotos
        totalToSync = toSync.count

        if toSync.isEmpty {
            recordSuccessfulSync()
            return
        }

        let summary = await FlickrUploader.shared.uploadAssets(toSync)
        lastRunSucceeded = summary.failedIdentifiers.isEmpty && !Task.isCancelled
        if lastRunSucceeded {
            recordSuccessfulSync()
        }
    }

    private func recordSuccessfulSync() {
        lastRunSucceeded = true
        lastSyncDate = Date()
        UserDefaults.standard.set(lastSyncDate, forKey: lastSyncKey)
    }
}
