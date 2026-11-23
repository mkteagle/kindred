import SwiftUI

/// The Library tab and its day-based photo selection.
struct LibraryView: View {

    enum Scope: String, CaseIterable, Identifiable {
        case all = "All"
        case people = "People"
        case animals = "Pets"
        case videos = "Videos"

        var id: String { rawValue }
    }

    @State private var scope: Scope = .all
    @State private var gallery = GalleryViewModel()
    @State private var viewing: LibraryPhoto?
    @State private var showAlbumPicker = false
    @State private var showSelectionReview = false
    @State private var showUpload = false
    @State private var chrome = KindredChrome.shared
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isIPad: Bool { horizontalSizeClass == .regular }
    private var columns: Int { isIPad ? 4 : 2 }
    private let tileGap: CGFloat = 6

    var body: some View {
        NavigationStack {
            Group {
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
            }
            .kindredPaperBackground()
            .safeAreaInset(edge: .top, spacing: 0) {
                if !gallery.isSelecting {
                    if SessionManager.shared.isReadOnlyReview {
                        KindredAppBar(actionIcon: "plus", actionLabel: "Try importing photos on this iPhone") {
                            showUpload = true
                        }
                        .background(KindredTheme.bg)
                    } else {
                        KindredAppBar(actionIcon: "plus", actionLabel: "Add photos to the library") {
                            showUpload = true
                        }
                        .background(KindredTheme.bg)
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if gallery.isSelecting {
                    SelectionActionBar(
                        isEmpty: gallery.selection.isEmpty,
                        onReview: { showSelectionReview = true },
                        onAlbum: { showAlbumPicker = true },
                        onFavorite: { Task { await gallery.favoriteSelection() } }
                    )
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(item: $viewing) { photo in
                if photo.isVideo {
                    VideoPlayerView(video: photo)
                } else {
                    PhotoViewerView(photos: gallery.photos, initial: photo) {
                        Task { await gallery.reload() }
                    }
                }
            }
            .sheet(isPresented: $showAlbumPicker) {
                AlbumPickerSheet(photoIDs: Array(gallery.selection)) { reference in
                    Task { await gallery.addSelection(toAlbum: reference) }
                }
            }
            .sheet(isPresented: $showSelectionReview) {
                SelectedMediaReview(photos: gallery.selectedPhotos)
            }
            .sheet(isPresented: $showUpload) {
                if SessionManager.shared.isReadOnlyReview {
                    ReviewPhotoImportView()
                } else {
                    UploadSheetView()
                }
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
                if !gallery.isSelecting {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Library")
                            .font(.display(34, weight: .bold, relativeTo: .largeTitle))
                            .foregroundStyle(KindredTheme.ink)
                            .accessibilityAddTraits(.isHeader)
                        Spacer()
                        if !gallery.photos.isEmpty {
                            Button("Select") { gallery.beginSelecting() }
                                .font(.body(15, weight: .semibold, relativeTo: .body))
                                .foregroundStyle(KindredTheme.accent)
                                .padding(.vertical, 8)
                                .accessibilityIdentifier("library.select")
                        }
                    }
                    .padding(.horizontal, KindredTheme.gutter)
                    .padding(.top, 8)
                    .padding(.bottom, 13)
                    chipHeader.padding(.bottom, 20)
                }

                if gallery.isLoading {
                    mosaicSkeleton
                } else if gallery.days.isEmpty {
                    if gallery.error != nil {
                        loadError
                    } else {
                        emptyState
                    }
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

                Color.clear.frame(height: 28)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if gallery.isSelecting { selectionNavBar }
        }
        .refreshable {
            if !gallery.isSelecting { await load() }
        }
    }

    private var chipHeader: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Scope.allCases) { item in
                    Button {
                        scope = item
                    } label: {
                        Text(item.rawValue)
                            .font(.body(15, weight: .medium, relativeTo: .body))
                            .foregroundStyle(KindredTheme.ink)
                            .padding(.horizontal, 16)
                            .frame(minHeight: 36)
                            .background(scope == item ? KindredTheme.accent.opacity(0.34) : KindredTheme.fillStrongest,
                                        in: Capsule())
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(scope == item ? .isSelected : [])
                }
            }
            .padding(.horizontal, KindredTheme.gutter)
        }
    }

    private func daySection(_ day: PhotoDay) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(day.date?.formatted(date: .long, time: .omitted) ?? "Undated")
                .font(.display(20, weight: .bold, relativeTo: .title3))
                .foregroundStyle(KindredTheme.ink)
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onLongPressGesture { gallery.selectDay(day) }
                .accessibilityAction(named: Text("Select this day")) { gallery.selectDay(day) }

            MosaicGrid(
                photos: day.photos,
                columns: columns,
                spacing: tileGap,
                isSelecting: gallery.isSelecting,
                selection: gallery.selection,
                squareTileRadius: 12,
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
            if let last = day.photos.last {
                Color.clear.frame(height: 1)
                    .task(id: last.id) { await gallery.loadMoreIfNeeded(currentItem: last) }
            }
        }
        .padding(.horizontal, KindredTheme.gutter)
        .padding(.bottom, 22)
    }

    private var mosaicSkeleton: some View {
        let tracks = Array(repeating: GridItem(.flexible(), spacing: tileGap), count: columns)
        return LazyVGrid(columns: tracks, spacing: tileGap) {
            ForEach(0..<(columns * 3), id: \.self) { _ in
                RoundedRectangle(cornerRadius: 12)
                    .fill(KindredTheme.tile)
                    .aspectRatio(1, contentMode: .fit)
            }
        }
        .padding(.horizontal, KindredTheme.gutter)
        .accessibilityHidden(true)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
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

    private var loadError: some View {
        VStack(spacing: 12) {
            Text("Couldn’t load your library.")
                .font(.kindredH3)
                .foregroundStyle(KindredTheme.ink)
                .multilineTextAlignment(.center)
            KindredButton(title: "Try again", style: .ghost) {
                Task { await load() }
            }
            .accessibilityIdentifier("library.retry")
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

            Button(gallery.hasMore ? "Select loaded" : "Select all") { gallery.selectAll() }
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
        await gallery.reload()
    }
}

private struct SelectionActionBar: View {
    let isEmpty: Bool
    let onReview: () -> Void
    let onAlbum: () -> Void
    let onFavorite: () -> Void

    var body: some View {
        HStack(spacing: 18) {
            Button(action: onAlbum) { Label("Album", systemImage: "folder.badge.plus").labelStyle(.iconOnly) }
                .accessibilityLabel("Add to album")
            Button(action: onFavorite) { Label("Favorite", systemImage: "heart").labelStyle(.iconOnly) }
                .accessibilityLabel("Favorite selected items")
            KindredButton(title: "Review selection", isFullWidth: true, action: onReview)
                .accessibilityIdentifier("library.reviewSelection")
        }
        .font(.system(size: 20))
        .foregroundStyle(KindredTheme.accent)
        .buttonStyle(.borderless)
        .disabled(isEmpty)
        .padding(.horizontal, KindredTheme.gutter)
        .padding(.vertical, 10)
        .background(KindredTheme.chrome.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Divider() }
    }
}
