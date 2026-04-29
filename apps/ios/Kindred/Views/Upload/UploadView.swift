import SwiftUI
import Photos

struct UploadView: View {
    @State private var viewModel = UploadViewModel()
    @State private var syncManager = SyncManager.shared
    @State private var showFreeSpaceConfirm = false
    @State private var freedCount = 0
    @State private var showFreedAlert = false
    @State private var showCleanup = false

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 4)

    var body: some View {
        NavigationStack {
            Group {
                switch viewModel.photoManager.authorizationStatus {
                case .notDetermined:
                    requestAccessView
                case .denied, .restricted:
                    deniedAccessView
                case .authorized, .limited:
                    authorizedView
                @unknown default:
                    requestAccessView
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(KindredTheme.warmBackground.ignoresSafeArea())
            .navigationTitle("Backup")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Image("KindredLogo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 32, height: 32)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
            .task {
                await viewModel.requestAccess()
            }
        }
        .tint(KindredTheme.pine)
    }

    // MARK: - Request Access

    private var requestAccessView: some View {
        ContentUnavailableView {
            Label("Photo Access", systemImage: "photo.on.rectangle")
        } description: {
            Text("Kindred needs access to your photo library to back up photos and videos.")
                .font(.kindredBody)
        } actions: {
            Button("Grant Access") {
                Task { await viewModel.requestAccess() }
            }
            .buttonStyle(.borderedProminent)
            .tint(KindredTheme.pine)
        }
    }

    private var deniedAccessView: some View {
        ContentUnavailableView {
            Label("Access Denied", systemImage: "lock.shield")
        } description: {
            Text("Photo library access was denied. Please enable it in Settings.")
                .font(.kindredBody)
        } actions: {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(KindredTheme.pine)
        }
    }

    // MARK: - Authorized View

    private var authorizedView: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Sync status card
                syncStatusCard

                // Storage summary + cleanup
                storageCard

                // Upload progress (if active)
                if viewModel.isUploading {
                    uploadProgressCard
                }

                // Not backed up section
                if !viewModel.photoManager.notUploadedPhotos.isEmpty {
                    notBackedUpSection
                }

                // All backed up state
                if viewModel.photoManager.notUploadedPhotos.isEmpty && !viewModel.photoManager.isLoading {
                    VStack(spacing: 12) {
                        Image(systemName: "checkmark.icloud.fill")
                            .font(.system(size: 48, weight: .light))
                            .foregroundStyle(KindredTheme.pine)
                        Text("All Backed Up")
                            .font(.kindredH3)
                            .foregroundStyle(KindredTheme.darkAccent)
                        Text("Every photo and video on this device is safely backed up.")
                            .font(.kindredCaption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.vertical, 40)
                }
            }
            .padding()
            .padding(.bottom, 90)
        }
        .refreshable {
            await viewModel.refreshPhotos()
        }
    }

    // MARK: - Sync Status Card

    private var syncStatusCard: some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Auto Backup")
                        .font(.kindredLabel)
                        .foregroundStyle(KindredTheme.darkAccent)
                    if let lastSync = syncManager.lastSyncDate {
                        Text("Last sync \(lastSync, style: .relative) ago")
                            .font(.kindredMeta)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Toggle("", isOn: Binding(
                    get: { syncManager.autoSyncEnabled },
                    set: { syncManager.setAutoSync($0) }
                ))
                .tint(KindredTheme.pine)
            }

            if syncManager.isSyncing {
                VStack(spacing: 6) {
                    HStack {
                        Text("Syncing...")
                            .font(.kindredMeta)
                            .foregroundStyle(KindredTheme.pine)
                        Spacer()
                        HStack(spacing: 4) {
                            Text("\(syncManager.syncedCount)/\(syncManager.totalToSync)")
                                .font(.kindredMeta)
                                .foregroundStyle(.secondary)
                            if syncManager.failedCount > 0 {
                                Text("· \(syncManager.failedCount) failed")
                                    .font(.kindredMeta)
                                    .foregroundStyle(.red)
                            }
                        }
                    }
                    ProgressView(value: syncManager.syncProgress)
                        .tint(KindredTheme.pine)
                }
            } else if !syncManager.autoSyncEnabled {
                Button {
                    Task { await syncManager.syncNewPhotos() }
                } label: {
                    Label("Sync Now", systemImage: "arrow.triangle.2.circlepath")
                        .font(.kindredLabel)
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                }
                .buttonStyle(.bordered)
                .tint(KindredTheme.pine)
            }

            if let error = syncManager.syncError {
                Text(error)
                    .font(.kindredMeta)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .background(KindredTheme.warmCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Storage Card

    private var storageCard: some View {
        VStack(spacing: 12) {
            // Progress ring + stats
            HStack(spacing: 20) {
                // Circular progress
                ZStack {
                    Circle()
                        .stroke(KindredTheme.pine.opacity(0.15), lineWidth: 6)
                    Circle()
                        .trim(from: 0, to: backupProgress)
                        .stroke(KindredTheme.pine, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    Text("\(Int(backupProgress * 100))%")
                        .font(.system(.caption2, design: .rounded, weight: .bold))
                        .foregroundStyle(KindredTheme.pine)
                }
                .frame(width: 52, height: 52)

                VStack(alignment: .leading, spacing: 4) {
                    Text("\(viewModel.photoManager.uploadedCount) backed up")
                        .font(.kindredLabel)
                        .foregroundStyle(KindredTheme.darkAccent)
                    Text("\(viewModel.photoManager.notUploadedPhotos.count) remaining · \(viewModel.photoManager.totalDevicePhotos) total")
                        .font(.kindredMeta)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            // Free up space button
            if viewModel.photoManager.uploadedCount > 0 {
                Button {
                    showFreeSpaceConfirm = true
                } label: {
                    HStack {
                        Image(systemName: "arrow.up.trash")
                        Text("Free up \(viewModel.formattedSavings)")
                            .font(.kindredLabel)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
                }
                .buttonStyle(.bordered)
                .tint(.orange)
            }
        }
        .padding()
        .background(KindredTheme.warmCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .sheet(isPresented: $showFreeSpaceConfirm) {
            FreeSpaceConfirmSheet(
                count: viewModel.photoManager.uploadedCount,
                savings: viewModel.formattedSavings,
                onConfirm: {
                    showFreeSpaceConfirm = false
                    Task {
                        do {
                            freedCount = try await viewModel.freeUpSpace()
                            showFreedAlert = true
                        } catch {}
                    }
                },
                onCancel: { showFreeSpaceConfirm = false }
            )
            .presentationDetents([.height(380)])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showFreedAlert) {
            SpaceFreedSheet(count: freedCount) {
                showFreedAlert = false
            }
            .presentationDetents([.height(300)])
            .presentationDragIndicator(.visible)
        }
    }

    private var backupProgress: CGFloat {
        let total = viewModel.photoManager.totalDevicePhotos
        guard total > 0 else { return 0 }
        return CGFloat(viewModel.photoManager.uploadedCount) / CGFloat(total)
    }

    // MARK: - Upload Progress

    private var uploadProgressCard: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Uploading...")
                    .font(.kindredLabel)
                    .foregroundStyle(KindredTheme.pine)
                Spacer()
                Text("\(viewModel.uploadedCount)/\(viewModel.totalUploadCount)")
                    .font(.kindredMeta)
                    .foregroundStyle(.secondary)
            }
            ProgressView(value: viewModel.uploadProgress)
                .tint(KindredTheme.pine)
            Text(viewModel.currentPhotoTitle)
                .font(.kindredMeta)
                .foregroundStyle(.secondary)
            if let error = viewModel.uploadError {
                Text(error)
                    .font(.kindredMeta)
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .background(KindredTheme.warmCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Not Backed Up Section

    private var notBackedUpSection: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Not Backed Up")
                    .font(.kindredH3)
                    .foregroundStyle(KindredTheme.darkAccent)
                Spacer()
                Text("\(viewModel.photoManager.notUploadedPhotos.count)")
                    .font(.kindredLabel)
                    .foregroundStyle(.secondary)
            }

            // Selection controls
            HStack {
                Button(viewModel.selectedAssets.isEmpty ? "Select All" : "Deselect") {
                    if viewModel.selectedAssets.isEmpty {
                        viewModel.selectAll()
                    } else {
                        viewModel.clearSelection()
                    }
                }
                .font(.kindredMeta)

                Spacer()

                if !viewModel.selectedAssets.isEmpty {
                    Text("\(viewModel.selectedAssets.count) selected")
                        .font(.kindredMeta)
                        .foregroundStyle(.secondary)

                    Button {
                        Task { await viewModel.uploadSelected() }
                    } label: {
                        Label("Upload", systemImage: "icloud.and.arrow.up")
                            .font(.kindredMeta)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(KindredTheme.pine)
                    .disabled(viewModel.isUploading)
                }
            }

            // Photo grid
            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(viewModel.photoManager.notUploadedPhotos, id: \.localIdentifier) { asset in
                    PhotoAssetCell(
                        asset: asset,
                        isSelected: viewModel.selectedAssets.contains(asset.localIdentifier)
                    )
                    .onTapGesture {
                        viewModel.toggleSelection(asset.localIdentifier)
                    }
                }
            }
        }
    }
}

// MARK: - Photo Asset Cell

struct PhotoAssetCell: View {
    let asset: PHAsset
    let isSelected: Bool
    @State private var image: Image?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let image = image {
                    image
                        .resizable()
                        .aspectRatio(1, contentMode: .fill)
                        .clipped()
                } else {
                    KindredTheme.warmCardBackground
                        .aspectRatio(1, contentMode: .fill)
                }
            }
            .overlay {
                if isSelected {
                    KindredTheme.pine.opacity(0.3)
                }
            }

            // Video duration badge
            if asset.mediaType == .video {
                VStack {
                    Spacer()
                    HStack {
                        Image(systemName: "video.fill")
                            .font(.caption2)
                        Text(formatDuration(asset.duration))
                            .font(.kindredMicro)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.black.opacity(0.6))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .padding(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(.white, KindredTheme.pine)
                    .padding(4)
            }
        }
        .task {
            await loadThumbnail()
        }
    }

    private func formatDuration(_ duration: TimeInterval) -> String {
        let mins = Int(duration) / 60
        let secs = Int(duration) % 60
        return String(format: "%d:%02d", mins, secs)
    }

    private func loadThumbnail() async {
        let manager = PHImageManager.default()
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        options.resizeMode = .fast

        let size = CGSize(width: 200, height: 200)

        let img: UIImage? = await withCheckedContinuation { continuation in
            manager.requestImage(for: asset, targetSize: size, contentMode: .aspectFill, options: options) { uiImage, _ in
                continuation.resume(returning: uiImage)
            }
        }

        if let uiImage = img {
            self.image = Image(uiImage: uiImage)
        }
    }
}
