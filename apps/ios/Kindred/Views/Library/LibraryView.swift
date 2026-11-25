import SwiftUI

/// The Library tab and its day-based photo selection.
struct LibraryView: View {

    enum Scope: String, CaseIterable, Identifiable {
        case all = "All"
        case people = "People"
        case animals = "Pets"
        case videos = "Videos"

        var id: String { rawValue }

        var symbol: String? {
            switch self {
            case .all: nil
            case .people: "person"
            case .animals: "pawprint"
            case .videos: "play"
            }
        }
    }

    @State private var scope: Scope = .all
    @State private var gallery = GalleryViewModel()
    @State private var viewing: LibraryPhoto?
    @State private var showAlbumPicker = false
    @State private var showSelectionReview = false
    @State private var showUpload = false
    @State private var chrome = KindredChrome.shared
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var expanded: Bool { KindredTabletLayout.isExpanded(horizontalSizeClass) }
    private var canvasWidth: CGFloat { expanded ? 1440 : .infinity }
    private var gutter: CGFloat { expanded ? KindredTabletLayout.gutter : KindredTheme.gutter }
    private var tileGap: CGFloat { expanded ? 7 : 6 }

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                let available = min(geometry.size.width, canvasWidth) - 2 * gutter
                let columns = expanded ? KindredTabletLayout.galleryColumns(in: available, spacing: tileGap) : 2
                Group {
                    switch scope {
                    case .all:
                        mosaicScreen(columns: columns, width: available)
                    case .people:
                        PeopleView { chipHeader }
                    case .animals:
                        ClusterGridView(category: .pets) { chipHeader }
                    case .videos:
                        VideosView { chipHeader }
                    }
                }
                .frame(maxWidth: canvasWidth)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .kindredPaperBackground()
            .safeAreaInset(edge: .top, spacing: 0) {
                if !gallery.isSelecting {
                    KindredAppBar(actionIcon: "plus", actionLabel: SessionManager.shared.isReadOnlyReview ? "Try importing photos on this iPhone" : "Add photos to the library", horizontalInset: gutter) {
                        showUpload = true
                    }
                    .frame(maxWidth: canvasWidth)
                    .frame(maxWidth: .infinity)
                    .background(KindredTheme.bg)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if gallery.isSelecting {
                    SelectionActionBar(
                        gutter: gutter, canvasWidth: canvasWidth,
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
                    PhotoViewerView(photos: gallery.photos, initial: photo)
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

    private func mosaicScreen(columns: Int, width: CGFloat) -> some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 0) {
                if !gallery.isSelecting {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Library")
                            .font(.display(expanded ? 42 : 34, weight: .bold, relativeTo: .largeTitle))
                            .foregroundStyle(KindredTheme.ink)
                            .accessibilityAddTraits(.isHeader)
                        Spacer()
                        if !expanded, !gallery.photos.isEmpty { selectButton }
                    }
                    .padding(.horizontal, gutter)
                    .padding(.top, 8)
                    .padding(.bottom, expanded ? 7 : 13)
                    chipHeader.padding(.bottom, expanded ? 14 : 20)
                }

                if gallery.isLoading {
                    mosaicSkeleton(columns: columns)
                } else if gallery.days.isEmpty {
                    if gallery.error != nil {
                        loadError
                    } else {
                        emptyState
                    }
                } else if expanded {
                    ForEach(journalSections) { section in
                        journalSection(section, columns: columns, width: width)
                    }
                } else {
                    ForEach(gallery.days) { day in
                        daySection(day, columns: columns)
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

    private var selectButton: some View {
        Button("Select") { gallery.beginSelecting() }
            .font(.body(15, weight: .semibold, relativeTo: .body))
            .foregroundStyle(KindredTheme.accent)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
            .accessibilityIdentifier("library.select")
    }

    private var chipHeader: some View {
        HStack(spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Scope.allCases) { item in
                        Button {
                            scope = item
                        } label: {
                            HStack(spacing: 6) {
                                if expanded, let symbol = item.symbol {
                                    Image(systemName: symbol).accessibilityHidden(true)
                                }
                                Text(expanded && item == .all ? "All Photos" : item.rawValue)
                            }
                            .font(.body(15, weight: scope == item && expanded ? .semibold : .medium, relativeTo: .body))
                            .foregroundStyle(scope == item && expanded ? KindredTheme.accent : KindredTheme.ink)
                            .padding(.horizontal, 16)
                            .frame(minHeight: 36)
                            .background(scope == item ? KindredTheme.accent.opacity(expanded ? 0.2 : 0.34)
                                        : expanded ? KindredTheme.fillStrong : KindredTheme.fillStrongest, in: Capsule())
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(scope == item ? .isSelected : [])
                    }
                }
            }
            if expanded, scope == .all, !gallery.photos.isEmpty { selectButton }
        }
        .padding(.horizontal, gutter)
    }

    private struct JournalSection: Identifiable {
        let id: String
        let month: Date?
        let isSingleDay: Bool
        var days: [PhotoDay]

        var title: String {
            if isSingleDay, let date = days.first?.date {
                return date.formatted(.dateTime.month(.wide).day())
            }
            return month?.formatted(.dateTime.month(.wide).year()) ?? "Undated"
        }
    }

    private var journalSections: [JournalSection] {
        var sections: [JournalSection] = []
        for day in gallery.days {
            let month = day.date.flatMap { Calendar.current.dateInterval(of: .month, for: $0)?.start }
            let hasFullDay = day.date != nil && day.photos.count >= 3
            if let last = sections.last, last.month == month, !last.isSingleDay, !hasFullDay {
                sections[sections.count - 1].days.append(day)
            } else {
                sections.append(JournalSection(id: day.id, month: month, isSingleDay: hasFullDay, days: [day]))
            }
        }
        return sections
    }

    private func journalSection(_ section: JournalSection, columns: Int, width: CGFloat) -> some View {
        let photos = section.days.flatMap(\.photos)
        let labels = section.days.reduce(into: [String: String]()) { result, day in
            if !section.isSingleDay, let photo = day.photos.first, let date = day.date {
                result[photo.id] = date.formatted(.dateTime.month(.abbreviated).day())
            }
        }
        return VStack(alignment: .leading, spacing: 9) {
            Text(section.title)
                .font(.display(29, weight: .bold, relativeTo: .title2))
                .foregroundStyle(KindredTheme.ink)
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, minHeight: gallery.isSelecting ? 44 : nil, alignment: .leading)
                .contentShape(Rectangle())
                .if(section.isSingleDay) { heading in
                    heading.onLongPressGesture { gallery.selectDay(section.days[0]) }
                        .accessibilityAction(named: Text("Select this day")) { gallery.selectDay(section.days[0]) }
                }
            photoGrid(photos, columns: columns, journalWidth: width, labels: labels) { photo in
                if let day = section.days.first(where: { $0.photos.first?.id == photo.id }) {
                    gallery.selectDay(day)
                }
            }
        }
        .padding(.horizontal, gutter)
        .padding(.bottom, 21)
    }

    private func daySection(_ day: PhotoDay, columns: Int) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(day.date?.formatted(date: .long, time: .omitted) ?? "Undated")
                .font(.display(20, weight: .bold, relativeTo: .title3))
                .foregroundStyle(KindredTheme.ink)
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onLongPressGesture { gallery.selectDay(day) }
                .accessibilityAction(named: Text("Select this day")) { gallery.selectDay(day) }
            photoGrid(day.photos, columns: columns)
        }
        .padding(.horizontal, gutter)
        .padding(.bottom, 22)
    }

    private func photoGrid(
        _ photos: [LibraryPhoto], columns: Int, journalWidth: CGFloat? = nil, labels: [String: String] = [:],
        onSelectDate: ((LibraryPhoto) -> Void)? = nil
    ) -> some View {
        VStack(spacing: 0) {
            MosaicGrid(
                photos: photos,
                columns: columns,
                spacing: tileGap,
                isSelecting: gallery.isSelecting,
                selection: gallery.selection,
                squareTileRadius: 12,
                journalWidth: journalWidth,
                dateLabel: { labels[$0.id] },
                onSelectDate: gallery.isSelecting ? onSelectDate : nil,
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
            if let last = photos.last {
                Color.clear.frame(height: 1)
                    .task(id: last.id) { await gallery.loadMoreIfNeeded(currentItem: last) }
            }
        }
    }

    private func mosaicSkeleton(columns: Int) -> some View {
        let tracks = Array(repeating: GridItem(.flexible(), spacing: tileGap), count: columns)
        return LazyVGrid(columns: tracks, spacing: tileGap) {
            ForEach(0..<(columns * 3), id: \.self) { _ in
                RoundedRectangle(cornerRadius: 12)
                    .fill(KindredTheme.tile)
                    .aspectRatio(1, contentMode: .fit)
            }
        }
        .padding(.horizontal, gutter)
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
        .padding(.horizontal, gutter)
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
    let gutter: CGFloat
    let canvasWidth: CGFloat
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
        .padding(.horizontal, gutter)
        .padding(.vertical, 10)
        .frame(maxWidth: canvasWidth)
        .frame(maxWidth: .infinity)
        .background(KindredTheme.chrome.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Divider() }
    }
}
