import SwiftUI

/// A photo or video thumbnail addressed through `/photos/{id}/local`.
///
/// The catalog endpoints hand back rows without image URLs, so the URL is
/// built here from the photo id. A row that only exists on Flickr has no NAS
/// original to serve, and the local variant 404s — those fall back to the
/// Flickr URL the row carries before giving up to the tile placeholder.
struct KindredThumbnail: View {
    let photo: LibraryPhoto
    var variant: APIClient.MediaVariant = .thumb
    var cornerRadius: CGFloat = 0
    /// `.fill` for tiles and posters; `.fit` is the viewer's `object-fit: contain`.
    var contentMode: ContentMode = .fill

    @State private var localFailed = false

    var body: some View {
        Group {
            if let demo = demoURL {
                DemoThumbnailView(urlString: demo, cornerRadius: cornerRadius)
            } else if let url = currentURL {
                AsyncImage(url: url, transaction: Transaction(animation: KindredTheme.ease(0.2))) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().aspectRatio(contentMode: contentMode)
                    case .failure:
                        placeholder
                            .task { if !localFailed { localFailed = true } }
                    case .empty:
                        placeholder
                    @unknown default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .if(contentMode == .fill) { $0.clipped() }
        .contentShape(Rectangle())
        .accessibilityLabel(Text(accessibilityText))
    }

    private var demoURL: String? {
        guard let thumb = photo.thumb_url, DemoDataProvider.isDemoURL(thumb) else { return nil }
        return thumb
    }

    private var currentURL: URL? {
        if localFailed {
            return photo.flickr_url.flatMap { $0.isEmpty ? nil : URL(string: $0) }
        }
        if let thumb = photo.thumb_url, !thumb.isEmpty, let url = URL(string: thumb) {
            return url
        }
        return APIClient.mediaURL(photoID: photo.photo_id, variant: variant)
    }

    private var placeholder: some View {
        KindredTheme.tile
    }

    private var accessibilityText: String {
        let kind = photo.isVideo ? "Video" : "Photo"
        let title = photo.photo_title.flatMap { $0.isEmpty ? nil : $0 }
        let date = photo.takenAt.map { KindredThumbnail.dateFormatter.string(from: $0) }
        return [kind, title, date].compactMap { $0 }.joined(separator: ", ")
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        return formatter
    }()
}

// MARK: - Tile

/// One cell of a mosaic: the image, a duration pill for video, the selection
/// treatment, and an optional match badge.
struct PhotoTile: View {
    let photo: LibraryPhoto
    var isSelected: Bool = false
    var isSelecting: Bool = false
    var matchPercent: Int? = nil
    var cornerRadius: CGFloat = KindredTheme.radiusTile

    var body: some View {
        KindredThumbnail(photo: photo, cornerRadius: cornerRadius)
            // Selected photo: .78 opacity behind a 3px inset terracotta outline.
            .opacity(isSelected ? 0.78 : 1)
            .overlay(alignment: .bottomLeading) {
                if let duration = photo.durationLabel {
                    KindredPhotoBadge(text: duration, systemImage: "play.fill")
                        .padding(5)
                }
            }
            .overlay(alignment: .topLeading) {
                if let matchPercent {
                    KindredPhotoBadge(text: "\(matchPercent)%")
                        .padding(5)
                }
            }
            .overlay(alignment: .topTrailing) {
                if isSelecting && isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(KindredTheme.onAccent)
                        .frame(width: 20, height: 20)
                        .background(KindredTheme.accent, in: Circle())
                        .padding(6)
                }
            }
            .overlay {
                if isSelected {
                    Rectangle()
                        .strokeBorder(KindredTheme.accent, lineWidth: 3)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
            .accessibilityValue(isSelecting ? (isSelected ? "Selected" : "Not selected") : "")
    }
}

// MARK: - Square tile

/// A tile forced to 1:1 inside a flexible grid cell.
///
/// `aspectRatio` on the thumbnail itself is unreliable while the image is
/// still loading and the view has no intrinsic size, so the ratio is held by
/// a clear spacer and the tile is drawn over it.
struct SquarePhotoTile: View {
    let photo: LibraryPhoto
    var isSelected: Bool = false
    var isSelecting: Bool = false
    var matchPercent: Int? = nil

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                PhotoTile(
                    photo: photo,
                    isSelected: isSelected,
                    isSelecting: isSelecting,
                    matchPercent: matchPercent
                )
            }
            .clipped()
    }
}
