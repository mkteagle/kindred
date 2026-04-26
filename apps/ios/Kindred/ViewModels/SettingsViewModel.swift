import Foundation

@Observable
final class SettingsViewModel {
    var syncs: [SyncLog] = []
    var activeJob: ScanJob?
    var isLoadingSyncs = false
    var isHealthy = false
    var error: String?

    var session: SessionManager { SessionManager.shared }

    var lastSyncDate: String? {
        guard let last = syncs.first else { return nil }
        return last.finished_at ?? last.started_at
    }

    func loadSyncs() async {
        if DemoDataProvider.shared.isActive {
            syncs = []
            return
        }
        isLoadingSyncs = true
        do {
            syncs = try await APIClient.shared.getSyncs()
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingSyncs = false
    }

    func checkHealth() async {
        if DemoDataProvider.shared.isActive {
            isHealthy = true
            return
        }
        do {
            let health = try await APIClient.shared.healthCheck()
            isHealthy = health.status == "ok"
        } catch {
            isHealthy = false
        }
    }

    func checkActiveJob() async {
        if DemoDataProvider.shared.isActive {
            activeJob = nil
            return
        }
        do {
            activeJob = try await APIClient.shared.getActiveJob()
        } catch {
            activeJob = nil
        }
    }

    func logout() {
        DemoDataProvider.shared.deactivate()
        session.logout()
    }
}
