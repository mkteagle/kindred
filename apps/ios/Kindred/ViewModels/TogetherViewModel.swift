import Foundation

@Observable
final class TogetherViewModel {
    var selectedPeople: Set<String> = []  // cluster IDs
    var results: [TogetherPhoto] = []
    var totalCount: Int = 0
    var activeFilter: String = "all"  // "all" or a year string
    var sort: String = "recent"

    var isLoading = false
    var isSearching = false
    var error: String?

    // People list from the people clusters
    var peopleClusters: [ClusterSummary] = []
    var isLoadingPeople = true

    var canSearch: Bool {
        selectedPeople.count >= 2
    }

    var selectedClusters: [ClusterSummary] {
        peopleClusters.filter { selectedPeople.contains($0.id) }
    }

    func togglePerson(_ clusterId: String) {
        if selectedPeople.contains(clusterId) {
            selectedPeople.remove(clusterId)
        } else {
            selectedPeople.insert(clusterId)
        }
    }

    func loadPeople() async {
        isLoadingPeople = true
        do {
            let response = try await APIClient.shared.getClusterSummary(category: "people")
            peopleClusters = response.clusters.sorted { $0.photo_count > $1.photo_count }
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingPeople = false
    }

    func searchTogether() async {
        guard canSearch else { return }
        isSearching = true
        error = nil
        do {
            let response = try await APIClient.shared.getPhotosTogether(
                clusterIds: Array(selectedPeople)
            )
            results = response.photos
            totalCount = response.count
        } catch {
            self.error = error.localizedDescription
            results = []
            totalCount = 0
        }
        isSearching = false
    }

    func reset() {
        selectedPeople.removeAll()
        results.removeAll()
        totalCount = 0
        activeFilter = "all"
        sort = "recent"
        error = nil
    }
}
