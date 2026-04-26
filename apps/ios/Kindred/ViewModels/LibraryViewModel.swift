import Foundation

@Observable
final class LibraryViewModel {
    var selectedCategory: ClusterCategory = .people
    var clusters: [ClusterSummary] = []
    var noiseCount: Int = 0
    var isLoading = true
    var error: String?

    // Detail
    var selectedCluster: ClusterSummary?
    var clusterDetail: ClusterDetail?
    var isLoadingDetail = false

    var stats: Stats?

    func loadStats() async {
        do {
            stats = try await APIClient.shared.getStats()
        } catch {
            // Stats are optional, don't show error
        }
    }

    func loadClusters() async {
        isLoading = true
        error = nil
        do {
            let response = try await APIClient.shared.getClusterSummary(category: selectedCategory.rawValue)
            clusters = response.clusters
            noiseCount = response.noise_count ?? 0
        } catch {
            self.error = error.localizedDescription
            clusters = []
        }
        isLoading = false
    }

    func loadClusterDetail(cluster: ClusterSummary) async {
        isLoadingDetail = true
        do {
            clusterDetail = try await APIClient.shared.getClusterDetail(
                category: selectedCategory.rawValue,
                clusterId: cluster.id
            )
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingDetail = false
    }

    func renameCluster(clusterId: String, newName: String) async {
        do {
            try await APIClient.shared.labelCluster(LabelRequest(
                cluster_id: clusterId,
                label: newName,
                category: selectedCategory.rawValue
            ))
            // Update local state
            if let index = clusters.firstIndex(where: { $0.id == clusterId }) {
                let old = clusters[index]
                clusters[index] = ClusterSummary(
                    id: old.id, label: newName, det_count: old.det_count,
                    photo_count: old.photo_count, avatar: old.avatar,
                    thumb_url: old.thumb_url, photo_url: old.photo_url
                )
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func dismissCluster(clusterId: String) async {
        do {
            try await APIClient.shared.dismissCluster(DismissRequest(
                cluster_id: clusterId,
                category: selectedCategory.rawValue
            ))
            clusters.removeAll { $0.id == clusterId }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func categoryStats(for category: ClusterCategory) -> CategoryStats? {
        switch category {
        case .people: return stats?.people
        case .pets: return stats?.pets
        case .vehicles: return stats?.vehicles
        }
    }
}
