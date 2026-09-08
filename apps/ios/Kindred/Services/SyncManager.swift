import BackgroundTasks
import Foundation
import Photos

/// Schedules automatic backup while delegating every transfer to the same
/// durable uploader used by the manual Backup screen.
struct FavoriteSyncResponse: Decodable, Sendable {
    let added: Int
    let already: Int
    let unknown: Int
}

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

    /// "Only on Wi-Fi" from Settings. Defaults on: a household library is
    /// mostly originals, and uploading those over cellular unasked is rude.
    private(set) var wifiOnly = true

    private let lastSyncKey = "kindred_last_successful_sync_date"
    private let autoSyncKey = "kindred_auto_sync_enabled"
    private let wifiOnlyKey = "kindred_wifi_only_uploads"

    override private init() {
        super.init()
        lastSyncDate = UserDefaults.standard.object(forKey: lastSyncKey) as? Date
        autoSyncEnabled = UserDefaults.standard.bool(forKey: autoSyncKey)
        wifiOnly = UserDefaults.standard.object(forKey: wifiOnlyKey) as? Bool ?? true
    }

    func setWiFiOnly(_ enabled: Bool) {
        wifiOnly = enabled
        UserDefaults.standard.set(enabled, forKey: wifiOnlyKey)
    }

    /// Checked before a transfer starts rather than being baked into the
    /// background session, which cannot be reconfigured once it exists.
    var canUploadNow: Bool {
        !wifiOnly || NetworkReachability.shared.isUnmetered
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

    /// Coalesces a burst of library changes into one sync.
    ///
    /// Every capture, edit and iCloud download fires this, and a burst of
    /// twenty photos fired twenty of them. Each one enumerated the entire photo
    /// library before deciding what was new, so taking a burst cost twenty full
    /// scans -- slow, and enough battery that iOS starts holding the background
    /// task back. One scan a few seconds after the last change does the same
    /// work once.
    private var pendingChangeSync: Task<Void, Never>?

    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) {
        Task { @MainActor in
            guard self.autoSyncEnabled else { return }
            self.pendingChangeSync?.cancel()
            self.pendingChangeSync = Task { @MainActor in
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled else { return }
                guard !self.isSyncing else { return }
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
        // A skipped run uploaded nothing and must not be stamped as a sync.
        // Both sets are empty when the uploader refuses to start -- waiting for
        // Wi-Fi, a run already going, a signed-out session -- and reading that
        // as success is what made the app claim it had just backed up when it
        // had not.
        guard !summary.wasSkipped else {
            lastRunSucceeded = false
            return
        }
        lastRunSucceeded = summary.failedIdentifiers.isEmpty && !Task.isCancelled
        if lastRunSucceeded {
            recordSuccessfulSync()
        }
        await syncFavorites()
    }

    /// Push the phone's hearts to the household library.
    ///
    /// Runs after a sync rather than as its own schedule: the mapping from a
    /// camera-roll asset to a Kindred photo only exists once that photo has
    /// been uploaded, so there is nothing to send before then. Additive on the
    /// server, so this never removes a favourite marked in Kindred itself.
    func syncFavorites() async {
        guard SessionManager.shared.isAuthenticated else { return }
        let ids = PhotoLibraryManager.shared.favoritedKindredPhotoIDs()
        guard !ids.isEmpty else { return }
        do {
            _ = try await APIClient.shared.postJSON(
                "/photos/favorites/sync",
                body: ["photo_ids": ids]
            ) as FavoriteSyncResponse
        } catch {
            // A failed favourite sync is not a failed backup: the photos are
            // safe, only the hearts are behind, and the next run retries.
            print("[SyncManager] Favourite sync failed: \(error)")
        }
    }

    private func recordSuccessfulSync() {
        lastRunSucceeded = true
        lastSyncDate = Date()
        UserDefaults.standard.set(lastSyncDate, forKey: lastSyncKey)
    }
}
