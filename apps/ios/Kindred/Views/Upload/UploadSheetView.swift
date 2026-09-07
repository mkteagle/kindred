import Photos
import SwiftUI

/// Screen 10 — Upload sheet. A detented sheet over the dimmed library, with
/// the destination album, the queue, and the two actions.
struct UploadSheetView: View {
    @State private var viewModel = UploadViewModel()
    @State private var uploader = FlickrUploader.shared
    @State private var albums: [Album] = []
    @State private var albumIndex: Int?
    @State private var showAlbumPicker = false
    @Environment(\.dismiss) private var dismiss

    private var manager: PhotoLibraryManager { viewModel.photoManager }

    private var queue: [PHAsset] {
        manager.notUploadedPhotos.filter {
            viewModel.selectedAssets.contains($0.localIdentifier)
        }
    }

    private var candidates: [PHAsset] {
        let selected = queue
        return selected.isEmpty ? Array(manager.notUploadedPhotos.prefix(12)) : selected
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                KindredEyebrow(text: "Upload")
                    .padding(.top, 6)

                Text("Add to the library")
                    .font(.display(21, weight: .semibold, relativeTo: .title3))
                    .foregroundStyle(KindredTheme.ink)
                    .padding(.top, 8)
                    .padding(.bottom, 6)
                    .accessibilityAddTraits(.isHeader)

                Text("Saved to your NAS, mirrored to Flickr, then analyzed on your server.")
                    .font(.kindredBody)
                    .foregroundStyle(KindredTheme.inkBody)
                    .lineSpacing(2)
                    .padding(.bottom, 16)

                albumRow
                    .padding(.bottom, 10)

                if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
                    permissionNotice
                } else if candidates.isEmpty {
                    upToDateNotice
                } else {
                    queueRows
                }

                actions
                    .padding(.top, 16)
            }
            .padding(.horizontal, KindredTheme.gutter)
            .padding(.bottom, 28)
        }
        .background(KindredTheme.sheetFrosted.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(KindredTheme.sheetFrosted)
        .presentationCornerRadius(KindredTheme.radiusXL)
        .sheet(isPresented: $showAlbumPicker) {
            AlbumDestinationSheet(albums: albums) { index in
                albumIndex = index
                showAlbumPicker = false
            }
        }
        .task {
            await viewModel.requestAccess()
            await viewModel.refreshPhotos()
            albums = (try? await APIClient.shared.albums()) ?? []
        }
    }

    // MARK: - Album

    private var albumRow: some View {
        Button {
            showAlbumPicker = true
        } label: {
            HStack(spacing: 10) {
                Text("Album")
                    .font(.mono(10, weight: .medium))
                    .tracking(1.2)
                    .textCase(.uppercase)
                    .foregroundStyle(KindredTheme.inkMeta)
                Text(albumName)
                    .font(.body(13, weight: .semibold, relativeTo: .footnote))
                    .foregroundStyle(KindredTheme.ink)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(KindredTheme.inkMeta)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .kindredCardStyle()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Album, \(albumName)")
        .accessibilityHint("Choose where these photos land")
    }

    private var albumName: String {
        guard let albumIndex, albums.indices.contains(albumIndex) else {
            return "No album"
        }
        return albums[albumIndex].name
    }

    // MARK: - Queue

    private var queueRows: some View {
        VStack(spacing: 8) {
            ForEach(Array(candidates.prefix(20).enumerated()), id: \.element.localIdentifier) { position, asset in
                UploadQueueRow(
                    asset: asset,
                    status: status(for: position),
                    progress: progress(for: position)
                )
            }
        }
    }

    /// The uploader reports one queue-wide position, not per-file state, so a
    /// row's status is derived from where it sits relative to that position.
    private func status(for position: Int) -> UploadQueueRow.Status {
        guard uploader.isUploading else { return .waiting }
        if position < uploader.uploadedCount { return .uploaded }
        if position == uploader.uploadedCount { return .uploading }
        return .waiting
    }

    private func progress(for position: Int) -> Double {
        switch status(for: position) {
        case .uploaded: return 1
        case .uploading: return Double(uploader.currentProgress)
        case .waiting: return 0
        }
    }

    private var upToDateNotice: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Everything on this device is backed up.")
                .font(.kindredLabel)
                .foregroundStyle(KindredTheme.ink)
            Text("New photos are picked up automatically.")
                .font(.kindredMeta)
                .foregroundStyle(KindredTheme.inkMeta)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 13)
        .padding(.vertical, 14)
        .kindredCardStyle()
    }

    private var permissionNotice: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Kindred cannot see your photos.")
                .font(.kindredLabel)
                .foregroundStyle(KindredTheme.ink)
            Text("Allow photo access in Settings to back this device up.")
                .font(.kindredMeta)
                .foregroundStyle(KindredTheme.inkMeta)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .font(.kindredButtonSM)
            .foregroundStyle(KindredTheme.accent)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 13)
        .padding(.vertical, 14)
        .kindredCardStyle()
    }

    // MARK: - Actions

    private var actions: some View {
        HStack(spacing: 10) {
            KindredButton(
                title: uploader.isUploading ? "Uploading…" : "Upload all",
                style: .primary,
                isFullWidth: true,
                isLoading: uploader.isUploading
            ) {
                Task {
                    if viewModel.selectedAssets.isEmpty { viewModel.selectAll() }
                    await viewModel.uploadSelected()
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                }
            }
            .disabled(candidates.isEmpty || uploader.isUploading)

            KindredButton(title: "Done", style: .ghost) { dismiss() }
        }
    }
}

// MARK: - Queue row

/// 42pt thumb, filename and size, a 3pt bar, and the status line: sage for a
/// finished upload, terracotta→amber while it is moving.
struct UploadQueueRow: View {
    enum Status {
        case waiting, uploading, uploaded
    }

    let asset: PHAsset
    let status: Status
    let progress: Double

    @State private var thumbnail: Image?

    var body: some View {
        HStack(spacing: 11) {
            Group {
                if let thumbnail {
                    thumbnail.resizable().scaledToFill()
                } else {
                    KindredTheme.tile
                }
            }
            .frame(width: 42, height: 42)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(filename)
                        .font(.body(12, weight: .semibold, relativeTo: .footnote))
                        .foregroundStyle(KindredTheme.ink)
                        .lineLimit(1)
                    Spacer(minLength: 6)
                    Text(sizeLabel)
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.inkMeta)
                }

                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color(hex: 0xF1F1EC, alpha: 0.12))
                        Capsule()
                            .fill(barFill)
                            .frame(width: geo.size.width * max(0, min(1, progress)))
                    }
                }
                .frame(height: 3)

                Text(statusLabel)
                    .font(.kindredMeta)
                    .foregroundStyle(status == .uploaded ? KindredTheme.sageText : KindredTheme.inkMeta)
            }
        }
        .padding(9)
        .kindredCardStyle()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(filename), \(statusLabel)")
        .task { await loadThumbnail() }
    }

    private var barFill: LinearGradient {
        status == .uploaded
            ? LinearGradient(colors: [KindredTheme.sageGreen, KindredTheme.sageGreen],
                             startPoint: .leading, endPoint: .trailing)
            : KindredTheme.emberGradient
    }

    private var statusLabel: String {
        switch status {
        case .uploaded: return "Uploaded · analyzing"
        case .uploading: return "Uploading \(Int(progress * 100))%"
        case .waiting: return "Waiting"
        }
    }

    private var filename: String {
        let resource = PHAssetResource.assetResources(for: asset).first
        return resource?.originalFilename ?? "Photo"
    }

    private var sizeLabel: String {
        let resource = PHAssetResource.assetResources(for: asset).first
        guard let bytes = resource?.value(forKey: "fileSize") as? Int64 else { return "" }
        return ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }

    private func loadThumbnail() async {
        let options = PHImageRequestOptions()
        options.deliveryMode = .opportunistic
        options.isNetworkAccessAllowed = true
        let size = CGSize(width: 126, height: 126)
        thumbnail = await withCheckedContinuation { continuation in
            var resumed = false
            PHImageManager.default().requestImage(
                for: asset, targetSize: size, contentMode: .aspectFill, options: options
            ) { image, _ in
                guard !resumed else { return }
                resumed = true
                continuation.resume(returning: image.map { Image(uiImage: $0) })
            }
        }
    }
}

// MARK: - Album destination

struct AlbumDestinationSheet: View {
    let albums: [Album]
    let onPick: (Int?) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Button("No album") { onPick(nil) }
                    .foregroundStyle(KindredTheme.ink)
                    .listRowBackground(KindredTheme.fill)
                ForEach(Array(albums.enumerated()), id: \.element.id) { index, album in
                    Button {
                        onPick(index)
                    } label: {
                        HStack {
                            Text(album.name)
                                .foregroundStyle(KindredTheme.ink)
                            Spacer()
                            Text("\(album.photo_count)")
                                .font(.kindredMeta)
                                .foregroundStyle(KindredTheme.inkMeta)
                        }
                    }
                    .listRowBackground(KindredTheme.fill)
                }
            }
            .scrollContentBackground(.hidden)
            .background(KindredTheme.sheet.ignoresSafeArea())
            .navigationTitle("Album")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(KindredTheme.accent)
                }
            }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}
