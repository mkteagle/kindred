import Foundation

/// The catalog surface the redesigned screens read from.
///
/// Everything here already exists on the FastAPI backend; nothing is invented.
/// Where a screen needs something the API does not offer, the screen carries a
/// TODO naming the endpoint rather than a client-side approximation.
extension APIClient {

    // MARK: - URL building

    /// A signed URL for one variant of a photo's bytes.
    ///
    /// `/library/photos` and `/search` return catalog rows without thumbnail
    /// URLs, so the client addresses media itself. Videos answer byte ranges
    /// here, which is what lets `AVPlayer` scrub a `clip` or `original`.
    ///
    /// The session token travels as a query item because `AsyncImage` and
    /// `AVPlayer` both fetch without going through this actor's header path.
    nonisolated static func mediaURL(
        photoID: String,
        variant: MediaVariant = .thumb,
        baseURL: String? = nil,
        token: String? = nil
    ) -> URL? {
        let base = baseURL ?? publicBaseURL
        guard !base.isEmpty,
              var components = URLComponents(string: "\(base)/photos/\(photoID)/local")
        else { return nil }
        var items = [URLQueryItem(name: "variant", value: variant.rawValue)]
        if let token = token ?? publicSessionToken, !token.isEmpty {
            items.append(URLQueryItem(name: "session_token", value: token))
        }
        components.queryItems = items
        return components.url
    }

    /// Authenticated dynamic still image. Widths match the backend allowlist.
    nonisolated static func optimizedImageURL(photoID: String, pixels: CGFloat) -> URL? {
        let widths = [160, 320, 480, 640, 960, 1280, 1600, 2048, 2560]
        let width = widths.first { CGFloat($0) >= pixels } ?? 2560
        guard var components = URLComponents(string: "\(publicBaseURL)/photos/\(photoID)/image") else { return nil }
        components.queryItems = [
            URLQueryItem(name: "w", value: String(width)),
            URLQueryItem(name: "q", value: "80"),
            // UIImage supports WebP; do not depend on URLSession's Accept default.
            URLQueryItem(name: "format", value: "webp"),
            URLQueryItem(name: "session_token", value: publicSessionToken)
        ]
        return components.url
    }

    enum MediaVariant: String, Sendable {
        case thumb, preview, clip, original
    }

    // MARK: - Gallery

    /// One keyset page of the catalog. `cursor` is the previous page's
    /// `next_cursor`; paging this way costs the same at any scroll depth.
    func libraryPhotos(
        media: MediaFilter = .all,
        cursor: String? = nil,
        dateFrom: String? = nil,
        dateTo: String? = nil,
        minDuration: Double? = nil,
        sort: String = "newest",
        limit: Int = 60
    ) async throws -> LibraryPage {
        var items = [
            URLQueryItem(name: "sort", value: sort),
            URLQueryItem(name: "media", value: media.rawValue),
            URLQueryItem(name: "limit", value: String(min(limit, 100))),
        ]
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let dateFrom { items.append(URLQueryItem(name: "date_from", value: dateFrom)) }
        if let dateTo { items.append(URLQueryItem(name: "date_to", value: dateTo)) }
        if let minDuration {
            items.append(URLQueryItem(name: "min_duration", value: String(minDuration)))
        }
        return try await get(path("/library/photos", items))
    }

    func libraryCounts() async throws -> LibraryCounts {
        try await get("/library/counts")
    }

    func libraryYears(media: MediaFilter = .all) async throws -> [LibraryYear] {
        let response: LibraryYearsResponse = try await get(
            path("/library/years", [URLQueryItem(name: "media", value: media.rawValue)])
        )
        return response.years
    }

    /// A page of the library grouped by month, newest first.
    /// Continue with `before` set to the response's `next_before`.
    func timelinePage(
        months: Int = 3,
        before: String? = nil,
        media: MediaFilter = .all
    ) async throws -> TimelinePage {
        var items = [
            URLQueryItem(name: "months", value: String(months)),
            URLQueryItem(name: "media", value: media.rawValue),
        ]
        if let before { items.append(URLQueryItem(name: "before", value: before)) }
        return try await get(path("/timeline", items))
    }

    // MARK: - Search

    /// Free text crossed with facets. With an empty `q` the facets stand alone
    /// and this is a filtered browse — which is how the Videos screen's chips
    /// and a person's "See all" are answered.
    func searchLibrary(
        query: String = "",
        media: MediaFilter = .all,
        dateFrom: String? = nil,
        dateTo: String? = nil,
        dateField: String = "taken",
        clusterID: String? = nil,
        category: String? = nil,
        albumID: String? = nil,
        limit: Int = 60
    ) async throws -> SearchResponse {
        var items = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "media", value: media.rawValue),
            URLQueryItem(name: "date_field", value: dateField),
            URLQueryItem(name: "limit", value: String(min(limit, 200))),
        ]
        if let dateFrom { items.append(URLQueryItem(name: "date_from", value: dateFrom)) }
        if let dateTo { items.append(URLQueryItem(name: "date_to", value: dateTo)) }
        if let clusterID, let category {
            items.append(URLQueryItem(name: "cluster_id", value: clusterID))
            items.append(URLQueryItem(name: "category", value: category))
        }
        if let albumID { items.append(URLQueryItem(name: "album_id", value: albumID)) }
        return try await get(path("/search", items))
    }

    // MARK: - Clusters

    func namedClusters(category: String = "people") async throws -> [NamedCluster] {
        let response: NamedClustersResponse = try await get(
            path("/clusters/named", [URLQueryItem(name: "category", value: category)])
        )
        return response.clusters
    }

    // MARK: - Favorites

    func favorites(media: MediaFilter = .all, cursor: String? = nil, limit: Int = 60)
        async throws -> LibraryPage
    {
        var items = [
            URLQueryItem(name: "media", value: media.rawValue),
            URLQueryItem(name: "limit", value: String(min(limit, 100))),
        ]
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await get(path("/favorites", items))
    }

    func favoritesCount() async throws -> Int {
        let response: FavoriteCount = try await get("/favorites/count")
        return response.count
    }

    /// Idempotent on the server, so a double tap is not an error.
    @discardableResult
    func setFavorite(photoID: String, favorited: Bool) async throws -> Bool {
        let response: FavoriteToggleResponse = try await send(
            "/photos/\(photoID)/favorite",
            method: favorited ? "PUT" : "DELETE"
        )
        return response.favorited
    }

    // MARK: - Albums

    func albums() async throws -> [Album] {
        let response: AlbumsResponse = try await get("/albums")
        return response.albums
    }

    func createAlbum(name: String, description: String = "") async throws -> Album {
        try await postJSON("/albums", body: ["name": name, "description": description])
    }

    /// Adds the selection to an album. Per-photo failures are reported by the
    /// server rather than aborting the batch, so `added` can be short.
    @discardableResult
    func addPhotosToAlbum(reference: String, photoIDs: [String]) async throws -> AlbumAddResponse {
        try await postJSON("/albums/\(reference)/photos", body: ["photo_ids": photoIDs])
    }

    // MARK: - Shares

    func shares() async throws -> [ShareSummary] {
        let response: SharesResponse = try await get("/shares")
        return response.shares
    }

    // MARK: - Helpers

    private nonisolated func path(_ base: String, _ items: [URLQueryItem]) -> String {
        var components = URLComponents()
        components.queryItems = items
        return base + "?" + (components.percentEncodedQuery ?? "")
    }
}
