import SwiftUI

struct ClusterDetailView: View {
    let cluster: ClusterSummary
    let category: ClusterCategory
    @Bindable var viewModel: LibraryViewModel
    @State private var selectedPhoto: PhotoGridItem?
    @State private var showDismissConfirm = false
    @State private var showRename = false
    @State private var nameInput = ""
    @Environment(\.dismiss) private var dismiss

    private let photoColumns = [
        GridItem(.flexible(), spacing: 4),
        GridItem(.flexible(), spacing: 4),
        GridItem(.flexible(), spacing: 4),
    ]

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                // Profile header
                profileHeader

                // Stats row
                statsRow

                // Photos grid
                photosGrid
            }
            .padding(.bottom, 110)
        }
        .kindredPaperBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Edit") {
                    nameInput = cluster.label ?? ""
                    showRename = true
                }
                .font(.kindredLabel)
                .foregroundStyle(KindredTheme.ember)
            }
        }
        .sheet(item: $selectedPhoto) { item in
            FullScreenPhotoView(item: item)
        }
        .sheet(isPresented: $showRename) {
            RenameSheet(
                nameInput: $nameInput,
                entityType: String(category.displayName.lowercased().dropLast()),
                onSave: { newName in
                    showRename = false
                    if !newName.isEmpty {
                        Task { await viewModel.renameCluster(clusterId: cluster.id, newName: newName) }
                    }
                },
                onCancel: { showRename = false }
            )
            .presentationDetents([.height(300)])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showDismissConfirm) {
            DismissGroupSheet(
                onConfirm: {
                    showDismissConfirm = false
                    Task {
                        await viewModel.dismissCluster(clusterId: cluster.id)
                        dismiss()
                    }
                },
                onCancel: { showDismissConfirm = false }
            )
            .presentationDetents([.height(320)])
            .presentationDragIndicator(.visible)
        }
        .task {
            await viewModel.loadClusterDetail(cluster: cluster)
        }
    }

    // MARK: - Profile Header

    private var profileHeader: some View {
        HStack(spacing: 14) {
            // Avatar
            KindredAvatar(
                url: cluster.avatar ?? cluster.thumb_url,
                size: 78,
                borderWidth: 3
            )

            VStack(alignment: .leading, spacing: 0) {
                // Name
                Text(cluster.label ?? "Unnamed")
                    .font(.display(24, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                    .italic(cluster.label == nil)

                // Meta
                Text("\(cluster.photo_count) photos · \(cluster.det_count) detections")
                    .font(.kindredMeta)
                    .tracking(0.6)
                    .foregroundStyle(KindredTheme.mist)
                    .padding(.top, 6)

                // Confirmed badge
                if cluster.label != nil {
                    HStack(spacing: 5) {
                        Text("●")
                            .font(.system(size: 8))
                        Text("CONFIRMED")
                            .font(.kindredMicro)
                            .tracking(1)
                    }
                    .foregroundStyle(KindredTheme.forest)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(KindredTheme.forest.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusPill))
                    .padding(.top, 6)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
    }

    // MARK: - Stats Row

    private var statsRow: some View {
        HStack(spacing: 8) {
            KindredStatCard(value: "\(cluster.photo_count)", label: "Photos")
            KindredStatCard(value: "\(cluster.det_count)", label: "Detections")
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }

    // MARK: - Photos Grid

    private var photosGrid: some View {
        VStack(alignment: .leading, spacing: 10) {
            KindredEyebrow(text: "All photos")
                .padding(.horizontal, 20)
                .padding(.top, 20)

            if viewModel.isLoadingDetail {
                ProgressView()
                    .tint(KindredTheme.ember)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
            } else if let detail = viewModel.clusterDetail {
                LazyVGrid(columns: photoColumns, spacing: 4) {
                    ForEach(detail.items) { detection in
                        let item = PhotoGridItem(from: detection)
                        let thumbOrPhoto = item.thumbURL ?? item.photoURL
                        Group {
                            if DemoDataProvider.isDemoURL(thumbOrPhoto) {
                                DemoThumbnailView(urlString: thumbOrPhoto, cornerRadius: KindredTheme.radiusXS)
                            } else {
                                AsyncImage(url: URL(string: thumbOrPhoto)) { phase in
                                    switch phase {
                                    case .success(let image):
                                        image.resizable().scaledToFill()
                                    default:
                                        KindredTheme.canvas
                                    }
                                }
                            }
                        }
                        .aspectRatio(1, contentMode: .fill)
                        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusXS))
                        .contentShape(Rectangle())
                        .onTapGesture {
                            selectedPhoto = item
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}

// MARK: - Dismiss Group Sheet

struct DismissGroupSheet: View {
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "eye.slash.fill")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(KindredTheme.rosehip)
                .padding(.top, 32)

            Text("Dismiss group?")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ash)
                .padding(.top, 16)

            Text("This will dismiss all detections in this group. This cannot be undone.")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.pine)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            Spacer()

            VStack(spacing: 10) {
                KindredButton(
                    title: "Dismiss",
                    icon: "eye.slash",
                    style: .danger,
                    isFullWidth: true
                ) {
                    onConfirm()
                }

                KindredButton(
                    title: "Cancel",
                    style: .ghost,
                    isFullWidth: true
                ) {
                    onCancel()
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(KindredTheme.paper)
    }
}
