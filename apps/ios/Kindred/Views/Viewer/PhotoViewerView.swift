import SwiftUI

/// Screen 08 — Photo viewer. Dark stage, a stacked date/time nav title, the
/// image fitted rather than filled, people and object chips, a filmstrip, and
/// a Share / Favorite / Info / Delete dock.
struct PhotoViewerView: View {
    let photos: [LibraryPhoto]
    let initial: LibraryPhoto

    @State private var index = 0
    @State private var isFavorite = false
    @State private var dragOffset: CGFloat = 0
    @State private var zoom: CGFloat = 1
    @State private var showInfo = false
    @State private var showShare = false
    @State private var people: [SearchHit] = []
    @Environment(\.dismiss) private var dismiss

    private var current: LibraryPhoto {
        guard photos.indices.contains(index) else { return initial }
        return photos[index]
    }

    var body: some View {
        ZStack {
            KindredTheme.stage.ignoresSafeArea()

            VStack(spacing: 0) {
                navBar
                stage
                metadataStrip
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
        .task {
            index = photos.firstIndex(of: initial) ?? 0
        }
        .onChange(of: index) { _, _ in isFavorite = false }
    }

    // MARK: - Chrome

    private var navBar: some View {
        HStack(spacing: 10) {
            Button {
                dismiss()
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 19, weight: .semibold))
                    Text(monthLabel)
                        .font(.body(15, weight: .semibold, relativeTo: .headline))
                }
            }
            .foregroundStyle(KindredTheme.ink)
            .accessibilityLabel("Close photo")

            Spacer()

            VStack(spacing: 1) {
                Text(dateLabel)
                    .font(.body(13, weight: .bold, relativeTo: .subheadline))
                    .foregroundStyle(KindredTheme.ink)
                if let detail = timeAndPlaceLabel {
                    Text(detail)
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.inkMeta)
                }
            }
            .accessibilityElement(children: .combine)

            Spacer()

            Menu {
                Button("Photo info") { showInfo = true }
                Button("Share") { showShare = true }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 20))
                    .foregroundStyle(KindredTheme.ink)
            }
            .accessibilityLabel("More actions")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: - Stage

    private var stage: some View {
        TabView(selection: $index) {
            ForEach(Array(photos.enumerated()), id: \.element.photo_id) { position, photo in
                KindredThumbnail(photo: photo, variant: .preview, contentMode: .fit)
                    .scaleEffect(position == index ? zoom : 1)
                    // Pinch zooms.
                    .gesture(
                        MagnificationGesture()
                            .onChanged { zoom = max(1, min(4, $0)) }
                            .onEnded { _ in
                                if zoom < 1.1 { withAnimation(KindredTheme.ease()) { zoom = 1 } }
                            }
                    )
                    .tag(position)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .frame(maxHeight: .infinity)
        .padding(.vertical, 10)
    }

    // MARK: - People and objects

    private var metadataStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(people) { person in
                    HStack(spacing: 6) {
                        KindredAvatar(url: nil, size: 20)
                        Text(person.match_name ?? "")
                            .font(.body(12, weight: .semibold, relativeTo: .footnote))
                    }
                    .padding(.leading, 4)
                    .padding(.trailing, 10)
                    .padding(.vertical, 4)
                    .foregroundStyle(KindredTheme.ink)
                    .background(KindredTheme.fillStrongest, in: Capsule())
                }
                // TODO: object/scene chips for one photo need a per-photo
                // detections endpoint. /objects and /scenes group the whole
                // library, so nothing here is invented from them.
            }
            .padding(.horizontal, 16)
        }
        .scrollClipDisabled()
        .frame(height: people.isEmpty ? 0 : 40)
        .opacity(people.isEmpty ? 0 : 1)
    }

    // MARK: - Filmstrip

    private var filmstrip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 3) {
                    ForEach(Array(photos.enumerated()), id: \.element.photo_id) { position, photo in
                        let isCurrent = position == index
                        KindredThumbnail(photo: photo)
                            .frame(width: isCurrent ? 44 : 38, height: isCurrent ? 44 : 38)
                            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusTile))
                            .overlay {
                                if isCurrent {
                                    RoundedRectangle(cornerRadius: KindredTheme.radiusTile)
                                        .strokeBorder(KindredTheme.accent, lineWidth: 2)
                                }
                            }
                            .opacity(isCurrent ? 1 : 0.55)
                            .id(position)
                            .onTapGesture {
                                withAnimation(KindredTheme.ease(0.2)) { index = position }
                            }
                            .accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, 16)
                .frame(height: 48)
            }
            .scrollClipDisabled()
            .onChange(of: index) { _, new in
                withAnimation(KindredTheme.ease(0.24)) { proxy.scrollTo(new, anchor: .center) }
            }
            .accessibilityLabel("Filmstrip")
            .accessibilityValue("Photo \(index + 1) of \(photos.count)")
        }
        .padding(.bottom, 12)
    }

    // MARK: - Dock

    private var dock: some View {
        HStack {
            dockButton("square.and.arrow.up", "Share") { showShare = true }
            Spacer()
            dockButton(isFavorite ? "heart.fill" : "heart", "Favorite", tint: isFavorite ? KindredTheme.accent : nil) {
                Task { await toggleFavorite() }
            }
            Spacer()
            dockButton("info.circle", "Info") { showInfo = true }
            Spacer()
            // TODO: deleting a catalog photo needs DELETE /photos/{id}. The
            // backend only exposes Flickr-side deletion today, which would
            // leave the NAS copy behind, so this is deliberately inert.
            dockButton("trash", "Delete", tint: KindredTheme.dangerText) {}
                .disabled(true)
                .opacity(0.45)
        }
        .padding(.horizontal, 22)
        .padding(.top, 12)
        .padding(.bottom, 12)
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

    private func dockButton(
        _ icon: String, _ label: String, tint: Color? = nil, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundStyle(tint ?? KindredTheme.inkSecondary)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: - Gestures

    private var dismissGesture: some Gesture {
        DragGesture(minimumDistance: 20)
            .onChanged { value in
                guard zoom <= 1.01, value.translation.height > 0 else { return }
                dragOffset = value.translation.height
            }
            .onEnded { value in
                if value.translation.height > 140 {
                    dismiss()
                } else {
                    withAnimation(KindredTheme.ease()) { dragOffset = 0 }
                }
            }
    }

    // MARK: - Data

    private func toggleFavorite() async {
        let next = !isFavorite
        isFavorite = next
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        do {
            isFavorite = try await APIClient.shared.setFavorite(
                photoID: current.photo_id, favorited: next
            )
        } catch {
            isFavorite = !next
        }
    }

    private var monthLabel: String {
        guard let date = current.takenAt else { return "Back" }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMMM")
        return formatter.string(from: date)
    }

    private var dateLabel: String {
        guard let date = current.takenAt else { return current.photo_title ?? "Photo" }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("d MMMM yyyy")
        return formatter.string(from: date)
    }

    /// Time, and a place only if the catalog has one. The handoff forbids an
    /// invented place, so an unknown location simply shows the time.
    private var timeAndPlaceLabel: String? {
        guard let date = current.takenAt else { return nil }
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("HH:mm")
        return formatter.string(from: date)
    }
}

// MARK: - Info sheet

struct PhotoInfoSheet: View {
    let photo: LibraryPhoto
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredEyebrow(text: "Photo")
                .padding(.top, 20)
            Text(photo.photo_title ?? "Untitled")
                .font(.display(21, weight: .semibold, relativeTo: .title3))
                .foregroundStyle(KindredTheme.ink)
                .padding(.top, 8)

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
            Text(label.uppercased())
                .font(.kindredEyebrow)
                .tracking(1.4)
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
