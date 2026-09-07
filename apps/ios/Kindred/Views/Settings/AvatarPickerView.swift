import SwiftUI
import PhotosUI

/// Avatar picker sheet — lets user choose a photo from their Kindred library or device camera roll.
struct AvatarPickerView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var selectedTab = 0
    @State private var libraryPhotos: [AvatarPhoto] = []
    @State private var loading = false
    @State private var saving = false
    @State private var selectedPhotoId: String?
    @State private var selectedDeviceImage: UIImage?
    @State private var pickerItem: PhotosPickerItem?
    @State private var searchQuery = ""
    @State private var clusters: [ClusterSummary] = []
    @State private var selectedCluster: ClusterSummary?
    @State private var clusterPhotos: [AvatarPhoto] = []

    let currentAvatarURL: String?
    let userName: String? // Used to auto-find matching clusters
    let onSaved: (String?) -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Current avatar preview
                avatarPreview
                    .padding(.top, 16)
                    .padding(.bottom, 12)

                // Tab picker
                Picker("Source", selection: $selectedTab) {
                    Text("From Library").tag(0)
                    Text("Upload").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 20)
                .padding(.bottom, 16)

                // Tab content
                if selectedTab == 0 {
                    libraryTab
                } else {
                    uploadTab
                }

                Spacer()
            }
            .kindredPaperBackground()
            .navigationTitle("Profile Photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(KindredTheme.mist)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await saveAvatar() }
                    }
                    .disabled(!canSave || saving)
                    .foregroundStyle(canSave && !saving ? KindredTheme.ember : KindredTheme.mist)
                    .font(.kindredLabel)
                }
            }
            .task {
                await loadLibraryPhotos()
            }
        }
    }

    private var canSave: Bool {
        (selectedTab == 0 && selectedPhotoId != nil) ||
        (selectedTab == 1 && selectedDeviceImage != nil)
    }

    // MARK: - Avatar Preview

    private var avatarPreview: some View {
        VStack(spacing: 8) {
            Group {
                if let deviceImage = selectedDeviceImage, selectedTab == 1 {
                    Image(uiImage: deviceImage)
                        .resizable()
                        .scaledToFill()
                } else if let photoId = selectedPhotoId, selectedTab == 0,
                          let photo = libraryPhotos.first(where: { $0.photo_id == photoId }) {
                    AsyncImage(url: URL(string: photo.thumb_url)) { phase in
                        switch phase {
                        case .success(let img):
                            img.resizable().scaledToFill()
                        default:
                            currentAvatarFallback
                        }
                    }
                } else {
                    currentAvatarFallback
                }
            }
            .frame(width: 88, height: 88)
            .clipShape(Circle())
            .overlay(Circle().stroke(KindredTheme.line, lineWidth: 2))
            .shadow(color: KindredTheme.cardShadow, radius: 8, x: 0, y: 4)

            if currentAvatarURL != nil {
                Button("Remove Photo") {
                    Task { await removeAvatar() }
                }
                .font(.body(12, weight: .semibold))
                .foregroundStyle(KindredTheme.rosehip)
            }
        }
    }

    @ViewBuilder
    private var currentAvatarFallback: some View {
        if let urlPath = currentAvatarURL {
            AvatarAsyncImage(avatarPath: urlPath)
        } else {
            KindredTheme.avatarGradient
                .overlay {
                    Image(systemName: "person.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(.white.opacity(0.8))
                }
        }
    }

    // MARK: - Library Tab

    private var libraryTab: some View {
        VStack(spacing: 0) {
            // Search
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14))
                    .foregroundStyle(KindredTheme.mist)
                TextField("Search people or photos...", text: $searchQuery)
                    .font(.kindredCaption)
                    .foregroundStyle(KindredTheme.ash)
                    .onSubmit {
                        Task { await loadLibraryPhotos() }
                    }
                if !searchQuery.isEmpty {
                    Button {
                        searchQuery = ""
                        selectedCluster = nil
                        Task { await loadLibraryPhotos() }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(KindredTheme.mist)
                    }
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(KindredTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
            .overlay(
                RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                    .stroke(KindredTheme.line, lineWidth: 1)
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 12)

            // Cluster chips (people to browse)
            if !clusters.isEmpty && selectedCluster == nil {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(clusters) { cluster in
                            Button {
                                selectedCluster = cluster
                                Task { await loadClusterPhotos(cluster) }
                            } label: {
                                HStack(spacing: 6) {
                                    KindredAvatar(url: cluster.avatar ?? cluster.thumb_url, size: 24, borderWidth: 1)
                                    Text(cluster.label ?? "Unnamed")
                                        .font(.body(12, weight: .semibold))
                                        .foregroundStyle(KindredTheme.ash)
                                    Text("\(cluster.photo_count)")
                                        .font(.kindredMicro)
                                        .foregroundStyle(KindredTheme.mist)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(KindredTheme.card)
                                .clipShape(Capsule())
                                .overlay(Capsule().stroke(KindredTheme.line, lineWidth: 1))
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.bottom, 10)
            }

            // Selected cluster header
            if let cluster = selectedCluster {
                HStack(spacing: 8) {
                    Button {
                        selectedCluster = nil
                        Task { await loadLibraryPhotos() }
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(KindredTheme.ember)
                    }
                    .accessibilityLabel("Back to all photos")
                    KindredAvatar(url: cluster.avatar ?? cluster.thumb_url, size: 28, borderWidth: 1)
                    Text(cluster.label ?? "Unnamed")
                        .font(.kindredCardTitle)
                        .foregroundStyle(KindredTheme.ash)
                    Text("· \(clusterPhotos.count) photos")
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.mist)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }

            if loading {
                ProgressView()
                    .tint(KindredTheme.ember)
                    .padding(.top, 40)
            } else {
                let photos = selectedCluster != nil ? clusterPhotos : libraryPhotos
                if photos.isEmpty {
                    Text("No photos found")
                        .font(.kindredCaption)
                        .foregroundStyle(KindredTheme.mist)
                        .padding(.top, 40)
                } else {
                    ScrollView {
                        LazyVGrid(columns: [
                            GridItem(.flexible(), spacing: 6),
                            GridItem(.flexible(), spacing: 6),
                            GridItem(.flexible(), spacing: 6),
                            GridItem(.flexible(), spacing: 6),
                        ], spacing: 6) {
                            ForEach(photos) { photo in
                                Button {
                                selectedPhotoId = photo.photo_id
                                selectedDeviceImage = nil
                            } label: {
                                AsyncImage(url: URL(string: photo.thumb_url)) { phase in
                                    switch phase {
                                    case .success(let img):
                                        img.resizable().scaledToFill()
                                    default:
                                        KindredTheme.canvas
                                    }
                                }
                                .frame(minHeight: 80)
                                .aspectRatio(1, contentMode: .fill)
                                .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusXS))
                                .overlay {
                                    if selectedPhotoId == photo.photo_id {
                                        RoundedRectangle(cornerRadius: KindredTheme.radiusXS)
                                            .stroke(KindredTheme.ember, lineWidth: 3)
                                        Image(systemName: "checkmark.circle.fill")
                                            .font(.system(size: 22))
                                            .foregroundStyle(.white)
                                            .shadow(radius: 4)
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 100)
                }
            }
        }
        }
    }

    // MARK: - Upload Tab

    private var uploadTab: some View {
        VStack(spacing: 16) {
            if let deviceImage = selectedDeviceImage {
                Image(uiImage: deviceImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 160, height: 160)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(KindredTheme.line, lineWidth: 2))
                    .shadow(color: KindredTheme.cardShadow, radius: 8, x: 0, y: 4)

                Button("Choose Different") {
                    selectedDeviceImage = nil
                    pickerItem = nil
                }
                .font(.body(13, weight: .semibold))
                .foregroundStyle(KindredTheme.ember)
            } else {
                PhotosPicker(selection: $pickerItem, matching: .images) {
                    VStack(spacing: 12) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.system(size: 32, weight: .light))
                            .foregroundStyle(KindredTheme.mist)
                        Text("Choose from Photos")
                            .font(.kindredLabel)
                            .foregroundStyle(KindredTheme.ash)
                        Text("JPG, PNG, or HEIC")
                            .font(.kindredMeta)
                            .foregroundStyle(KindredTheme.mist)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
                    .background(KindredTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusMD))
                    .overlay(
                        RoundedRectangle(cornerRadius: KindredTheme.radiusMD)
                            .stroke(KindredTheme.line, style: StrokeStyle(lineWidth: 1, dash: [8, 4]))
                    )
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .onChange(of: pickerItem) { _, newItem in
            Task {
                if let data = try? await newItem?.loadTransferable(type: Data.self),
                   let uiImage = UIImage(data: data) {
                    await MainActor.run {
                        selectedDeviceImage = uiImage
                        selectedPhotoId = nil
                    }
                }
            }
        }
    }

    // MARK: - Data Loading

    private func loadLibraryPhotos() async {
        loading = true
        do {
            // Load people clusters for browsing
            let response = try await APIClient.shared.getClusterSummary(category: "people")
            await MainActor.run {
                clusters = response.clusters.filter { $0.label != nil }
            }

            if searchQuery.trimmingCharacters(in: .whitespaces).count > 1 {
                // Search by query
                let results: [SearchResult] = try await APIClient.shared.search(query: searchQuery, limit: 40)
                await MainActor.run {
                    libraryPhotos = results.map { AvatarPhoto(photo_id: $0.photo_id, thumb_url: $0.thumb_url ?? $0.photo_url) }
                }
            } else if let name = userName,
                      let matchingCluster = clusters.first(where: {
                          $0.label?.localizedCaseInsensitiveContains(name.split(separator: " ").first.map(String.init) ?? name) == true
                      }) {
                // Auto-match: show photos from the cluster matching the user's name
                await MainActor.run { selectedCluster = matchingCluster }
                await loadClusterPhotos(matchingCluster)
                return // loadClusterPhotos sets loading = false
            } else {
                // Fallback: recent timeline photos
                let timeline: TimelineResponse = try await APIClient.shared.getTimeline()
                var photos: [AvatarPhoto] = []
                for month in timeline.months {
                    for p in month.photos {
                        photos.append(AvatarPhoto(photo_id: p.photo_id, thumb_url: p.thumb_url ?? ""))
                        if photos.count >= 40 { break }
                    }
                    if photos.count >= 40 { break }
                }
                await MainActor.run { libraryPhotos = photos }
            }
        } catch {
            print("Failed to load photos for avatar picker: \(error)")
        }
        await MainActor.run { loading = false }
    }

    private func loadClusterPhotos(_ cluster: ClusterSummary) async {
        await MainActor.run { loading = true }
        do {
            let detail = try await APIClient.shared.getClusterDetail(
                category: "people",
                clusterId: cluster.id
            )
            await MainActor.run {
                clusterPhotos = detail.items.map { AvatarPhoto(photo_id: $0.photo_id, thumb_url: $0.thumb_url ?? $0.photo_url) }
            }
        } catch {
            print("Failed to load cluster photos: \(error)")
        }
        await MainActor.run { loading = false }
    }

    // MARK: - Save

    private func saveAvatar() async {
        saving = true
        do {
            if selectedTab == 0, let photoId = selectedPhotoId {
                let result = try await APIClient.shared.setAvatarFromPhoto(photoId: photoId)
                await MainActor.run {
                    onSaved(result.avatar_url)
                    dismiss()
                }
            } else if selectedTab == 1, let image = selectedDeviceImage {
                // Compress to JPEG
                guard let data = image.jpegData(compressionQuality: 0.85) else { return }
                let result = try await APIClient.shared.uploadAvatar(imageData: data)
                await MainActor.run {
                    onSaved(result.avatar_url)
                    dismiss()
                }
            }
        } catch {
            print("Failed to save avatar: \(error)")
        }
        await MainActor.run { saving = false }
    }

    private func removeAvatar() async {
        do {
            try await APIClient.shared.deleteAvatar()
            await MainActor.run {
                onSaved(nil)
                dismiss()
            }
        } catch {
            print("Failed to remove avatar: \(error)")
        }
    }
}

// MARK: - Supporting Types

struct AvatarPhoto: Identifiable {
    var id: String { photo_id }
    let photo_id: String
    let thumb_url: String
}

/// An AsyncImage that loads avatar images with session authentication
struct AvatarAsyncImage: View {
    let avatarPath: String
    var size: CGFloat = 88

    @State private var avatarURL: URL?

    var body: some View {
        Group {
            if let url = avatarURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().scaledToFill()
                    default:
                        KindredTheme.avatarGradient
                            .overlay {
                                Image(systemName: "person.fill")
                                    .font(.system(size: size * 0.35))
                                    .foregroundStyle(.white.opacity(0.8))
                            }
                    }
                }
            } else {
                KindredTheme.avatarGradient
                    .overlay {
                        ProgressView()
                            .tint(.white)
                    }
            }
        }
        .task {
            avatarURL = await APIClient.shared.avatarImageURL(for: avatarPath)
        }
    }
}
