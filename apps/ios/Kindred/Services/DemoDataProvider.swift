import SwiftUI

/// Provides bundled demo data so the app can run fully offline when the user
/// taps "Try the demo" on the login screen. No network calls are made in demo mode.
@Observable
final class DemoDataProvider {
    static let shared = DemoDataProvider()

    /// Whether demo mode is currently active
    var isActive = false

    /// Predefined color palette for demo thumbnail placeholders (Kindred warm tones)
    static let palette: [(Color, Color)] = [
        (Color(hex: 0xE8C9A0), Color(hex: 0xD4A574)),   // warm sand
        (Color(hex: 0xA7C4A0), Color(hex: 0x7A9072)),   // sage green
        (Color(hex: 0xD4B896), Color(hex: 0xC49A6C)),   // honey
        (Color(hex: 0xB8C8D8), Color(hex: 0x8FAABE)),   // soft blue
        (Color(hex: 0xD4A0A0), Color(hex: 0xC08080)),   // rosewood
        (Color(hex: 0xC9B8D4), Color(hex: 0xA894B8)),   // lavender
        (Color(hex: 0xE0CDA0), Color(hex: 0xC9B574)),   // goldenrod
        (Color(hex: 0xA0C4C4), Color(hex: 0x7AA8A8)),   // teal mist
        (Color(hex: 0xD8C0A8), Color(hex: 0xBFA080)),   // latte
        (Color(hex: 0xB8D4B0), Color(hex: 0x94BC88)),   // fern
        (Color(hex: 0xD0B8C8), Color(hex: 0xB8A0B0)),   // mauve
        (Color(hex: 0xC8D4B8), Color(hex: 0xA8BC94)),   // pistachio
        (Color(hex: 0xE0C8B0), Color(hex: 0xCCA888)),   // apricot
        (Color(hex: 0xA8B8C8), Color(hex: 0x8898A8)),   // slate
        (Color(hex: 0xD8D0A8), Color(hex: 0xC4B880)),   // straw
        (Color(hex: 0xC0A8B8), Color(hex: 0xA88898)),   // dusty rose
        (Color(hex: 0xB0C8C0), Color(hex: 0x8CB0A4)),   // seafoam
        (Color(hex: 0xD4C0B0), Color(hex: 0xBCA890)),   // sandstone
        (Color(hex: 0xA8C0D0), Color(hex: 0x88A4B8)),   // sky
        (Color(hex: 0xC8C0A8), Color(hex: 0xB0A888)),   // wheat
    ]

    private let decoder = JSONDecoder()

    private init() {}

    // MARK: - Bundle JSON Loading

    private func loadJSON<T: Decodable>(_ filename: String) -> T? {
        guard let url = Bundle.main.url(forResource: filename, withExtension: "json", subdirectory: nil)
                ?? Bundle.main.url(forResource: filename, withExtension: "json") else {
            // Try without subdirectory specification
            if let path = Bundle.main.path(forResource: filename, ofType: "json") {
                let fileURL = URL(fileURLWithPath: path)
                guard let data = try? Data(contentsOf: fileURL) else { return nil }
                return try? decoder.decode(T.self, from: data)
            }
            return nil
        }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? decoder.decode(T.self, from: data)
    }

    // MARK: - Public API (mirrors APIClient methods)

    func getClusterSummary(category: String) -> ClustersSummaryResponse {
        let filename: String
        switch category {
        case "people": filename = "clusters_people"
        case "pets": filename = "clusters_pets"
        case "vehicles": filename = "clusters_vehicles"
        default: filename = "clusters_people"
        }
        return loadJSON(filename) ?? ClustersSummaryResponse(clusters: [], noise_count: 0)
    }

    func getStats() -> Stats {
        loadJSON("stats") ?? Stats(
            people: CategoryStats(detections: 0, photos: 0, groups: 0),
            pets: CategoryStats(detections: 0, photos: 0, groups: 0),
            vehicles: CategoryStats(detections: 0, photos: 0, groups: 0)
        )
    }

    func getTimeline() -> TimelineResponse {
        loadJSON("timeline") ?? TimelineResponse(months: [])
    }

    func search(query: String) -> [SearchResult] {
        // Load canned search results and find a match
        guard let allResults: [String: [SearchResult]] = loadJSON("search_results") else {
            return []
        }

        let q = query.lowercased()

        // Try exact key match first
        if let results = allResults[q] {
            return results
        }

        // Try prefix/contains match
        for (key, results) in allResults {
            if key.contains(q) || q.contains(key) {
                return results
            }
        }

        // Return empty if no match — shows "no results" state
        return []
    }

    func getMe() -> UserInfo {
        loadJSON("me") ?? UserInfo(
            id: "demo_user_001",
            username: "demo",
            display_name: "Demo User",
            role: "member",
            avatar_url: nil
        )
    }

    // Map cluster IDs to detail JSON filenames (from real AI scan)
    private static let detailFiles: [String: String] = [
        "demo_p1": "detail_Mom",
        "demo_p2": "detail_Dad",
        "demo_p3": "detail_Maya",
        "demo_p4": "detail_Uncle_Jim",
        "demo_p5": "detail_Friends",
    ]

    // All available stock photo filenames for fallback
    private static let allPhotos = [
        "family-campfire-1", "family-campfire-2", "family-campfire-3", "family-campfire-4",
        "family-holiday-1", "family-holiday-2", "family-van-1", "family-van-2",
        "family-music", "family-evening", "family-campervan", "family-inside-van",
        "family-roadtrip", "family-three-sunset", "family-camper-lights",
        "couple-evening", "couple-festive", "couple-hug-van", "couple-sunset", "couple-van",
        "friends-van", "kid-campfire", "kid-festive", "marshmallows",
        "mom-child-joy", "parent-child", "parent-child-bw", "shadow-puppets",
    ]

    func getClusterDetail(category: String, clusterId: String) -> ClusterDetail {
        // Try to load from real AI detail file
        if let filename = Self.detailFiles[clusterId],
           let url = Bundle.main.url(forResource: filename, withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let detail = try? JSONDecoder().decode(ClusterDetail.self, from: data) {
            // Swap any remaining Flickr URLs to local demo:// URLs
            let fixedItems = detail.items.map { item -> Detection in
                var thumb = item.thumb_url ?? ""
                var photo = item.photo_url
                if thumb.contains("staticflickr") || thumb.isEmpty {
                    let idx = abs(item.id.hashValue) % Self.allPhotos.count
                    thumb = "demo://file_\(Self.allPhotos[idx])"
                    photo = thumb
                }
                return Detection(
                    id: item.id, category: item.category, subtype: item.subtype,
                    photo_id: item.photo_id, photo_url: photo,
                    thumb_url: thumb, flickr_url: nil,
                    photo_title: item.photo_title, owner: item.owner,
                    det_score: item.det_score, chip: item.chip
                )
            }
            return ClusterDetail(cluster_id: clusterId, items: fixedItems)
        }

        // Fallback: generate from allPhotos
        let photos = Array(Self.allPhotos.prefix(6))
        let detections = photos.enumerated().map { (i, filename) in
            Detection(
                id: "\(clusterId)_det_\(i)", category: category,
                subtype: category == "people" ? "face" : "animal",
                photo_id: "\(clusterId)_photo_\(i)",
                photo_url: "demo://file_\(filename)",
                thumb_url: "demo://file_\(filename)",
                flickr_url: nil, photo_title: "Photo \(i + 1)",
                owner: nil, det_score: 0.95 - Float(i) * 0.05, chip: nil
            )
        }
        return ClusterDetail(cluster_id: clusterId, items: detections)
    }

    // MARK: - Demo URL Detection

    /// Returns true if the URL string uses the demo:// scheme
    static func isDemoURL(_ urlString: String?) -> Bool {
        guard let urlString else { return false }
        return urlString.hasPrefix("demo://")
    }

    /// Extracts a palette index from a demo URL (e.g., "demo://thumb_03" -> 2)
    static func paletteIndex(for urlString: String) -> Int {
        let parts = urlString.split(separator: "_")
        if let last = parts.last, let num = Int(last) {
            return (num - 1) % palette.count
        }
        // Hash-based fallback
        return abs(urlString.hashValue) % palette.count
    }

    // MARK: - Deactivate

    func deactivate() {
        isActive = false
    }
}

// MARK: - DemoThumbnailView

/// Loads a real bundled stock photo for demo mode.
/// Falls back to a warm gradient if the image isn't found.
struct DemoThumbnailView: View {
    let urlString: String
    var cornerRadius: CGFloat = KindredTheme.radiusXS

    /// Map demo URL indices to bundled photo filenames (Pexels Seljan Salimova family series)
    private static let photoFiles = [
        "family-campfire-1",    // 01
        "family-campfire-2",    // 02
        "family-campfire-3",    // 03
        "family-campfire-4",    // 04
        "couple-evening",       // 05
        "couple-festive",       // 06
        "couple-hug-van",       // 07
        "couple-sunset",        // 08
        "couple-van",           // 09
        "family-camper-lights", // 10
        "family-campervan",     // 11
        "family-evening",       // 12
        "family-holiday-1",     // 13
        "family-holiday-2",     // 14
        "family-inside-van",    // 15
        "family-music",         // 16
        "family-roadtrip",      // 17
        "family-three-sunset",  // 18
        "family-van-1",         // 19
        "family-van-2",         // 20
        "friends-van",          // 21
        "kid-campfire",         // 22
        "kid-festive",          // 23
        "marshmallows",         // 24
        "mom-child-joy",        // 25
        "parent-child",         // 26
        "parent-child-bw",      // 27
        "shadow-puppets",       // 28
    ]

    private var image: UIImage? {
        let filename: String
        // Support both demo://file_FILENAME and demo://thumb_NN patterns
        if urlString.hasPrefix("demo://file_") {
            filename = String(urlString.dropFirst("demo://file_".count))
        } else {
            let idx = DemoDataProvider.paletteIndex(for: urlString)
            filename = Self.photoFiles[idx % Self.photoFiles.count]
        }
        // Try flat bundle (Xcode copies resources flat by default)
        if let path = Bundle.main.path(forResource: filename, ofType: "jpg"),
           let img = UIImage(contentsOfFile: path) {
            return img
        }
        // Try with subdirectory
        if let path = Bundle.main.path(forResource: filename, ofType: "jpg", inDirectory: "DemoData/Photos"),
           let img = UIImage(contentsOfFile: path) {
            return img
        }
        return nil
    }

    var body: some View {
        Group {
            if let uiImage = image {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
            } else {
                // Fallback gradient if photo not found
                let colors = DemoDataProvider.palette[DemoDataProvider.paletteIndex(for: urlString)]
                LinearGradient(colors: [colors.0, colors.1], startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }
}

// MARK: - DemoImageView

/// Drop-in replacement for AsyncImage that renders demo placeholders for demo:// URLs
/// and falls back to regular AsyncImage for real URLs.
struct DemoImageView: View {
    let urlString: String?
    var cornerRadius: CGFloat = 0

    var body: some View {
        if let urlString, DemoDataProvider.isDemoURL(urlString) {
            DemoThumbnailView(urlString: urlString, cornerRadius: cornerRadius)
        } else if let urlString, let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    KindredTheme.canvas
                }
            }
        } else {
            KindredTheme.canvas
        }
    }
}

// MARK: - Demo Mode Banner

/// Subtle banner shown at the bottom of the screen during demo mode.
struct DemoModeBanner: View {
    var onExit: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "play.circle.fill")
                .font(.system(size: 14))
                .foregroundStyle(KindredTheme.forest)

            Text("Demo mode")
                .font(.kindredMeta)
                .foregroundStyle(KindredTheme.pine)

            Text("\u{00b7}")
                .foregroundStyle(KindredTheme.mist)

            Text("exploring with sample data")
                .font(.kindredMeta)
                .foregroundStyle(KindredTheme.mist)

            Spacer()

            Button {
                onExit()
            } label: {
                Text("Sign out")
                    .font(.body(12, weight: .bold))
                    .foregroundStyle(KindredTheme.ember)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            KindredTheme.forest.opacity(0.08)
                .background(.ultraThinMaterial)
        )
        .overlay(alignment: .top) {
            Rectangle()
                .fill(KindredTheme.forest.opacity(0.2))
                .frame(height: 0.5)
        }
    }
}
