import SwiftUI

/// The Library tab — screens 02 (mosaic) and 03 (select mode).
///
/// The scope chips are the tab's whole navigation: All is the day mosaic,
/// People and Animals hand off to the cluster grids, Videos to the clips
/// screen. That keeps four tabs at the bottom instead of six.
struct LibraryView: View {

    enum Scope: String, CaseIterable, Identifiable {
        case all = "All"
        case people = "People"
        case animals = "Animals"
        case videos = "Videos"

        var id: String { rawValue }
    }

    @State private var scope: Scope = .all
    @State private var gallery = GalleryViewModel()
    @State private var counts: LibraryCounts?
    @State private var scrollOffset: CGFloat = 0
    @State private var viewing: LibraryPhoto?
    @State private var showAlbumPicker = false
    @State private var showShareSheet = false
    @State private var showUpload = false
    @State private var chrome = KindredChrome.shared
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isIPad: Bool { horizontalSizeClass == .regular }
    private var columns: Int { isIPad ? 4 : 3 }
    private var rowHeight: CGFloat { isIPad ? 140 : 116 }
    private var tileGap: CGFloat { isIPad ? 3 : 2 }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                KindredTheme.bg.ignoresSafeArea()

                switch scope {
                case .all:
                    mosaicScreen
                case .people:
                    PeopleView { chipHeader }
                case .animals:
                    ClusterGridView(category: .pets) { chipHeader }
                case .videos:
                    VideosView { chipHeader }
                }

                if gallery.isSelecting {
                    SelectionActionBar(
                        onShare: { showShareSheet = true },
                        onAlbum: { showAlbumPicker = true },
                        onFavorite: { Task { await gallery.favoriteSelection() } },
                        onRemove: { /* TODO: needs DELETE /photos/{id}; only Flickr deletion exists today */ }
                    )
                    .transition(.move(edge: .bottom))
                }
            }
            .toolbar {
                if !gallery.isSelecting {
                    // The in-content title is Space Grotesk under a mono
                    // eyebrow, which the system large title cannot draw, so
                    // the collapse is rebuilt: this appears as that scrolls off.
                    ToolbarItem(placement: .principal) {
                        Text(scope.rawValue)
                            .font(.kindredTitle)
                            .foregroundStyle(KindredTheme.ink)
                            .opacity(scrollOffset > 44 ? 1 : 0)
                            .animation(KindredTheme.ease(0.2), value: scrollOffset > 44)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showUpload = true } label: {
                            Image(systemName: "plus")
                                .font(.system(size: 19, weight: .regular))
                        }
                        .accessibilityLabel("Add photos to the library")
                    }
                }
            }
            .toolbar(gallery.isSelecting ? .hidden : .visible, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .fullScreenCover(item: $viewing) { photo in
                PhotoViewerView(photos: gallery.photos, initial: photo)
            }
            .sheet(isPresented: $showAlbumPicker) {
                AlbumPickerSheet(photoIDs: Array(gallery.selection)) { reference in
                    Task { await gallery.addSelection(toAlbum: reference) }
                }
            }
            .sheet(isPresented: $showShareSheet) {
                SelectionShareSheet(photos: gallery.selectedPhotos)
            }
            .sheet(isPresented: $showUpload) {
                UploadSheetView()
            }
        }
        .onChange(of: gallery.isSelecting) { _, selecting in
            // The selection bar replaces the tab bar rather than stacking on it.
            chrome.hidesTabBar = selecting
        }
        .onDisappear { chrome.hidesTabBar = false }
        .task { await load() }
    }

    // MARK: - Mosaic

    private var mosaicScreen: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 0) {
                Color.clear.frame(height: 0).readsScrollOffset(in: "library")

                if !gallery.isSelecting {
                    CollapsingTitleHeader(
                        eyebrow: "Household library",
                        title: "Library",
                        offset: scrollOffset
                    )
                    chipHeader
                        .padding(.bottom, 14)
                }

                if gallery.isLoading {
                    mosaicSkeleton
                } else if gallery.days.isEmpty {
                    emptyState
                } else {
                    ForEach(gallery.days) { day in
                        daySection(day)
                    }
                }

                if gallery.isLoadingMore {
                    ProgressView()
                        .tint(KindredTheme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                }

                Color.clear.frame(height: gallery.isSelecting ? 110 : 100)
            }
        }
        .coordinateSpace(name: "library")
        .onPreferenceChange(ScrollOffsetKey.self) { scrollOffset = $0 }
        .safeAreaInset(edge: .top, spacing: 0) {
            if gallery.isSelecting { selectionNavBar }
        }
        .refreshable {
            // Pull-to-refresh triggers a sync.
            await SyncManager.shared.syncNewPhotos()
            await load()
        }
    }

    private var chipHeader: some View {
        KindredChipRow(
            items: Scope.allCases,
            label: { $0.rawValue },
            count: { scope in
                switch scope {
                case .videos: return counts?.videos
                default: return nil
                }
            },
            selection: $scope
        )
    }

    private func daySection(_ day: PhotoDay) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredDayHeader(
                title: day.title,
                place: day.countLabel,
                trailing: gallery.isSelecting ? nil : "Select",
                trailingAction: gallery.isSelecting ? nil : { gallery.beginSelecting() }
            )
            // Long-press a day header takes the whole day.
            .contentShape(Rectangle())
            .onLongPressGesture { gallery.selectDay(day) }
            .accessibilityHint("Long press to select this whole day")

            MosaicGrid(
                photos: day.photos,
                columns: columns,
                rowHeight: rowHeight,
                spacing: tileGap,
                isSelecting: gallery.isSelecting,
                selection: gallery.selection,
                onTap: { photo in
                    if gallery.isSelecting {
                        gallery.toggleSelection(photo)
                    } else {
                        viewing = photo
                    }
                },
                onLongPress: { photo in gallery.beginSelecting(with: photo) },
                onSweep: { gallery.addToSelection($0) }
            )
            .padding(.horizontal, tileGap)
            .padding(.bottom, 14)

            if let last = day.photos.last {
                Color.clear
                    .frame(height: 1)
                    .task { await gallery.loadMoreIfNeeded(currentItem: last) }
            }
        }
    }

    private var mosaicSkeleton: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(0..<2, id: \.self) { _ in
                MosaicLayout(columns: columns, rowHeight: rowHeight, spacing: tileGap) {
                    ForEach(0..<9, id: \.self) { _ in
                        Rectangle().fill(KindredTheme.tile)
                    }
                }
                .padding(.horizontal, tileGap)
            }
        }
        .accessibilityHidden(true)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            KindredEyebrow(text: "Nothing here yet")
            Text("Your library is empty.")
                .font(.kindredH3)
                .foregroundStyle(KindredTheme.ink)
            Text("Photos appear here once they have been backed up to your household server.")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.inkBody)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 40)
        .padding(.top, 70)
    }

    // MARK: - Select mode nav bar

    private var selectionNavBar: some View {
        HStack(spacing: 10) {
            Button("Done") {
                withAnimation(KindredTheme.ease(0.2)) { gallery.endSelecting() }
            }
            .font(.body(15, weight: .bold, relativeTo: .headline))
            .foregroundStyle(KindredTheme.accent)

            Spacer()

            Text(gallery.selectionTitle)
                .font(.display(15, weight: .semibold, relativeTo: .headline))
                .foregroundStyle(KindredTheme.ink)
                .accessibilityAddTraits(.isHeader)

            Spacer()

            Button("Select all") { gallery.selectAll() }
                .font(.body(15, weight: .semibold, relativeTo: .headline))
                .foregroundStyle(KindredTheme.accent)
        }
        .padding(.horizontal, KindredTheme.gutter)
        .padding(.vertical, 12)
        .background(KindredTheme.bg)
        .overlay(alignment: .bottom) {
            Rectangle().fill(KindredTheme.hairline).frame(height: 1)
        }
    }

    // MARK: - Data

    private func load() async {
        async let page: () = gallery.reload()
        async let libraryCounts = try? await APIClient.shared.libraryCounts()
        _ = await page
        counts = await libraryCounts
    }
}

// MARK: - Selection bar

/// Replaces the tab bar while a selection is live: Share / Album / Favorite /
/// Remove, with Remove in the danger ink.
struct SelectionActionBar: View {
    let onShare: () -> Void
    let onAlbum: () -> Void
    let onFavorite: () -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                action("square.and.arrow.up", "Share", KindredTheme.accent, onShare)
                action("folder.badge.plus", "Album", KindredTheme.inkSecondary, onAlbum)
                action("heart", "Favorite", KindredTheme.inkSecondary, onFavorite)
                action("trash", "Remove", KindredTheme.dangerText, onRemove)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
        }
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(KindredTheme.chrome)
                .overlay(alignment: .top) {
                    Rectangle().fill(KindredTheme.hairline).frame(height: 1)
                }
                .ignoresSafeArea(edges: .bottom)
        )
    }

    private func action(
        _ icon: String, _ label: String, _ tint: Color, _ perform: @escaping () -> Void
    ) -> some View {
        Button(action: perform) {
            VStack(spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 21, weight: .regular))
                Text(label)
                    .font(.body(10, weight: .semibold, relativeTo: .caption2))
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
