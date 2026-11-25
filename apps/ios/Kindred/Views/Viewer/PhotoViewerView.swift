import SwiftUI

/// A photo-first viewer with a filmstrip and three primary actions.
struct PhotoViewerView: View {
    let photos: [LibraryPhoto]
    let initial: LibraryPhoto
    let startsFavorited: Bool

    @Environment(\.displayScale) private var displayScale
    @State private var index: Int
    @State private var favoriteStates: [String: Bool] = [:]
    @State private var favoriteChecksFinished: Set<String> = []
    @State private var favoriteRequests: Set<String> = []
    @State private var dragOffset: CGFloat = 0
    @State private var zoom: CGFloat = 1
    @State private var showInfo = false
    @State private var showShare = false
    @State private var playing: LibraryPhoto?
    @Environment(\.dismiss) private var dismiss

    init(photos: [LibraryPhoto], initial: LibraryPhoto, startsFavorited: Bool = false) {
        self.initial = initial
        self.startsFavorited = startsFavorited
        if let index = photos.firstIndex(where: { $0.id == initial.id }) {
            self.photos = photos
            _index = State(initialValue: index)
        } else {
            self.photos = [initial] + photos
            _index = State(initialValue: 0)
        }
    }

    private var current: LibraryPhoto {
        guard photos.indices.contains(index) else { return initial }
        return photos[index]
    }

    private var isFavorite: Bool { favoriteStates[current.photo_id] ?? startsFavorited }

    var body: some View {
        ZStack {
            KindredTheme.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                navBar
                stage
                filmstrip
                dock
            }
        }
        .offset(y: dragOffset)
        .opacity(1 - min(1, abs(dragOffset) / 400))
        // Swipe down dismisses the viewer.
        .gesture(dismissGesture)
        .statusBarHidden(false)
        .sheet(isPresented: $showInfo) {
            PhotoInfoSheet(photo: current)
        }
        .sheet(isPresented: $showShare) {
            SelectionShareSheet(photos: [current])
        }
        .fullScreenCover(item: $playing) { video in
            VideoPlayerView(video: video)
        }
        .onChange(of: index) { _, _ in zoom = 1 }
        .task(id: current.id) {
            let id = current.id
            guard !startsFavorited, !favoriteChecksFinished.contains(id) else { return }
            let accountID = SessionManager.shared.currentUser?.id
            let saved = try? await APIClient.shared.favoriteStatus(photoID: id)
            guard !Task.isCancelled, SessionManager.shared.currentUser?.id == accountID else { return }
            if let saved { favoriteStates[id] = saved }
            favoriteChecksFinished.insert(id)
        }
    }

    // MARK: - Chrome

    private var navBar: some View {
        HStack(spacing: 8) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Close photo")

            Text(dateLabel)
                .font(.display(18, weight: .bold, relativeTo: .headline))
                .foregroundStyle(KindredTheme.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .accessibilityAddTraits(.isHeader)

            Menu {
                Button("Photo info", systemImage: "info.circle") { showInfo = true }
                Button("Share", systemImage: "square.and.arrow.up") { showShare = true }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(KindredTheme.inkSecondary)
                    .frame(width: 36, height: 36)
                    .overlay { Circle().strokeBorder(KindredTheme.hairlineStrong) }
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("More actions")
        }
        .buttonStyle(.plain)
        .foregroundStyle(KindredTheme.accent)
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    // MARK: - Stage

    private var stage: some View {
        GeometryReader { geo in
            TabView(selection: $index) {
                ForEach(Array(photos.enumerated()), id: \.element.photo_id) { position, photo in
                    Group {
                        if abs(position - index) <= 2 {
                            KindredThumbnail(photo: photo, variant: .preview, cornerRadius: 14,
                                             contentMode: .fit, placeholder: KindredTheme.bg)
                        } else {
                            KindredTheme.bg
                        }
                    }
                        .scaleEffect(position == index ? zoom : 1)
                        // Pinch zooms.
                        .gesture(
                            MagnificationGesture()
                                .onChanged { zoom = max(1, min(4, $0)) }
                                .onEnded { _ in
                                    if zoom < 1.1 { withAnimation(KindredTheme.ease()) { zoom = 1 } }
                                }
                        )
                        .overlay {
                            if photo.isVideo && position == index {
                                Button {
                                    playing = photo
                                } label: {
                                    Image(systemName: "play.fill")
                                        .font(.system(size: 25, weight: .semibold))
                                        .foregroundStyle(.white)
                                        .frame(width: 62, height: 62)
                                        .background(KindredTheme.onPhotoChip, in: Circle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Play video")
                            }
                        }
                        .tag(position)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .frame(maxHeight: .infinity)
            .task(id: "\(index):\(geo.size.width):\(displayScale)") {
                guard !DemoDataProvider.shared.isActive else { return }
                @MainActor func pixels(for photo: LibraryPhoto) -> CGFloat {
                    guard let thumb = PhotoImageDelivery.shared.thumbnail(for: photo.photo_id) else { return geo.size.width * displayScale }
                    return min(geo.size.width, geo.size.height * thumb.size.width / max(1, thumb.size.height)) * displayScale
                }
                if !current.isVideo, let url = APIClient.optimizedImageURL(photoID: current.photo_id, pixels: pixels(for: current)) {
                    _ = await PhotoImageDelivery.shared.image(url)
                }
                for offset in [1, -1, 2, -2] {
                    guard !Task.isCancelled else { return }
                    let position = index + offset
                    guard photos.indices.contains(position), !photos[position].isVideo,
                          let url = APIClient.optimizedImageURL(photoID: photos[position].photo_id, pixels: pixels(for: photos[position])) else { continue }
                    _ = await PhotoImageDelivery.shared.image(url, speculative: true)
                }
            }
        }
        .clipShape(.rect(cornerRadius: 14))
        .padding(.horizontal, 12)
    }

    // MARK: - Filmstrip

    @ViewBuilder
    private var filmstrip: some View {
        if photos.count > 1 {
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 6) {
                        ForEach(Array(photos.enumerated()), id: \.element.photo_id) { position, photo in
                            Button {
                                withAnimation(KindredTheme.ease(0.2)) { index = position }
                            } label: {
                                KindredThumbnail(photo: photo, cornerRadius: 10)
                                    .frame(width: 56, height: 56)
                                    .clipShape(.rect(cornerRadius: 10))
                                    .padding(3)
                                    .overlay {
                                        if position == index {
                                            RoundedRectangle(cornerRadius: 12)
                                                .strokeBorder(KindredTheme.accent, lineWidth: 2)
                                        }
                                    }
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(position == index ? .isSelected : [])
                            .id(position)
                        }
                    }
                    .padding(.horizontal, 14)
                }
                .onAppear { proxy.scrollTo(index, anchor: .center) }
                .onChange(of: index) { _, new in
                    withAnimation(KindredTheme.ease(0.24)) { proxy.scrollTo(new, anchor: .center) }
                }
                .accessibilityIdentifier("viewer.filmstrip")
                .frame(height: 62)
            }
            .padding(.vertical, 13)
        }
    }

    private var dock: some View {
        HStack(spacing: 0) {
            dockButton("square.and.arrow.up", "Share") { showShare = true }
            dockButton(isFavorite ? "heart.fill" : "heart", "Favorite",
                       tint: isFavorite ? KindredTheme.accent : KindredTheme.inkSecondary,
                       accessibilityLabel: isFavorite ? "Remove favorite" : "Favorite") {
                Task { await toggleFavorite() }
            }
            .disabled(favoriteRequests.contains(current.id) || (!startsFavorited && !favoriteChecksFinished.contains(current.id)))
            dockButton("info.circle", "Info") { showInfo = true }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .overlay(alignment: .top) { Divider() }
    }

    private func dockButton(
        _ icon: String, _ label: String, tint: Color = KindredTheme.inkSecondary,
        accessibilityLabel: String? = nil, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 22))
                Text(label).font(.kindredCaption)
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity, minHeight: 49)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel ?? label)
    }

    // MARK: - Gestures

    private var dismissGesture: some Gesture {
        DragGesture(minimumDistance: 20)
            .onChanged { value in
                guard zoom <= 1.01, value.translation.height > abs(value.translation.width) else { return }
                dragOffset = value.translation.height
            }
            .onEnded { value in
                if zoom <= 1.01, value.translation.height > 140, value.translation.height > abs(value.translation.width) {
                    dismiss()
                } else {
                    withAnimation(KindredTheme.ease()) { dragOffset = 0 }
                }
            }
    }

    // MARK: - Data

    private func toggleFavorite() async {
        let id = current.photo_id
        guard favoriteRequests.insert(id).inserted else { return }
        defer { favoriteRequests.remove(id) }
        let previous = isFavorite
        favoriteStates[id] = !previous
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        do {
            favoriteStates[id] = try await APIClient.shared.setFavorite(
                photoID: id, favorited: !previous
            )
        } catch {
            favoriteStates[id] = previous
        }
    }

    private var dateLabel: String {
        current.takenAt?.formatted(.dateTime.month(.abbreviated).day().year())
            ?? (current.photo_title ?? "Photo")
    }
}

// MARK: - Info sheet

struct PhotoInfoSheet: View {
    let photo: LibraryPhoto
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(photo.photo_title ?? "Untitled")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ink)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 24)

            VStack(alignment: .leading, spacing: 8) {
                if let date = photo.takenAt {
                    infoRow("Date", date.formatted(date: .long, time: .shortened))
                }
                infoRow("Kind", photo.isVideo ? "Video" : "Photo")
                if let duration = photo.durationLabel {
                    infoRow("Duration", duration)
                }
                infoRow("Id", photo.photo_id)
                // TODO: camera, lens, size and place need an EXIF payload on
                // the catalog row — /photos/{id} does not return one today.
            }
            .padding(.top, 18)

            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, KindredTheme.gutter)
        .background(KindredTheme.sheet.ignoresSafeArea())
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.kindredLabel)
                .foregroundStyle(KindredTheme.inkMeta)
                .frame(width: 84, alignment: .leading)
            Text(value)
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.ink)
                .textSelection(.enabled)
        }
        .accessibilityElement(children: .combine)
    }
}
