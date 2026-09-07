import AVKit
import SwiftUI

/// Screen 09 — Video player. The poster fills the frame under a top-and-bottom
/// scrim, with translucent round buttons, a 68pt centre transport and a
/// 4pt scrubber with a 13pt knob.
///
/// `/photos/{id}/local?variant=original` answers byte ranges, so AVPlayer can
/// seek without downloading the whole file first.
struct VideoPlayerView: View {
    let video: LibraryPhoto

    @State private var player: AVPlayer?
    @State private var isPlaying = false
    @State private var elapsed: Double = 0
    @State private var duration: Double = 0
    @State private var isScrubbing = false
    @State private var scrubTarget: Double = 0
    @State private var showShare = false
    @State private var timeObserver: Any?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color(hex: 0x050605).ignoresSafeArea()

            if let player {
                VideoPlayer(player: player)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            } else {
                KindredThumbnail(photo: video, variant: .preview)
                    .ignoresSafeArea()
                    .opacity(0.96)
            }

            LinearGradient(
                stops: [
                    .init(color: Color(hex: 0x050605, alpha: 0.72), location: 0),
                    .init(color: Color(hex: 0x050605, alpha: 0), location: 0.30),
                    .init(color: Color(hex: 0x050605, alpha: 0), location: 0.55),
                    .init(color: Color(hex: 0x050605, alpha: 0.88), location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack(spacing: 0) {
                topBar
                Spacer()
                transport
                Spacer()
                bottomBlock
            }
        }
        .sheet(isPresented: $showShare) {
            SelectionShareSheet(photos: [video])
        }
        .onAppear(perform: prepare)
        .onDisappear(perform: teardown)
    }

    // MARK: - Chrome

    private var topBar: some View {
        HStack(spacing: 10) {
            roundButton("xmark", "Close") { dismiss() }
            Spacer()
            roundButton("square.and.arrow.up", "Share") { showShare = true }
            Menu {
                Button("Share") { showShare = true }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 15))
                    .foregroundStyle(KindredTheme.ink)
                    .frame(width: 32, height: 32)
                    .background(Color(hex: 0x0C0E0C, alpha: 0.5), in: Circle())
            }
            .accessibilityLabel("More actions")
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private func roundButton(
        _ icon: String, _ label: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(KindredTheme.ink)
                .frame(width: 32, height: 32)
                .background(Color(hex: 0x0C0E0C, alpha: 0.5), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var transport: some View {
        Button {
            togglePlayback()
        } label: {
            Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: 26))
                .foregroundStyle(KindredTheme.ink)
                .frame(width: 68, height: 68)
                .background(Color(hex: 0x0C0E0C, alpha: 0.5), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isPlaying ? "Pause" : "Play")
    }

    // MARK: - Title and scrubber

    private var bottomBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(video.photo_title ?? "Untitled")
                .font(.display(19, weight: .semibold, relativeTo: .title3))
                .foregroundStyle(KindredTheme.ink)
                .padding(.bottom, 4)

            Text(metaLine)
                .font(.kindredMeta)
                .foregroundStyle(KindredTheme.inkSecondary)
                .padding(.bottom, 14)

            HStack(spacing: 10) {
                Text(Self.timecode(isScrubbing ? scrubTarget : elapsed))
                    .font(.mono(11))
                    .foregroundStyle(KindredTheme.ink)
                    .monospacedDigit()

                scrubber

                Text(Self.timecode(duration))
                    .font(.mono(11))
                    .foregroundStyle(KindredTheme.ink.opacity(0.66))
                    .monospacedDigit()
            }
        }
        .padding(.horizontal, KindredTheme.gutter)
        .padding(.bottom, 30)
    }

    private var scrubber: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let fraction = duration > 0
                ? min(1, max(0, (isScrubbing ? scrubTarget : elapsed) / duration))
                : 0
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color(hex: 0xF1F1EC, alpha: 0.28))
                    .frame(height: 4)
                Capsule()
                    .fill(KindredTheme.accent)
                    .frame(width: width * fraction, height: 4)
                Circle()
                    .fill(KindredTheme.ink)
                    .frame(width: 13, height: 13)
                    .offset(x: width * fraction - 6.5)
            }
            .frame(height: 24)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        isScrubbing = true
                        scrubTarget = max(0, min(duration, duration * (value.location.x / width)))
                    }
                    .onEnded { _ in
                        seek(to: scrubTarget)
                        isScrubbing = false
                    }
            )
        }
        .frame(height: 24)
        .accessibilityElement()
        .accessibilityLabel("Playback position")
        .accessibilityValue("\(Self.timecode(elapsed)) of \(Self.timecode(duration))")
        .accessibilityAdjustableAction { direction in
            let step: Double = direction == .increment ? 10 : -10
            seek(to: max(0, min(duration, elapsed + step)))
        }
    }

    private var metaLine: String {
        var parts: [String] = []
        if let date = video.takenAt {
            parts.append(date.formatted(date: .long, time: .omitted))
        }
        if let label = video.durationLabel { parts.append(label) }
        // TODO: resolution and "with <people>" need per-photo metadata and
        // detections; neither is on the catalog row, so neither is guessed.
        return parts.joined(separator: " · ")
    }

    // MARK: - Playback

    private func prepare() {
        guard let url = APIClient.mediaURL(photoID: video.photo_id, variant: .original) else { return }
        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        self.player = player
        duration = video.duration_seconds ?? 0

        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
        ) { time in
            elapsed = time.seconds
            let itemDuration = item.duration.seconds
            if itemDuration.isFinite, itemDuration > 0 { duration = itemDuration }
        }
        player.play()
        isPlaying = true
    }

    private func teardown() {
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        timeObserver = nil
        player?.pause()
        player = nil
    }

    private func togglePlayback() {
        guard let player else { return }
        if isPlaying { player.pause() } else { player.play() }
        isPlaying.toggle()
    }

    private func seek(to seconds: Double) {
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
        elapsed = seconds
    }

    static func timecode(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

// MARK: - Slideshow

/// The Slideshow action on a person's detail screen: full-bleed, auto-advancing.
struct SlideshowView: View {
    let photos: [LibraryPhoto]
    let title: String

    @State private var index = 0
    @Environment(\.dismiss) private var dismiss
    private let timer = Timer.publish(every: 4, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack(alignment: .topTrailing) {
            KindredTheme.stage.ignoresSafeArea()

            if photos.indices.contains(index) {
                KindredThumbnail(photo: photos[index], variant: .preview, contentMode: .fit)
                    .ignoresSafeArea()
                    .transition(.opacity)
                    .id(photos[index].photo_id)
            }

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(KindredTheme.ink)
                    .frame(width: 32, height: 32)
                    .background(Color(hex: 0x0C0E0C, alpha: 0.5), in: Circle())
            }
            .buttonStyle(.plain)
            .padding(16)
            .accessibilityLabel("Close slideshow")
        }
        .onReceive(timer) { _ in
            guard !photos.isEmpty else { return }
            withAnimation(KindredTheme.ease(0.38)) {
                index = (index + 1) % photos.count
            }
        }
        .accessibilityLabel("Slideshow of \(title)")
    }
}
