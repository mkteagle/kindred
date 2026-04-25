import SwiftUI

/// A reusable grid of photo thumbnails, used across Library, Explore, and Search tabs.
struct PhotoGridView: View {
    let photoURLs: [PhotoGridItem]
    var columns: Int = 3
    var onTap: ((PhotoGridItem) -> Void)?

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 2), count: columns)
    }

    var body: some View {
        LazyVGrid(columns: gridColumns, spacing: 2) {
            ForEach(photoURLs) { item in
                AsyncImage(url: URL(string: item.thumbURL ?? item.photoURL)) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(1, contentMode: .fill)
                            .clipped()
                    case .failure:
                        KindredTheme.warmCardBackground
                            .aspectRatio(1, contentMode: .fill)
                            .overlay {
                                Image(systemName: "photo")
                                    .foregroundStyle(.secondary)
                            }
                    case .empty:
                        KindredTheme.warmCardBackground
                            .aspectRatio(1, contentMode: .fill)
                            .overlay {
                                ProgressView()
                            }
                    @unknown default:
                        KindredTheme.warmCardBackground
                            .aspectRatio(1, contentMode: .fill)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    onTap?(item)
                }
            }
        }
    }
}

struct PhotoGridItem: Identifiable {
    let id: String
    let photoURL: String
    let thumbURL: String?
    let flickrURL: String?
    let title: String?
}

// MARK: - Convenience Initializers

extension PhotoGridItem {
    init(from detection: Detection) {
        self.id = detection.id
        self.photoURL = detection.photo_url
        self.thumbURL = detection.thumb_url
        self.flickrURL = detection.flickr_url
        self.title = detection.photo_title
    }

    init(from searchResult: SearchResult) {
        self.id = searchResult.photo_id
        self.photoURL = searchResult.photo_url
        self.thumbURL = searchResult.thumb_url
        self.flickrURL = searchResult.flickr_url
        self.title = searchResult.photo_title
    }

    init(from sceneGroup: SceneGroup) {
        self.id = sceneGroup.photo_id
        self.photoURL = sceneGroup.photo_url
        self.thumbURL = sceneGroup.thumb_url
        self.flickrURL = sceneGroup.flickr_url
        self.title = sceneGroup.photo_title
    }
}
