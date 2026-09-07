import Foundation
import SwiftUI

/// The paged catalog behind the Library mosaic, Videos and Favorites.
///
/// Paging is keyset (`next_cursor`), not offset, so scrolling deep costs the
/// same as the first page. Days are recomputed from the flat list each time a
/// page lands rather than being merged incrementally — a day can straddle a
/// page boundary, and re-grouping is cheap next to the fetch.
@Observable
@MainActor
final class GalleryViewModel {

    enum Source: Equatable {
        case library
        case favorites
        /// Everything matching one cluster, answered by /search with facets.
        case cluster(id: String, category: String)
        case album(id: String)
    }

    var source: Source = .library
    var media: MediaFilter = .all
    var minDuration: Double?
    var dateFrom: String?
    var dateTo: String?

    private(set) var photos: [LibraryPhoto] = []
    private(set) var days: [PhotoDay] = []
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var hasMore = true
    var error: String?

    private var cursor: String?
    private var loadToken = UUID()

    // MARK: - Selection

    var isSelecting = false
    var selection: Set<String> = []

    var selectionTitle: String {
        selection.count == 1 ? "1 selected" : "\(selection.count) selected"
    }

    func toggleSelection(_ photo: LibraryPhoto) {
        if selection.contains(photo.photo_id) {
            selection.remove(photo.photo_id)
        } else {
            selection.insert(photo.photo_id)
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }

    func beginSelecting(with photo: LibraryPhoto? = nil) {
        guard !isSelecting else { return }
        isSelecting = true
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        if let photo { selection.insert(photo.photo_id) }
    }

    func endSelecting() {
        isSelecting = false
        selection.removeAll()
    }

    func selectAll() {
        selection = Set(photos.map(\.photo_id))
    }

    /// Long-press a day header takes the whole day.
    func selectDay(_ day: PhotoDay) {
        beginSelecting()
        selection.formUnion(day.photos.map(\.photo_id))
    }

    func addToSelection(_ ids: Set<String>) {
        selection.formUnion(ids)
    }

    var selectedPhotos: [LibraryPhoto] {
        photos.filter { selection.contains($0.photo_id) }
    }

    // MARK: - Loading

    func reload() async {
        cursor = nil
        hasMore = true
        isLoading = true
        photos = []
        days = []
        await fetchPage(replacing: true)
        isLoading = false
    }

    func loadMoreIfNeeded(currentItem: LibraryPhoto) async {
        guard hasMore, !isLoadingMore, !isLoading else { return }
        // Start the next page a screenful early.
        guard let index = photos.firstIndex(of: currentItem),
              index >= photos.count - 12 else { return }
        isLoadingMore = true
        await fetchPage(replacing: false)
        isLoadingMore = false
    }

    private func fetchPage(replacing: Bool) async {
        let token = UUID()
        loadToken = token
        do {
            let page = try await requestPage()
            guard loadToken == token else { return }
            photos = replacing ? page.photos : photos + page.photos
            days = PhotoDay.group(photos)
            cursor = page.next_cursor
            hasMore = page.next_cursor != nil
            error = nil
        } catch {
            guard loadToken == token else { return }
            self.error = error.localizedDescription
            hasMore = false
        }
    }

    private func requestPage() async throws -> LibraryPage {
        switch source {
        case .library:
            return try await APIClient.shared.libraryPhotos(
                media: media, cursor: cursor,
                dateFrom: dateFrom, dateTo: dateTo, minDuration: minDuration
            )
        case .favorites:
            return try await APIClient.shared.favorites(media: media, cursor: cursor)
        case .cluster(let id, let category):
            // /search answers facet-only browses, but has no cursor of its own —
            // it is limit-bounded. One page is all a person's grid asks for.
            // TODO: a keyset-paged /clusters/{category}/{id}/photos would let
            // this scroll past its first 200 the way the library mosaic does.
            let response = try await APIClient.shared.searchLibrary(
                media: media, clusterID: id, category: category, limit: 200
            )
            return LibraryPage(
                photos: response.results.map(\.asLibraryPhoto), next_cursor: nil
            )
        case .album(let id):
            let response = try await APIClient.shared.searchLibrary(
                media: media, albumID: id, limit: 200
            )
            return LibraryPage(
                photos: response.results.map(\.asLibraryPhoto), next_cursor: nil
            )
        }
    }

    // MARK: - Actions on the selection

    func favoriteSelection() async {
        let ids = Array(selection)
        for id in ids {
            try? await APIClient.shared.setFavorite(photoID: id, favorited: true)
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        endSelecting()
    }

    func addSelection(toAlbum reference: String) async {
        do {
            _ = try await APIClient.shared.addPhotosToAlbum(
                reference: reference, photoIDs: Array(selection)
            )
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            endSelecting()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
