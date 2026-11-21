import SwiftUI

/// "Album" in the selection bar: pick an existing album or make one, then
/// `POST /albums/{ref}/photos` projects the selection onto the NAS tree and
/// the Flickr photoset exactly as an upload would.
struct AlbumPickerSheet: View {
    let photoIDs: [String]
    let onPick: (String) -> Void

    @State private var albums: [Album] = []
    @State private var isLoading = true
    @State private var newName = ""
    @State private var isCreating = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Add to album")
                        .font(.kindredH2)
                        .foregroundStyle(KindredTheme.ink)
                        .accessibilityAddTraits(.isHeader)
                        .padding(.top, 16)
                    Text(countLine)
                        .font(.kindredCaption)
                        .foregroundStyle(KindredTheme.inkSecondary)
                        .padding(.top, 4)
                        .padding(.bottom, 16)

                    HStack(spacing: 8) {
                        TextField("New album name", text: $newName)
                            .font(.kindredBody)
                            .foregroundStyle(KindredTheme.ink)
                            .tint(KindredTheme.accent)
                            .padding(.horizontal, 13)
                            .frame(minHeight: 44)
                            .background(KindredTheme.fill)
                            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                            .overlay(
                                RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                                    .stroke(KindredTheme.hairlineStrong, lineWidth: 1)
                            )
                            .accessibilityLabel("New album name")

                        KindredButton(title: "Create", isSmall: true, isLoading: isCreating) {
                            Task { await create() }
                        }
                        .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .padding(.bottom, 16)

                    if isLoading {
                        ProgressView().tint(KindredTheme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 30)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(albums.enumerated()), id: \.element.id) { position, album in
                                Button {
                                    if let reference = album.reference {
                                        onPick(reference)
                                        dismiss()
                                    }
                                } label: {
                                    HStack {
                                        Text(album.name)
                                            .font(.kindredLabel)
                                            .foregroundStyle(KindredTheme.ink)
                                        Spacer()
                                        Text("\(album.photo_count)")
                                            .font(.kindredMeta)
                                            .foregroundStyle(KindredTheme.inkMeta)
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundStyle(KindredTheme.inkMeta)
                                    }
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 13)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .disabled(album.reference == nil)

                                if position < albums.count - 1 {
                                    Rectangle()
                                        .fill(KindredTheme.hairlineSoft)
                                        .frame(height: 1)
                                        .padding(.leading, 14)
                                }
                            }
                        }
                        .kindredGroupedCard()
                    }

                    if let error {
                        Text(error)
                            .font(.kindredCaption)
                            .foregroundStyle(KindredTheme.dangerText)
                            .padding(.top, 10)
                    }
                }
                .padding(.horizontal, KindredTheme.gutter)
                .padding(.bottom, 30)
            }
            .background(KindredTheme.sheet.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(KindredTheme.accent)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await load() }
    }

    private var countLine: String {
        photoIDs.count == 1 ? "1 photo" : "\(photoIDs.count) photos"
    }

    private func load() async {
        isLoading = true
        albums = (try? await APIClient.shared.albums()) ?? []
        isLoading = false
    }

    private func create() async {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        isCreating = true
        defer { isCreating = false }
        do {
            let album = try await APIClient.shared.createAlbum(name: name)
            if let reference = album.reference {
                onPick(reference)
                dismiss()
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Share

/// The system share sheet over the originals of a selection.
///
/// Sharing hands out the signed media URLs rather than the bytes: downloading
/// full originals for a forty-photo selection before the sheet can open is not
/// something a phone should be asked to do.
struct SelectionShareSheet: UIViewControllerRepresentable {
    let photos: [LibraryPhoto]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let urls = photos.compactMap {
            APIClient.mediaURL(photoID: $0.photo_id, variant: .original)
        }
        return UIActivityViewController(activityItems: urls, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct SelectedMediaReview: View {
    let photos: [LibraryPhoto]

    @State private var exportTask: Task<Void, Never>?
    @State private var completed = 0
    @State private var exportError: String?
    @State private var shareArchive: SharedMediaArchive?
    @State private var viewing: LibraryPhoto?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    ForEach(PhotoDay.group(photos)) { day in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(day.date?.formatted(date: .long, time: .omitted) ?? "Undated")
                                .font(.kindredLabel)
                                .foregroundStyle(KindredTheme.ink)
                                .accessibilityAddTraits(.isHeader)

                            let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 3)
                            LazyVGrid(columns: columns, spacing: 6) {
                                ForEach(day.photos) { photo in
                                    Button { viewing = photo } label: {
                                        SquarePhotoTile(photo: photo, cornerRadius: 10)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
                .padding(KindredTheme.gutter)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { exportActions }
            .kindredPaperBackground()
            .navigationTitle(photos.count == 1 ? "1 selected" : "\(photos.count) selected")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Edit selection") { dismiss() }
                }
            }
            .sheet(item: $shareArchive) { archive in
                ArchiveShareSheet(archive: archive)
            }
            .fullScreenCover(item: $viewing) { photo in
                if photo.isVideo {
                    VideoPlayerView(video: photo)
                } else {
                    PhotoViewerView(photos: photos, initial: photo)
                }
            }
        }
        .onDisappear { exportTask?.cancel() }
    }

    private var exportActions: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let exportError {
                Text(exportError)
                    .font(.kindredCaption)
                    .foregroundStyle(KindredTheme.dangerText)
            }
            if exportTask != nil {
                ProgressView(value: Double(completed), total: Double(photos.count)) {
                    Text("Preparing ZIP · \(completed) of \(photos.count)")
                        .font(.kindredCaption)
                }
                KindredButton(title: "Cancel download", style: .ghost, isFullWidth: true) {
                    exportTask?.cancel()
                }
            } else {
                KindredButton(title: "Download ZIP", icon: "arrow.down.to.line", isFullWidth: true) {
                    startExport()
                }
                .accessibilityIdentifier("library.downloadZIP")
                .disabled(photos.isEmpty)
            }
        }
        .padding(.horizontal, KindredTheme.gutter)
        .padding(.vertical, 12)
        .background(KindredTheme.chrome.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Divider() }
    }

    private func startExport() {
        guard exportTask == nil, !photos.isEmpty else { return }
        completed = 0
        exportError = nil
        let items = photos.map { photo in
            let demoURL = photo.thumb_url.flatMap {
                DemoDataProvider.isDemoURL($0) ? DemoThumbnailView.fileURL(for: $0) : nil
            }
            let original = demoURL ?? APIClient.mediaURL(photoID: photo.id, variant: .original)
            var fallback: URL?
            if !photo.isVideo, let original, !original.isFileURL,
               var components = URLComponents(url: original, resolvingAgainstBaseURL: false) {
                components.path = String(components.path.dropLast("local".count)) + "image"
                components.queryItems = (components.queryItems ?? []).filter { $0.name != "variant" }
                    + [URLQueryItem(name: "size", value: "o")]
                fallback = components.url
            }
            return MediaArchiveExporter.Item(
                title: photo.photo_title ?? (photo.isVideo ? "Video" : "Photo"),
                folder: photo.takenAt == nil ? "Undated" : photo.dayKey,
                original: original, fallback: fallback
            )
        }
        exportTask = Task {
            defer { exportTask = nil }
            do {
                let output = try await MediaArchiveExporter().create(items: items) { count in
                    completed = count
                }
                try Task.checkCancellation()
                shareArchive = output
            } catch where !Task.isCancelled {
                if let error = error as? MediaArchiveExporter.ExportError {
                    exportError = error.localizedDescription
                } else {
                    exportError = "Couldn’t prepare the ZIP. Check your connection and available storage, then try again."
                }
            } catch {}
        }
    }
}

private struct ArchiveShareSheet: UIViewControllerRepresentable {
    let archive: SharedMediaArchive

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [archive.url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
