import Foundation

@Observable
final class SearchViewModel {
    var query: String = ""
    var results: [SearchResult] = []
    var isSearching = false
    var error: String?
    var hasSearched = false

    private var searchTask: Task<Void, Never>?

    func search() {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 3 else {
            results = []
            hasSearched = false
            return
        }

        // Demo mode: return canned results instantly, no network
        if DemoDataProvider.shared.isActive {
            isSearching = false
            hasSearched = true
            results = DemoDataProvider.shared.search(query: trimmed)
            return
        }

        searchTask?.cancel()
        searchTask = Task {
            isSearching = true
            error = nil
            hasSearched = true

            do {
                try await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }

                let searchResults = try await APIClient.shared.search(query: trimmed, limit: 100)
                guard !Task.isCancelled else { return }

                await MainActor.run {
                    self.results = searchResults
                    self.isSearching = false
                }
            } catch is CancellationError {
                // Cancelled, ignore
            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    self.error = error.localizedDescription
                    self.isSearching = false
                }
            }
        }
    }
}
