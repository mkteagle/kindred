import SwiftUI

/// The signed-in shell: four tabs on iPhone, the three-pane split on iPad.
struct ContentView: View {
    @State private var selectedTab = 0
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        if horizontalSizeClass == .regular {
            IPadSplitView()
        } else {
            iPhoneLayout
        }
    }

    // MARK: - iPhone

    private var iPhoneLayout: some View {
        ZStack(alignment: .bottom) {
            KindredTheme.bg.ignoresSafeArea()

            // Kept mounted rather than switched, so scroll position and a
            // half-typed search survive a trip to another tab.
            HomeView(onNavigateToTab: { tab in
                withAnimation(KindredTheme.ease(0.16)) { selectedTab = tab }
            })
            .opacity(selectedTab == 0 ? 1 : 0)
            .allowsHitTesting(selectedTab == 0)

            LibraryView()
                .opacity(selectedTab == 1 ? 1 : 0)
                .allowsHitTesting(selectedTab == 1)

            SearchView()
                .opacity(selectedTab == 2 ? 1 : 0)
                .allowsHitTesting(selectedTab == 2)

            SettingsView()
                .opacity(selectedTab == 3 ? 1 : 0)
                .allowsHitTesting(selectedTab == 3)

            if !KindredChrome.shared.hidesTabBar {
                KindredTabBar(selectedTab: $selectedTab)
                    .transition(.move(edge: .bottom))
            }
        }
        .ignoresSafeArea(.keyboard)
    }
}

// MARK: - iPad

/// Screen 13 — the iPad split. Three panes: a 232pt sidebar with counts, the
/// photo grid at four columns, and a 260pt inspector for the selected photo.
///
/// A `NavigationSplitView` gives the platform's own column behaviour, sidebar
/// toggle and keyboard focus for free; the panes' contents are Kindred's.
struct IPadSplitView: View {

    enum Shelf: String, CaseIterable, Identifiable, Hashable {
        case allPhotos = "All photos"
        case people = "People"
        case videos = "Videos"
        case favorites = "Favorites"
        case shared = "Shared"
        case search = "Search"
        case settings = "Settings"

        var id: String { rawValue }
    }

    @State private var shelf: Shelf = .allPhotos
    @State private var visibility: NavigationSplitViewVisibility = .all
    @State private var gallery = GalleryViewModel()
    @State private var counts: LibraryCounts?
    @State private var favoritesCount: Int?
    @State private var sharesCount: Int?
    @State private var peopleCount: Int?
    @State private var inspected: LibraryPhoto?
    @State private var viewing: LibraryPhoto?

    var body: some View {
        NavigationSplitView(columnVisibility: $visibility) {
            sidebar
                .navigationSplitViewColumnWidth(232)
                .toolbar(.hidden, for: .navigationBar)
        } content: {
            gridPane
                .navigationSplitViewColumnWidth(min: 420, ideal: 640)
        } detail: {
            inspector
                .navigationSplitViewColumnWidth(260)
        }
        .navigationSplitViewStyle(.balanced)
        .tint(KindredTheme.accent)
        .fullScreenCover(item: $viewing) { photo in
            PhotoViewerView(photos: gallery.photos, initial: photo)
        }
        .task { await load() }
        .onChange(of: shelf) { _, _ in Task { await load() } }
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 9) {
                Image("KindredLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 20, height: 20)
                Text("kindred")
                    .font(.display(17, weight: .semibold, relativeTo: .headline))
                    .foregroundStyle(KindredTheme.ink)
            }
            .padding(.horizontal, 6)
            .padding(.top, 16)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Kindred")

            VStack(alignment: .leading, spacing: 2) {
                KindredEyebrow(text: "Library")
                    .padding(.horizontal, 8)
                    .padding(.bottom, 6)

                ForEach(Shelf.allCases) { item in
                    shelfRow(item)
                }
            }

            Spacer()
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(KindredTheme.bg)
        .overlay(alignment: .trailing) {
            Rectangle().fill(KindredTheme.hairlineSoft).frame(width: 1)
        }
    }

    private func shelfRow(_ item: Shelf) -> some View {
        let isActive = shelf == item
        return Button {
            shelf = item
        } label: {
            HStack {
                Text(item.rawValue)
                    .font(.body(14, weight: .semibold, relativeTo: .subheadline))
                    .foregroundStyle(isActive ? KindredTheme.ink : KindredTheme.inkSecondary)
                Spacer()
                if let count = count(for: item) {
                    Text(count.formatted())
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.inkMeta)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                isActive ? Color(hex: 0xF1F1EC, alpha: 0.07) : Color.clear,
                in: RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }

    private func count(for item: Shelf) -> Int? {
        switch item {
        case .allPhotos: return counts?.total_files
        case .people: return peopleCount
        case .videos: return counts?.videos
        case .favorites: return favoritesCount
        case .shared: return sharesCount
        case .search, .settings: return nil
        }
    }

    // MARK: - Grid pane

    @ViewBuilder
    private var gridPane: some View {
        switch shelf {
        case .people:
            PeopleView { EmptyView() }
                .background(KindredTheme.bg)
        case .search:
            SearchView()
        case .settings:
            SettingsView()
        default:
            mosaicPane
        }
    }

    private var mosaicPane: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 0) {
                if gallery.isLoading {
                    ProgressView()
                        .tint(KindredTheme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                } else {
                    ForEach(gallery.days) { day in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(day.longTitle)
                                .font(.display(20, weight: .semibold, relativeTo: .title3))
                                .foregroundStyle(KindredTheme.ink)
                                .accessibilityAddTraits(.isHeader)
                            Text(day.countLabel)
                                .font(.kindredMeta)
                                .foregroundStyle(KindredTheme.inkMeta)
                            Spacer()
                            Button(gallery.isSelecting ? "Done" : "Select") {
                                if gallery.isSelecting {
                                    gallery.endSelecting()
                                } else {
                                    gallery.beginSelecting()
                                }
                            }
                            .font(.kindredMeta)
                            .foregroundStyle(KindredTheme.accent)
                        }
                        .padding(.horizontal, 18)
                        .padding(.top, 16)
                        .padding(.bottom, 10)

                        // Pencil and trackpad get the same marquee sweep as
                        // desktop, because MosaicGrid's sweep is a plain drag.
                        MosaicGrid(
                            photos: day.photos,
                            columns: 4,
                            rowHeight: 140,
                            spacing: 3,
                            isSelecting: gallery.isSelecting,
                            selection: gallery.selection,
                            onTap: { photo in
                                if gallery.isSelecting {
                                    gallery.toggleSelection(photo)
                                } else {
                                    inspected = photo
                                }
                            },
                            onLongPress: { gallery.beginSelecting(with: $0) },
                            onSweep: { gallery.addToSelection($0) }
                        )
                        .padding(.horizontal, 3)

                        if let last = day.photos.last {
                            Color.clear.frame(height: 1)
                                .task { await gallery.loadMoreIfNeeded(currentItem: last) }
                        }
                    }
                }
            }
            .padding(.bottom, 40)
        }
        .background(KindredTheme.bg)
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: - Inspector

    private var inspector: some View {
        VStack(alignment: .leading, spacing: 16) {
            KindredEyebrow(text: "Photo")

            if let photo = inspected {
                KindredThumbnail(photo: photo, variant: .preview)
                    .aspectRatio(4 / 3, contentMode: .fill)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                    .onTapGesture { viewing = photo }
                    .accessibilityHint("Opens the viewer")

                VStack(alignment: .leading, spacing: 6) {
                    Text(photo.photo_title ?? "Untitled")
                        .font(.display(17, weight: .semibold, relativeTo: .headline))
                        .foregroundStyle(KindredTheme.ink)
                    if let date = photo.takenAt {
                        Text(date.formatted(date: .long, time: .shortened))
                            .font(.kindredMeta)
                            .foregroundStyle(KindredTheme.inkMeta)
                    }
                    if let duration = photo.durationLabel {
                        Text(duration)
                            .font(.kindredMeta)
                            .foregroundStyle(KindredTheme.inkMeta)
                    }
                    // TODO: place and people pills here need a per-photo
                    // detections endpoint; the catalog row carries neither.
                }
            } else {
                Text("Select a photo to see its details.")
                    .font(.kindredBody)
                    .foregroundStyle(KindredTheme.inkBody)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(KindredTheme.bg)
        .overlay(alignment: .leading) {
            Rectangle().fill(KindredTheme.hairlineSoft).frame(width: 1)
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: - Data

    private func load() async {
        switch shelf {
        case .favorites:
            gallery.source = .favorites
            gallery.media = .all
        case .videos:
            gallery.source = .library
            gallery.media = .video
        default:
            gallery.source = .library
            gallery.media = .all
        }
        gallery.minDuration = nil

        async let page: () = gallery.reload()
        async let libraryCounts = try? await APIClient.shared.libraryCounts()
        async let favorites = try? await APIClient.shared.favoritesCount()
        async let shares = try? await APIClient.shared.shares()
        async let people = try? await APIClient.shared.getClusterSummary(category: "people")

        _ = await page
        counts = await libraryCounts
        favoritesCount = await favorites
        sharesCount = await shares?.count
        peopleCount = await people?.clusters.count
        inspected = inspected ?? gallery.photos.first
    }
}

#Preview {
    ContentView()
}
