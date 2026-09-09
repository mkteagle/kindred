import SwiftUI

/// Display and speculative loads share one session/cache and deduplicate URLs.
/// Speculation is limited to three transfers, 32 waiters, and unmetered access.
@MainActor
final class PhotoImageDelivery {
    static let shared = PhotoImageDelivery()
    private let session = URLSession(configuration: .default)
    private let thumbnails = NSCache<NSString, UIImage>()
    private var inFlight: [URL: Task<UIImage?, Never>] = [:]
    private var speculativeActive = 0
    private var speculativeWaiting = 0

    init() {
        thumbnails.countLimit = 200
        thumbnails.totalCostLimit = 48 * 1024 * 1024
    }

    func thumbnail(for photoID: String) -> UIImage? {
        thumbnails.object(forKey: "\(APIClient.publicBaseURL):\(APIClient.publicSessionToken ?? ""):\(photoID)" as NSString)
    }

    func remember(_ image: UIImage, photoID: String) {
        thumbnails.setObject(image, forKey: "\(APIClient.publicBaseURL):\(APIClient.publicSessionToken ?? ""):\(photoID)" as NSString,
                             cost: Int(image.size.width * image.size.height * 4))
    }

    func image(_ url: URL, speculative: Bool = false) async -> UIImage? {
        if let task = inFlight[url] { return await task.value }
        if speculative {
            guard !ProcessInfo.processInfo.isLowPowerModeEnabled, speculativeWaiting < 32 else { return nil }
            speculativeWaiting += 1
            while speculativeActive >= 3 && !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
            }
            speculativeWaiting -= 1
            guard !Task.isCancelled else { return nil }
            if let task = inFlight[url] { return await task.value }
            speculativeActive += 1
        }
        defer { if speculative { speculativeActive -= 1 } }
        let task = Task<UIImage?, Never> {
            var request = URLRequest(url: url)
            request.allowsConstrainedNetworkAccess = !speculative
            request.allowsExpensiveNetworkAccess = !speculative
            request.timeoutInterval = 30
            guard let (data, response) = try? await session.data(for: request),
                  let response = response as? HTTPURLResponse, response.statusCode == 200
            else { return nil }
            return UIImage(data: data)
        }
        inFlight[url] = task
        let image = await task.value
        inFlight[url] = nil
        return image
    }
}

/// Geometry keeps lazy/sized requests consistent across mosaic, grid and viewer.
struct KindredThumbnail: View {
    let photo: LibraryPhoto
    var variant: APIClient.MediaVariant = .thumb
    var cornerRadius: CGFloat = 0
    var contentMode: ContentMode = .fill
    @Environment(\.displayScale) private var displayScale
    @State private var loaded: UIImage?
    @State private var loadedURL: URL?

    var body: some View {
        GeometryReader { geo in
            let frame = geo.frame(in: .global)
            let screen = UIScreen.main.bounds
            let visible = frame.intersects(screen)
            let near = frame.intersects(screen.insetBy(dx: 0, dy: -screen.height * 1.5))
            let thumb = PhotoImageDelivery.shared.thumbnail(for: photo.photo_id)
            let aspect = thumb.map { $0.size.width / max(1, $0.size.height) }
            let fittedWidth = variant == .preview && aspect != nil
                ? min(geo.size.width, geo.size.height * aspect!) : geo.size.width
            let pixels = min(variant == .thumb ? 960 : 2560, fittedWidth * displayScale)
            let url = photo.isVideo
                ? APIClient.mediaURL(photoID: photo.photo_id, variant: variant)
                : APIClient.optimizedImageURL(photoID: photo.photo_id, pixels: pixels)
            ZStack {
                KindredTheme.tile
                if let demo = photo.thumb_url, DemoDataProvider.isDemoURL(demo) {
                    DemoThumbnailView(urlString: demo, cornerRadius: cornerRadius)
                } else if let image = (loadedURL == url ? loaded : nil) ?? PhotoImageDelivery.shared.thumbnail(for: photo.photo_id) {
                    Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
                        .frame(width: geo.size.width, height: geo.size.height)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .task(id: "\(url?.absoluteString ?? ""):\(near):\(visible)") {
                guard near, let url, !DemoDataProvider.isDemoURL(photo.thumb_url ?? "") else { return }
                let image = await PhotoImageDelivery.shared.image(url, speculative: !visible)
                guard !Task.isCancelled, let image else { return }
                withAnimation(KindredTheme.ease(0.2)) { loaded = image; loadedURL = url }
                if variant == .thumb { PhotoImageDelivery.shared.remember(image, photoID: photo.photo_id) }
            }
        }
        .if(contentMode == .fill) { $0.clipped() }
        .contentShape(Rectangle())
        .accessibilityLabel(Text(accessibilityText))
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
