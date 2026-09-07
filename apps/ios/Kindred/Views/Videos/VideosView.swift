import SwiftUI

/// Screen 07 — Videos. A 168pt hero poster then 108pt pairs, all 8px cards
/// with a bottom scrim, a round play chip and a title/duration row.
struct VideosView<Header: View>: View {
    @ViewBuilder var header: Header

    enum Filter: String, CaseIterable, Identifiable {
        case all = "All"
        case thisYear = "This year"
        case overAMinute = "Over a minute"
        var id: String { rawValue }
    }

    @State private var filter: Filter = .all
    @State private var gallery = GalleryViewModel()
    @State private var clipCount: Int?
    @State private var scrollOffset: CGFloat = 0
    @State private var playing: LibraryPhoto?

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 0) {
                Color.clear.frame(height: 0).readsScrollOffset(in: "videos")

                CollapsingTitleHeader(
                    eyebrow: clipCount.map { "\($0.formatted()) clips" } ?? "Clips",
                    title: "Videos",
                    offset: scrollOffset
                )
                header
                    .padding(.bottom, 12)

                KindredChipRow(
                    items: Filter.allCases, label: { $0.rawValue }, selection: $filter
                )
                .padding(.bottom, 14)

                if gallery.isLoading {
                    ProgressView()
                        .tint(KindredTheme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                } else if gallery.photos.isEmpty {
                    emptyState
                } else {
                    posterStack
                }

                Color.clear.frame(height: 100)
            }
        }
        .coordinateSpace(name: "videos")
        .onPreferenceChange(ScrollOffsetKey.self) { scrollOffset = $0 }
        .fullScreenCover(item: $playing) { video in
            VideoPlayerView(video: video)
        }
        .task { await load() }
        .onChange(of: filter) { _, _ in Task { await load() } }
        .refreshable { await load() }
    }

    // MARK: - Layout

    private var posterStack: some View {
        VStack(spacing: 10) {
            if let hero = gallery.photos.first {
                posterCard(hero, height: 168, titleSize: 15, showsPlayChip: true)
                    .onTapGesture { playing = hero }
            }

            let rest = Array(gallery.photos.dropFirst())
            ForEach(Array(stride(from: 0, to: rest.count, by: 2)), id: \.self) { start in
                HStack(spacing: 10) {
                    posterCard(rest[start], height: 108, titleSize: 12, showsPlayChip: false)
                        .onTapGesture { playing = rest[start] }
                    if start + 1 < rest.count {
                        posterCard(rest[start + 1], height: 108, titleSize: 12, showsPlayChip: false)
                            .onTapGesture { playing = rest[start + 1] }
                    } else {
                        Color.clear
                    }
                }
                .task { await gallery.loadMoreIfNeeded(currentItem: rest[start]) }
            }
        }
        .padding(.horizontal, 16)
    }

    private func posterCard(
        _ video: LibraryPhoto, height: CGFloat, titleSize: CGFloat, showsPlayChip: Bool
    ) -> some View {
        ZStack(alignment: .bottom) {
            KindredThumbnail(photo: video, variant: .thumb)
                .frame(maxWidth: .infinity)
                .frame(height: height)

            KindredTheme.posterScrim
                .frame(height: height)

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(video.photo_title ?? "Untitled")
                    .font(.body(titleSize, weight: .semibold, relativeTo: .subheadline))
                    .foregroundStyle(KindredTheme.ink)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if let duration = video.durationLabel {
                    Text(duration)
                        .font(.mono(height > 130 ? 10 : 9))
                        .foregroundStyle(KindredTheme.ink.opacity(0.75))
                }
            }
            .padding(.horizontal, height > 130 ? 12 : 9)
            .padding(.bottom, height > 130 ? 10 : 8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: height)
        .overlay(alignment: .topLeading) {
            if showsPlayChip {
                Image(systemName: "play.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(KindredTheme.ink)
                    .frame(width: 34, height: 34)
                    .background(Color(hex: 0x0C0E0C, alpha: 0.55), in: Circle())
                    .padding(10)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            [video.photo_title, video.durationLabel].compactMap { $0 }.joined(separator: ", ")
        )
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Plays the video")
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("No clips match this filter.")
                .font(.kindredH3)
                .foregroundStyle(KindredTheme.ink)
            Text("Try another filter, or back up more video from this device.")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.inkBody)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 40)
        .padding(.top, 60)
    }

    // MARK: - Data

    /// The chips are server-side facets, not a filter over the current page —
    /// filtering client-side would silently hide matches that had simply not
    /// been scrolled to yet.
    private func load() async {
        gallery.source = .library
        gallery.media = .video
        gallery.minDuration = filter == .overAMinute ? 60 : nil
        gallery.dateFrom = filter == .thisYear ? VideosView.startOfYear : nil
        gallery.dateTo = nil
        async let page: () = gallery.reload()
        async let counts = try? await APIClient.shared.libraryCounts()
        _ = await page
        clipCount = await counts?.videos
    }

    private static var startOfYear: String {
        let year = Calendar.current.component(.year, from: Date())
        return String(format: "%04d-01-01", year)
    }
}
