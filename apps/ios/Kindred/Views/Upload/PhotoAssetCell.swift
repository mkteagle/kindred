import Photos
import SwiftUI

// MARK: - Photo Asset Cell

struct PhotoAssetCell: View {
    let asset: PHAsset
    let isSelected: Bool
    @State private var image: Image?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let image = image {
                    image
                        .resizable()
                        .aspectRatio(1, contentMode: .fill)
                        .clipped()
                } else {
                    KindredTheme.warmCardBackground
                        .aspectRatio(1, contentMode: .fill)
                }
            }
            .overlay {
                if isSelected {
                    KindredTheme.pine.opacity(0.3)
                }
            }

            // Video duration badge
            if asset.mediaType == .video {
                VStack {
                    Spacer()
                    HStack {
                        Image(systemName: "video.fill")
                            .font(.caption2)
                        Text(formatDuration(asset.duration))
                            .font(.kindredMicro)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.black.opacity(0.6))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .padding(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(.white, KindredTheme.pine)
                    .padding(4)
            }
        }
        .task {
            await loadThumbnail()
        }
    }

    private func formatDuration(_ duration: TimeInterval) -> String {
        let mins = Int(duration) / 60
        let secs = Int(duration) % 60
        return String(format: "%d:%02d", mins, secs)
    }

    private func loadThumbnail() async {
        let manager = PHImageManager.default()
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        options.resizeMode = .fast

        let size = CGSize(width: 200, height: 200)

        let img: UIImage? = await withCheckedContinuation { continuation in
            manager.requestImage(for: asset, targetSize: size, contentMode: .aspectFill, options: options) { uiImage, _ in
                continuation.resume(returning: uiImage)
            }
        }

        if let uiImage = img {
            self.image = Image(uiImage: uiImage)
        }
    }
}
