import SwiftUI

/// A reusable grid of photo thumbnails, used across Library, Explore, and Search tabs.
struct PhotoGridView: View {
    let photoURLs: [PhotoGridItem]
    var columns: Int = 2
    var spacing: CGFloat = 10
    var onTap: ((PhotoGridItem) -> Void)?

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: spacing), count: columns)
    }

    var body: some View {
        LazyVGrid(columns: gridColumns, spacing: spacing) {
            ForEach(photoURLs) { item in
                GeometryReader { geo in
                    AsyncImage(url: URL(string: item.thumbURL ?? item.photoURL)) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFill()
                                .frame(width: geo.size.width, height: geo.size.height)
                                .clipped()
                        case .failure:
                            KindredTheme.canvas
                                .overlay {
                                    Image(systemName: "photo")
                                        .foregroundStyle(KindredTheme.mist)
                                }
                        case .empty:
                            KindredTheme.canvas
                                .overlay { ProgressView().tint(KindredTheme.ember) }
                        @unknown default:
                            KindredTheme.canvas
                        }
                    }
                }
                .aspectRatio(1, contentMode: .fill)
                .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusXS))
                .contentShape(Rectangle())
                .onTapGesture {
                    onTap?(item)
                }
            }
        }
        .padding(.horizontal, spacing)
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

    init(from togetherPhoto: TogetherPhoto) {
        self.id = togetherPhoto.photo_id
        self.photoURL = togetherPhoto.photo_url
        self.thumbURL = togetherPhoto.thumb_url
        self.flickrURL = togetherPhoto.flickr_url
        self.title = togetherPhoto.photo_title
    }
}
