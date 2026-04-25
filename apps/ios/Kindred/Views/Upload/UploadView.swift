import SwiftUI
import Photos

struct UploadView: View {
    @State private var viewModel = UploadViewModel()
    @State private var showFreeSpaceConfirm = false
    @State private var freedCount = 0
    @State private var showFreedAlert = false

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
            .background(KindredTheme.warmBackground)
            .navigationTitle("Upload")
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
            Text("Kindred needs access to your photo library to upload photos to Flickr.")
                .font(.system(.body, design: .rounded))
        } actions: {
            Button("Grant Access") {
                Task {
                    await viewModel.requestAccess()
                }
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
                .font(.system(.body, design: .rounded))
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
        VStack(spacing: 0) {
            if viewModel.isUploading {
                uploadProgressView
            }

            // Storage summary
            storageSummaryView

            // Selection toolbar
            if !viewModel.photoManager.notUploadedPhotos.isEmpty {
                selectionToolbar
            }

            // Photo grid
            if viewModel.photoManager.isLoading {
                Spacer()
                ProgressView("Scanning photos...")
                    .font(.system(.body, design: .rounded))
                Spacer()
            } else if viewModel.photoManager.notUploadedPhotos.isEmpty {
                ContentUnavailableView(
                    "All Backed Up",
                    systemImage: "checkmark.icloud",
                    description: Text("All your device photos have been uploaded to Flickr.")
                )
            } else {
                ScrollView {
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
                .refreshable {
                    await viewModel.refreshPhotos()
                }
            }
        }
    }

    // MARK: - Upload Progress

    private var uploadProgressView: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Uploading...")
                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                    .foregroundStyle(KindredTheme.pine)
                Spacer()
                Text("\(viewModel.uploadedCount)/\(viewModel.totalUploadCount)")
                    .font(.system(.caption, design: .rounded, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            ProgressView(value: viewModel.uploadProgress)
                .tint(KindredTheme.pine)

            Text(viewModel.currentPhotoTitle)
                .font(.system(.caption, design: .rounded))
                .foregroundStyle(.secondary)

            if let error = viewModel.uploadError {
                Text(error)
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(.red)
            }
        }
        .padding()
        .background(KindredTheme.warmCardBackground)
    }

    // MARK: - Storage Summary

    private var storageSummaryView: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(viewModel.photoManager.uploadedCount) backed up")
                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                    .foregroundStyle(KindredTheme.darkAccent)
                Text("\(viewModel.photoManager.notUploadedPhotos.count) not uploaded")
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if viewModel.photoManager.uploadedCount > 0 {
                Button {
                    showFreeSpaceConfirm = true
                } label: {
                    Label("Free \(viewModel.formattedSavings)", systemImage: "trash")
                        .font(.system(.caption, design: .rounded, weight: .medium))
                }
                .buttonStyle(.bordered)
                .tint(.orange)
            }
        }
        .padding()
        .background(KindredTheme.warmCardBackground)
        .alert("Free Up Space", isPresented: $showFreeSpaceConfirm) {
            Button("Delete Local Copies", role: .destructive) {
                Task {
                    do {
                        freedCount = try await viewModel.freeUpSpace()
                        showFreedAlert = true
                    } catch {
                        // Error handled in view model
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Delete \(viewModel.photoManager.uploadedCount) photos from this device that are already backed up to Flickr? This saves \(viewModel.formattedSavings).")
        }
        .alert("Space Freed", isPresented: $showFreedAlert) {
            Button("OK") {}
        } message: {
            Text("Deleted \(freedCount) photos from your device. They are still safe on Flickr.")
        }
    }

    // MARK: - Selection Toolbar

    private var selectionToolbar: some View {
        HStack {
            Button(viewModel.selectedAssets.isEmpty ? "Select All" : "Deselect All") {
                if viewModel.selectedAssets.isEmpty {
                    viewModel.selectAll()
                } else {
                    viewModel.clearSelection()
                }
            }
            .font(.system(.subheadline, design: .rounded))

            Spacer()

            if !viewModel.selectedAssets.isEmpty {
                Text("\(viewModel.selectedAssets.count) selected")
                    .font(.system(.caption, design: .rounded, weight: .medium))
                    .foregroundStyle(.secondary)

                Button {
                    Task {
                        await viewModel.uploadSelected()
                    }
                } label: {
                    Label("Upload", systemImage: "icloud.and.arrow.up")
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(KindredTheme.pine)
                .disabled(viewModel.isUploading)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(KindredTheme.warmBackground)
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

    private func loadThumbnail() async {
        let manager = PHImageManager.default()
        let options = PHImageRequestOptions()
        options.deliveryMode = .opportunistic
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
