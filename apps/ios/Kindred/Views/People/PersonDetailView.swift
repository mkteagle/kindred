import SwiftUI

/// Screen 05 — Person detail. A 300pt full-bleed cover under a top-and-bottom
/// scrim, translucent nav actions over it, then the name block and a recent grid.
struct PersonDetailView: View {
    let cluster: ClusterSummary
    let category: ClusterCategory

    @State private var gallery = GalleryViewModel()
    @State private var viewing: LibraryPhoto?
    @State private var showRename = false
    @State private var showDismissConfirm = false
    @State private var showTogether = false
    @State private var slideshow = false
    @State private var nameInput = ""
    @State private var name: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var columns: [GridItem] {
        let count = horizontalSizeClass == .regular ? 5 : 3
        return Array(repeating: GridItem(.flexible(), spacing: KindredTheme.tileGap), count: count)
    }

    private var displayName: String { name ?? cluster.label ?? "Unnamed" }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                cover
                nameBlock
                recentGrid
                Color.clear.frame(height: 100)
            }
        }
        .background(KindredTheme.bg.ignoresSafeArea())
        .ignoresSafeArea(edges: .top)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .top) { navActions }
        .fullScreenCover(item: $viewing) { photo in
            PhotoViewerView(photos: gallery.photos, initial: photo)
        }
        .fullScreenCover(isPresented: $slideshow) {
            SlideshowView(photos: gallery.photos, title: displayName)
        }
        .sheet(isPresented: $showRename) {
            RenameSheet(
                nameInput: $nameInput,
                entityType: String(category.displayName.lowercased().dropLast()),
                onSave: { newName in
                    showRename = false
                    guard !newName.isEmpty else { return }
                    Task { await rename(to: newName) }
                },
                onCancel: { showRename = false }
            )
            .presentationDetents([.height(320)])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showDismissConfirm) {
            DismissGroupSheet(
                onConfirm: {
                    showDismissConfirm = false
                    Task {
                        try? await APIClient.shared.dismissCluster(
                            DismissRequest(cluster_id: cluster.id, category: category.rawValue)
                        )
                        dismiss()
                    }
                },
                onCancel: { showDismissConfirm = false }
            )
            .presentationDetents([.height(340)])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: $showTogether) {
            TogetherPickerView()
        }
        .task {
            gallery.source = .cluster(id: cluster.id, category: category.rawValue)
            await gallery.reload()
        }
    }

    // MARK: - Cover

    private var cover: some View {
        ZStack(alignment: .bottomLeading) {
            Group {
                if let url = cluster.photo_url ?? cluster.thumb_url,
                   DemoDataProvider.isDemoURL(url) {
                    DemoThumbnailView(urlString: url, cornerRadius: 0)
                } else if let first = gallery.photos.first {
                    KindredThumbnail(photo: first, variant: .preview)
                } else {
                    KindredTheme.tile
                }
            }
            .frame(height: 300)
            .frame(maxWidth: .infinity)
            .clipped()

            KindredTheme.coverScrim
                .frame(height: 300)
        }
        .frame(height: 300)
        .accessibilityHidden(true)
    }

    private var navActions: some View {
        HStack(spacing: 16) {
            Button {
                dismiss()
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 19, weight: .semibold))
                    Text(category.displayName)
                        .font(.body(15, weight: .semibold, relativeTo: .headline))
                }
            }
            .accessibilityLabel("Back to \(category.displayName)")

            Spacer()

            Button {
                nameInput = cluster.label ?? ""
                showRename = true
            } label: {
                Image(systemName: "pencil")
                    .font(.system(size: 19, weight: .regular))
            }
            .accessibilityLabel("Rename")

            Menu {
                Button("Rename") {
                    nameInput = cluster.label ?? ""
                    showRename = true
                }
                Button("Together with…") { showTogether = true }
                Button("Not a person", role: .destructive) { showDismissConfirm = true }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 19, weight: .regular))
            }
            .accessibilityLabel("More actions")
        }
        .foregroundStyle(KindredTheme.ink)
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .safeAreaPadding(.top)
    }

    // MARK: - Name block

    private var nameBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let since = sinceLabel {
                KindredEyebrow(text: since, color: KindredTheme.amber)
                    .padding(.bottom, 8)
            }

            Text(displayName)
                .font(.display(34, weight: .bold, relativeTo: .largeTitle))
                .tracking(-0.34)
                .italic(cluster.label == nil && name == nil)
                .foregroundStyle(KindredTheme.ink)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, 6)

            Text(metaLine)
                .font(.mono(11))
                .foregroundStyle(KindredTheme.inkSecondary)

            HStack(spacing: 8) {
                KindredButton(title: "Slideshow", style: .primary, isSmall: true) {
                    slideshow = true
                }
                KindredButton(title: "Together with…", style: .ghost, isSmall: true) {
                    showTogether = true
                }
            }
            .padding(.top, 14)
        }
        .padding(.horizontal, KindredTheme.gutter)
        .padding(.top, -110)   // the block sits over the cover's lower scrim
        .padding(.bottom, 18)
    }

    /// "SINCE MARCH 2019" — the earliest date in the loaded page.
    /// The cluster summary carries no first-seen date, so this reflects what
    /// has been fetched rather than the whole history.
    /// TODO: a `first_seen` field on /clusters/{category}/summary would make
    /// this exact instead of approximate.
    private var sinceLabel: String? {
        guard let earliest = gallery.photos.compactMap(\.takenAt).min() else { return nil }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMMM yyyy")
        return "Since \(formatter.string(from: earliest))"
    }

    private var metaLine: String {
        let videos = gallery.photos.filter(\.isVideo).count
        var parts = ["\(cluster.photo_count.formatted()) photos"]
        if videos > 0 { parts.append("\(videos) videos") }
        // TODO: place count needs reverse-geocoded EXIF on the cluster; the
        // handoff forbids inventing a place, so it is left out rather than guessed.
        return parts.joined(separator: " · ")
    }

    // MARK: - Recent

    private var recentGrid: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("Recent")
                    .font(.display(15, weight: .semibold, relativeTo: .headline))
                    .foregroundStyle(KindredTheme.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if gallery.photos.count > 12 {
                    NavigationLink("See all") {
                        ClusterAllPhotosView(cluster: cluster, category: category)
                    }
                    .font(.kindredMeta)
                    .foregroundStyle(KindredTheme.accent)
                }
            }
            .padding(.horizontal, KindredTheme.gutter)

            if gallery.isLoading {
                ProgressView()
                    .tint(KindredTheme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
            } else {
                LazyVGrid(columns: columns, spacing: KindredTheme.tileGap) {
                    ForEach(gallery.photos.prefix(12)) { photo in
                        SquarePhotoTile(photo: photo)
                            .onTapGesture { viewing = photo }
                    }
                }
                .padding(.horizontal, KindredTheme.tileGap)
            }
        }
    }

    private func rename(to newName: String) async {
        try? await APIClient.shared.labelCluster(
            LabelRequest(cluster_id: cluster.id, label: newName, category: category.rawValue)
        )
        name = newName
    }
}

// MARK: - See all

/// The whole cluster as one mosaic, behind the detail screen's "See all".
struct ClusterAllPhotosView: View {
    let cluster: ClusterSummary
    let category: ClusterCategory

    @State private var gallery = GalleryViewModel()
    @State private var viewing: LibraryPhoto?

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(gallery.days) { day in
                    KindredDayHeader(title: day.title, place: day.countLabel)
                    MosaicGrid(photos: day.photos, onTap: { viewing = $0 })
                        .padding(.horizontal, KindredTheme.tileGap)
                        .padding(.bottom, 14)
                }
                Color.clear.frame(height: 100)
            }
        }
        .background(KindredTheme.bg.ignoresSafeArea())
        .navigationTitle(cluster.label ?? "Unnamed")
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $viewing) { photo in
            PhotoViewerView(photos: gallery.photos, initial: photo)
        }
        .task {
            gallery.source = .cluster(id: cluster.id, category: category.rawValue)
            await gallery.reload()
        }
    }
}
