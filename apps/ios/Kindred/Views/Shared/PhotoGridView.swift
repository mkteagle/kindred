import SwiftUI

/// A reusable grid of photo thumbnails, used across Library, Explore, and Search tabs.
struct PhotoGridView: View {
    let photoURLs: [PhotoGridItem]
    var columns: Int = 2
    var spacing: CGFloat = 10
    var onTap: ((PhotoGridItem) -> Void)?
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var effectiveColumns: Int {
        if horizontalSizeClass == .regular {
            return max(columns, 4)
        }
        return columns
    }

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: spacing), count: effectiveColumns)
    }

    var body: some View {
        LazyVGrid(columns: gridColumns, spacing: spacing) {
            ForEach(photoURLs) { item in
                GeometryReader { geo in
                    let thumbOrPhoto = item.thumbURL ?? item.photoURL
                    if DemoDataProvider.isDemoURL(thumbOrPhoto) {
                        DemoThumbnailView(urlString: thumbOrPhoto, cornerRadius: 0)
                            .frame(width: geo.size.width, height: geo.size.height)
                    } else {
                        AsyncImage(url: URL(string: thumbOrPhoto)) { phase in
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

extension PhotoGridItem {
    /// Bridge to the redesigned viewer, which works in catalog rows rather
    /// than in the grid item the older screens pass around.
    var asLibraryPhoto: LibraryPhoto {
        LibraryPhoto(
            photo_id: id,
            photo_title: title,
            date_taken: nil,
            media_kind: .photo,
            duration_seconds: nil,
            flickr_url: flickrURL,
            thumb_url: thumbURL ?? photoURL
        )
    }
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
