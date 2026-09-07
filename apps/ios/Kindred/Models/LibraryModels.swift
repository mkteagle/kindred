import Foundation

// MARK: - Media

enum MediaKind: String, Codable, Sendable {
    case photo
    case video

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = MediaKind(rawValue: raw) ?? .photo
    }
}

/// The `media` query parameter shared by /library/photos, /timeline and /search.
enum MediaFilter: String, CaseIterable, Identifiable, Sendable {
    case all
    case photo
    case video

    var id: String { rawValue }
}

// MARK: - Library photo

/// One row of `/library/photos`, `/favorites` or `/timeline`.
///
/// The gallery endpoint returns no thumbnail URL — it hands back the catalog
/// row and the client addresses the bytes through `/photos/{id}/local`. That
/// keeps one signed URL shape for every variant (thumb, preview, clip,
/// original) instead of the backend guessing which one a screen wants.
struct LibraryPhoto: Codable, Identifiable, Hashable, Sendable {
    let photo_id: String
    let photo_title: String?
    let date_taken: String?
    let media_kind: MediaKind?
    let duration_seconds: Double?
    let flickr_url: String?
    /// Present on /timeline, absent on /library/photos.
    let thumb_url: String?

    var id: String { photo_id }

    var isVideo: Bool { media_kind == .video }

    /// `photos.taken_at` is null for almost the whole library today, so the
    /// backend coalesces to `created_at` — meaning this is an upload date for
    /// most rows until the EXIF backfill lands. The UI treats it as the
    /// capture date regardless, which is what it will be.
    var takenAt: Date? {
        guard let date_taken else { return nil }
        return LibraryPhoto.parse(date_taken)
    }

    /// Day bucket key, in the device's calendar.
    var dayKey: String {
        guard let takenAt else { return "unknown" }
        return LibraryPhoto.dayKeyFormatter.string(from: takenAt)
    }

    var durationLabel: String? {
        guard let duration_seconds, duration_seconds > 0 else { return nil }
        let total = Int(duration_seconds.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    static func parse(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        if let date = ISO8601DateFormatter().date(from: value) { return date }
        // Postgres hands back "2026-06-14 21:48:03.219+00" through str().
        for format in ["yyyy-MM-dd HH:mm:ssZZZZZ", "yyyy-MM-dd HH:mm:ss.SSSSSSZZZZZ",
                       "yyyy-MM-dd HH:mm:ss.SSSZZZZZ", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd"] {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = format
            if let date = formatter.date(from: value) { return date }
        }
        return nil
    }

    private static let dayKeyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

struct LibraryPage: Codable, Sendable {
    let photos: [LibraryPhoto]
    let next_cursor: String?
}

/// A day's worth of photos, the unit the mosaic is grouped by.
struct PhotoDay: Identifiable, Hashable, Sendable {
    let id: String
    let date: Date?
    var photos: [LibraryPhoto]

    /// "Sat 14 June". Never invented — this is only the date.
    var title: String {
        guard let date else { return "Undated" }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("EEE d MMMM")
        return formatter.string(from: date)
    }

    /// "Saturday, 14 June" — the longer form Home uses.
    var longTitle: String {
        guard let date else { return "Undated" }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("EEEE d MMMM")
        return formatter.string(from: date)
    }

    var countLabel: String {
        photos.count == 1 ? "1 photo" : "\(photos.count) photos"
    }

    /// Groups a flat page into day buckets, preserving the server's ordering.
    static func group(_ photos: [LibraryPhoto]) -> [PhotoDay] {
        var order: [String] = []
        var buckets: [String: [LibraryPhoto]] = [:]
        for photo in photos {
            let key = photo.dayKey
            if buckets[key] == nil {
                buckets[key] = []
                order.append(key)
            }
            buckets[key]?.append(photo)
        }
        return order.map { key in
            let items = buckets[key] ?? []
            return PhotoDay(id: key, date: items.first?.takenAt, photos: items)
        }
    }
}

// MARK: - Counts and years

struct LibraryCounts: Codable, Sendable {
    let total_files: Int
    let photos: Int
    let videos: Int
    let on_nas: Int
    let on_flickr: Int
    let indexed_photos: Int
    let pending_index: Int
}

struct LibraryYear: Codable, Identifiable, Sendable {
    let year: Int
    let count: Int
    var id: Int { year }
}

struct LibraryYearsResponse: Codable, Sendable {
    let years: [LibraryYear]
}

// MARK: - Timeline

struct TimelineBucket: Codable, Identifiable, Sendable {
    let month: String
    let count: Int
    let photos: [LibraryPhoto]
    var id: String { month }
}

struct TimelinePage: Codable, Sendable {
    let months: [TimelineBucket]
    let next_before: String?
}

// MARK: - Search

struct SearchHit: Codable, Identifiable, Hashable, Sendable {
    let photo_id: String
    let photo_title: String?
    let date_taken: String?
    let media_kind: MediaKind?
    let duration_seconds: Double?
    let flickr_url: String?
    let distance: Double?
    let match_type: String?
    let match_name: String?
    let match_cluster_id: String?
    let match_category: String?

    var id: String { photo_id + "|" + (match_cluster_id ?? match_type ?? "") }

    /// The prototype's mono badge over the top-left of a result tile.
    /// Distance is a cosine distance, so similarity is its complement.
    var matchPercent: Int? {
        guard let distance, match_type == "visual" else { return nil }
        let similarity = max(0, min(1, 1 - distance))
        return Int((similarity * 100).rounded())
    }

    var asLibraryPhoto: LibraryPhoto {
        LibraryPhoto(
            photo_id: photo_id, photo_title: photo_title, date_taken: date_taken,
            media_kind: media_kind, duration_seconds: duration_seconds,
            flickr_url: flickr_url, thumb_url: nil
        )
    }
}

struct SearchFacetSummary: Codable, Sendable {
    let media: String?
    let date_from: String?
    let date_to: String?
    let date_field: String?
    let cluster_id: String?
    let category: String?
    let album_id: String?
}

struct SearchResponse: Codable, Sendable {
    let results: [SearchHit]
    let query: String?
    let facets: SearchFacetSummary?
}

// MARK: - Named clusters

struct NamedCluster: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let category: String
    let label: String?
    let avatar: String?
}

struct NamedClustersResponse: Codable, Sendable {
    let clusters: [NamedCluster]
}

// MARK: - Albums

struct Album: Codable, Identifiable, Hashable, Sendable {
    let id: String?
    let name: String
    let slug: String?
    let description: String?
    let photo_count: Int
    let source: String?

    /// The path segment `/albums/{reference}/photos` accepts: id or slug.
    var reference: String? { id ?? slug }
}

struct AlbumsResponse: Codable, Sendable {
    let albums: [Album]
}

struct AlbumAddResponse: Codable, Sendable {
    let album_id: String
    let added: Int
}

// MARK: - Favorites

struct FavoriteCount: Codable, Sendable {
    let count: Int
}

struct FavoriteToggleResponse: Codable, Sendable {
    let photo_id: String
    let favorited: Bool
}

// MARK: - Shares

struct ShareSummary: Codable, Identifiable, Sendable {
    let id: String
    let album_name: String?
    let url: String?
    let expires_at: String?
}

struct SharesResponse: Codable, Sendable {
    let shares: [ShareSummary]
}
