import SwiftUI

struct HomeView: View {
    var isActive = true
    var onNavigateToTab: ((Int) -> Void)? = nil

    @State private var favorites: [LibraryPhoto]?
    @State private var albums: [Album]?
    @State private var favoritesFailed = false
    @State private var albumsFailed = false
    @State private var inboxVM = InboxViewModel()
    @ObservedObject private var readState = NotificationReadState.shared
    @State private var showInbox = false
    @State private var viewing: LibraryPhoto?
    @State private var favoritesRequest = UUID()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 2)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 29) {
                    favoritesSection
                    albumsSection
                }
                .padding(.horizontal, KindredTheme.gutter)
                .padding(.top, 7)
                .padding(.bottom, 28)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
                .safeAreaInset(edge: .top, spacing: 0) {
                    KindredAppBar(
                        unreadCount: inboxVM.unreadCount(readState: readState),
                        onAction: { showInbox = true }
                    )
                    .frame(maxWidth: 560)
                    .frame(maxWidth: .infinity)
                    .background(KindredTheme.bg)
                }
            }
            .scrollIndicators(.hidden)
            .accessibilityIdentifier("home.scrollView")
            .kindredPaperBackground()
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(item: $viewing, onDismiss: {
                Task { await loadFavorites() }
            }) { photo in
                let featured = favorites ?? []
                PhotoViewerView(photos: featured.contains(photo) ? featured : [photo],
                                initial: photo, startsFavorited: true)
            }
            .sheet(isPresented: $showInbox) {
                NotificationInboxView(onNavigateToTab: onNavigateToTab)
            }
            .refreshable { await load() }
        }
        .task(id: isActive) {
            if isActive { await load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .kindredFavoriteChanged).receive(on: RunLoop.main)) { _ in
            if isActive && viewing == nil { Task { await loadFavorites() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            if isActive { Task { await load() } }
        }
    }

    private var favoritesSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                heading("Favorites")
                    .accessibilityIdentifier("home.favoritesHeading")
                Spacer(minLength: 8)
                NavigationLink {
                    HomeGalleryView(title: "Favorites", source: .favorites)
                } label: {
                    Text("See all")
                        .font(.body(15, weight: .semibold, relativeTo: .body))
                        .foregroundStyle(KindredTheme.accent)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("See all favorites")
            }

            if let favorites, !favorites.isEmpty {
                LazyVGrid(columns: columns, spacing: 6) {
                    ForEach(favorites) { photo in
                        Button {
                            viewing = photo
                        } label: {
                            PhotoTile(photo: photo, cornerRadius: 12)
                                .aspectRatio(1, contentMode: .fit)
                                .overlay(alignment: .topTrailing) {
                                    Image(systemName: "heart.fill")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(.white)
                                        .shadow(color: .black.opacity(0.45), radius: 3, y: 1)
                                        .padding(8)
                                        .accessibilityHidden(true)
                                }
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else if favorites == nil && !favoritesFailed {
                skeleton(count: 4, aspectRatio: 1)
                    .accessibilityLabel("Loading favorites")
            } else if !favoritesFailed {
                Text("Tap the heart on a photo to see it here.")
                    .font(.kindredBody)
                    .foregroundStyle(KindredTheme.inkSecondary)
            }

            if favoritesFailed {
                retry("Couldn’t load favorites. Try again", action: loadFavorites)
            }
        }
    }

    private var albumsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            heading("Albums")
            if let albums, !albums.isEmpty {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
                    ForEach(albums, id: \.id) { album in
                        if let id = album.id {
                            NavigationLink {
                                HomeGalleryView(title: album.name, source: .album(id: id))
                            } label: {
                                HomeAlbumTile(album: album, albumID: id)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            } else if albums == nil && !albumsFailed {
                skeleton(count: 2, aspectRatio: 1.2)
                    .accessibilityLabel("Loading albums")
            } else if !albumsFailed {
                Text("Your albums will appear here.")
                    .font(.kindredBody)
                    .foregroundStyle(KindredTheme.inkSecondary)
            }

            if albumsFailed {
                retry("Couldn’t load albums. Try again", action: loadAlbums)
            }
        }
    }

    private func heading(_ title: String) -> some View {
        Text(title)
            .font(.display(28, weight: .bold, relativeTo: .largeTitle))
            .foregroundStyle(KindredTheme.ink)
            .accessibilityAddTraits(.isHeader)
    }

    private func skeleton(count: Int, aspectRatio: CGFloat) -> some View {
        LazyVGrid(columns: columns, spacing: 6) {
            ForEach(0..<count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 12)
                    .fill(KindredTheme.tile)
                    .aspectRatio(aspectRatio, contentMode: .fit)
            }
        }
        .accessibilityElement(children: .ignore)
    }

    private func retry(_ title: String, action: @escaping () async -> Void) -> some View {
        Button(title) { Task { await action() } }
            .font(.kindredCaption.weight(.semibold))
            .foregroundStyle(KindredTheme.accent)
            .frame(minHeight: 44, alignment: .leading)
            .multilineTextAlignment(.leading)
    }

    private func load() async {
        async let favoriteTask: Void = loadFavorites()
        async let albumTask: Void = loadAlbums()
        async let inboxTask: Void = inboxVM.loadSyncHistory()
        _ = await (favoriteTask, albumTask, inboxTask)
    }

    private func loadFavorites() async {
        let request = UUID()
        favoritesRequest = request
        do {
            let page = DemoDataProvider.shared.isActive
                ? DemoDataProvider.shared.favoritesPage()
                : try await APIClient.shared.favorites(media: .photo, limit: 4)
            guard !Task.isCancelled, favoritesRequest == request else { return }
            withAnimation(reduceMotion ? nil : KindredTheme.ease(0.18)) {
                favorites = Array(page.photos.prefix(4))
                favoritesFailed = false
            }
        } catch where !Task.isCancelled && favoritesRequest == request {
            favoritesFailed = true
        } catch {}
    }

    private func loadAlbums() async {
        do {
            let result = DemoDataProvider.shared.isActive
                ? DemoDataProvider.shared.homeAlbums
                : try await APIClient.shared.albums()
            guard !Task.isCancelled else { return }
            albums = result.filter { $0.id != nil }
            albumsFailed = false
        } catch where !Task.isCancelled {
            albumsFailed = true
        } catch {}
    }
}

private struct HomeAlbumTile: View {
    let album: Album
    let albumID: String
    @State private var cover: LibraryPhoto?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(KindredTheme.tile)
                if let cover {
                    KindredThumbnail(photo: cover, cornerRadius: 12)
                }
            }
            .aspectRatio(1.2, contentMode: .fit)
            .clipShape(.rect(cornerRadius: 12))
            .accessibilityHidden(true)

            Text(album.name)
                .font(.body(16, weight: .semibold, relativeTo: .body))
                .foregroundStyle(KindredTheme.ink)
                .lineLimit(1)
        }
        .accessibilityLabel(album.name)
        .task(id: album.photo_count) {
            guard album.photo_count > 0 else { cover = nil; return }
            if DemoDataProvider.shared.isActive {
                cover = DemoDataProvider.shared.albumPage(id: albumID).photos.first
            } else if let page = try? await APIClient.shared.libraryPhotos(albumID: albumID, limit: 1),
                      !Task.isCancelled {
                cover = page.photos.first
            }
        }
    }
}

private struct HomeGalleryView: View {
    let title: String
    let source: GalleryViewModel.Source
    @State private var gallery = GalleryViewModel()
    @State private var viewing: LibraryPhoto?
    @State private var favoritesChanged = false

    var body: some View {
        ScrollView {
            if (gallery.isLoading || gallery.hasMore) && gallery.photos.isEmpty && gallery.error == nil {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(32)
            } else if gallery.photos.isEmpty {
                if gallery.error != nil {
                    ContentUnavailableView {
                        Label("Couldn’t load photos", systemImage: "photo")
                    } actions: {
                        Button("Try again") { Task { await gallery.reload() } }
                    }
                } else {
                    ContentUnavailableView("No photos yet", systemImage: "photo")
                }
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 3), spacing: 3) {
                    ForEach(gallery.photos) { photo in
                        Button {
                            viewing = photo
                        } label: {
                            PhotoTile(photo: photo)
                                .aspectRatio(1, contentMode: .fit)
                        }
                        .buttonStyle(.plain)
                        .task { await gallery.loadMoreIfNeeded(currentItem: photo) }
                    }
                }
                .padding(3)
                if gallery.isLoadingMore {
                    ProgressView().padding()
                }
                if gallery.error != nil {
                    Button("Couldn’t load all photos. Reload") { Task { await gallery.reload() } }
                        .padding()
                }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .kindredPaperBackground()
        .fullScreenCover(item: $viewing, onDismiss: {
            guard favoritesChanged else { return }
            favoritesChanged = false
            Task { await gallery.reload() }
        }) { photo in
            PhotoViewerView(photos: gallery.photos, initial: photo, startsFavorited: source == .favorites)
        }
        .task {
            gallery.source = source
            await gallery.reload()
        }
        .refreshable { await gallery.reload() }
        .onReceive(NotificationCenter.default.publisher(for: .kindredFavoriteChanged).receive(on: RunLoop.main)) { _ in
            guard source == .favorites else { return }
            if viewing != nil { favoritesChanged = true }
            else { Task { await gallery.reload() } }
        }
    }
}
