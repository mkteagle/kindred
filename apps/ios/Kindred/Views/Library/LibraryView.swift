import SwiftUI

struct LibraryView: View {
    @State private var viewModel = LibraryViewModel()
    @State private var selectedPhotoItem: PhotoGridItem?

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Category segmented control
                Picker("Category", selection: $viewModel.selectedCategory) {
                    ForEach(ClusterCategory.allCases) { cat in
                        Text(cat.displayName)
                            .tag(cat)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.top, 12)
                .padding(.bottom, 8)

                // Stats bar
                if let stats = viewModel.categoryStats(for: viewModel.selectedCategory) {
                    HStack(spacing: 10) {
                        StatBadge(value: stats.detections, label: "Detections", icon: "eye.fill")
                        StatBadge(value: stats.photos, label: "Photos", icon: "photo.fill")
                        if let groups = stats.groups {
                            StatBadge(value: groups, label: "Groups", icon: "rectangle.stack.fill")
                        }
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 12)
                }

                // Cluster grid
                if viewModel.isLoading {
                    Spacer()
                    ProgressView("Loading...")
                        .font(.system(.body, design: .rounded))
                    Spacer()
                } else if let error = viewModel.error {
                    ContentUnavailableView(
                        "Error",
                        systemImage: "exclamationmark.triangle",
                        description: Text(error)
                    )
                } else if viewModel.clusters.isEmpty {
                    ContentUnavailableView(
                        "No \(viewModel.selectedCategory.displayName)",
                        systemImage: viewModel.selectedCategory.icon,
                        description: Text("No \(viewModel.selectedCategory.displayName.lowercased()) found yet. Sync your Flickr library to get started.")
                    )
                } else {
                    ScrollView {
                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(viewModel.clusters) { cluster in
                                NavigationLink(value: cluster) {
                                    ClusterCard(
                                        cluster: cluster,
                                        category: viewModel.selectedCategory,
                                        onRename: { newName in
                                            Task {
                                                await viewModel.renameCluster(clusterId: cluster.id, newName: newName)
                                            }
                                        }
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding()
                    }
                    .refreshable {
                        await viewModel.loadClusters()
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KindredTheme.warmBackground.ignoresSafeArea())
            .navigationTitle("Library")
            .toolbarTitleDisplayMode(.large)
            .navigationDestination(for: ClusterSummary.self) { cluster in
                ClusterDetailView(
                    cluster: cluster,
                    category: viewModel.selectedCategory,
                    viewModel: viewModel
                )
            }
            .task {
                await viewModel.loadStats()
                await viewModel.loadClusters()
            }
            .onChange(of: viewModel.selectedCategory) {
                Task {
                    await viewModel.loadClusters()
                }
            }
        }
        .tint(KindredTheme.pine)
    }
}

// MARK: - Cluster Card

struct ClusterCard: View {
    let cluster: ClusterSummary
    let category: ClusterCategory
    var onRename: ((String) -> Void)?
    @State private var showRename = false
    @State private var nameInput = ""

    var body: some View {
        VStack(spacing: 0) {
            // Cover photo with name overlay
            ZStack(alignment: .bottomLeading) {
                if let avatarURL = cluster.avatar ?? cluster.thumb_url,
                   let url = URL(string: avatarURL) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(height: 150)
                                .clipped()
                        default:
                            placeholderAvatar
                        }
                    }
                } else {
                    placeholderAvatar
                }

                // Name overlay at bottom
                VStack(alignment: .leading, spacing: 2) {
                    Text(cluster.label ?? "Unknown")
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)

                    Text("\(cluster.photo_count) photos")
                        .font(.system(.caption2, design: .rounded, weight: .medium))
                        .foregroundStyle(.white.opacity(0.85))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    LinearGradient(
                        colors: [.clear, KindredTheme.darkAccent.opacity(0.75)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            }
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.cardRadius))
        }
        .kindredCardStyle()
        .onLongPressGesture {
            nameInput = cluster.label ?? ""
            showRename = true
        }
        .alert("Rename", isPresented: $showRename) {
            TextField("Name", text: $nameInput)
            Button("Save") {
                if !nameInput.isEmpty {
                    onRename?(nameInput)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Enter a new name for this \(category.displayName.lowercased().dropLast()) group.")
        }
    }

    private var placeholderAvatar: some View {
        RoundedRectangle(cornerRadius: KindredTheme.cardRadius)
            .fill(KindredTheme.pine.opacity(0.12))
            .frame(height: 150)
            .overlay {
                Image(systemName: category.icon)
                    .font(.system(size: 32, weight: .light))
                    .foregroundStyle(KindredTheme.pine.opacity(0.5))
            }
    }
}

// MARK: - Stat Badge

struct StatBadge: View {
    let value: Int
    let label: String
    var icon: String = ""

    var body: some View {
        VStack(spacing: 3) {
            Text("\(value)")
                .font(.system(.headline, design: .rounded, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(KindredTheme.pine)
            Text(label)
                .font(.system(.caption2, design: .rounded, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(KindredTheme.warmCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .shadow(color: KindredTheme.cardShadow, radius: 3, x: 0, y: 1)
    }
}

// MARK: - Hashable conformance for navigation

extension ClusterSummary: Hashable {
    static func == (lhs: ClusterSummary, rhs: ClusterSummary) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}
