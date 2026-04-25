import SwiftUI

struct LibraryView: View {
    @State private var viewModel = LibraryViewModel()

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
                .padding(.vertical, 8)

                // Content
                if viewModel.isLoading {
                    // Skeleton loading
                    ScrollView {
                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(0..<6, id: \.self) { _ in
                                SkeletonCard()
                            }
                        }
                        .padding(.horizontal)
                        .padding(.top, 4)
                    }
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
                        description: Text("Sync your library to get started.")
                    )
                } else {
                    ScrollView {
                        // Stats row
                        if let stats = viewModel.categoryStats(for: viewModel.selectedCategory) {
                            HStack(spacing: 10) {
                                StatBadge(value: stats.detections, label: "Detections")
                                StatBadge(value: stats.photos, label: "Photos")
                                if let groups = stats.groups {
                                    StatBadge(value: groups, label: "Groups")
                                }
                            }
                            .padding(.horizontal)
                            .padding(.bottom, 8)
                        }

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
                        .padding(.horizontal)
                    }
                    .refreshable {
                        await viewModel.loadClusters()
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(KindredTheme.warmBackground.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Image("KindredLogo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 32, height: 32)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
            .navigationTitle("Library")
            .toolbarTitleDisplayMode(.inline)
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

// MARK: - Cluster Card (cover photo + face pip)

struct ClusterCard: View {
    let cluster: ClusterSummary
    let category: ClusterCategory
    var onRename: ((String) -> Void)?
    @State private var showRename = false
    @State private var nameInput = ""

    var body: some View {
        VStack(spacing: 0) {
            // Cover photo with face pip overlay
            ZStack(alignment: .bottomLeading) {
                // Use the full photo as cover, not the face chip
                let coverURL = cluster.photo_url ?? cluster.thumb_url ?? cluster.avatar
                if let urlStr = coverURL, let url = URL(string: urlStr) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(height: 160)
                                .clipped()
                        default:
                            skeletonCover
                        }
                    }
                } else {
                    placeholderCover
                }

                // Face detection pip in bottom-right
                if let avatarURL = cluster.avatar, let url = URL(string: avatarURL) {
                    AsyncImage(url: url) { phase in
                        if case .success(let image) = phase {
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: 36, height: 36)
                                .clipShape(Circle())
                                .overlay(Circle().stroke(.white, lineWidth: 2))
                                .shadow(color: .black.opacity(0.3), radius: 3, x: 0, y: 1)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .padding(8)
                }

                // Name + count overlay at bottom
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(cluster.label ?? "Unknown")
                            .font(.system(.subheadline, design: .rounded, weight: .bold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        Text("\(cluster.photo_count) photos")
                            .font(.system(.caption2, design: .rounded, weight: .medium))
                            .foregroundStyle(.white.opacity(0.85))
                    }
                    Spacer()
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.55)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            }
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.cardRadius))
        }
        .shadow(color: KindredTheme.cardShadow, radius: 4, x: 0, y: 2)
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

    private var skeletonCover: some View {
        RoundedRectangle(cornerRadius: KindredTheme.cardRadius)
            .fill(KindredTheme.warmCardBackground)
            .frame(height: 160)
            .overlay {
                RoundedRectangle(cornerRadius: KindredTheme.cardRadius)
                    .fill(
                        LinearGradient(
                            colors: [KindredTheme.warmCardBackground, KindredTheme.warmCardBackground.opacity(0.5), KindredTheme.warmCardBackground],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
            }
    }

    private var placeholderCover: some View {
        RoundedRectangle(cornerRadius: KindredTheme.cardRadius)
            .fill(KindredTheme.pine.opacity(0.1))
            .frame(height: 160)
            .overlay {
                Image(systemName: category.icon)
                    .font(.system(size: 28, weight: .light))
                    .foregroundStyle(KindredTheme.pine.opacity(0.4))
            }
    }
}

// MARK: - Skeleton Card

struct SkeletonCard: View {
    @State private var shimmer = false

    var body: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: KindredTheme.cardRadius)
                .fill(KindredTheme.warmCardBackground)
                .frame(height: 160)
                .overlay {
                    RoundedRectangle(cornerRadius: KindredTheme.cardRadius)
                        .fill(
                            LinearGradient(
                                colors: [.clear, .white.opacity(0.3), .clear],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .offset(x: shimmer ? 200 : -200)
                        .animation(.easeInOut(duration: 1.2).repeatForever(autoreverses: false), value: shimmer)
                }
                .clipped()
        }
        .shadow(color: KindredTheme.cardShadow, radius: 4, x: 0, y: 2)
        .onAppear { shimmer = true }
    }
}

// MARK: - Stat Badge

struct StatBadge: View {
    let value: Int
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(.system(.subheadline, design: .rounded, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(KindredTheme.pine)
            Text(label)
                .font(.system(.caption2, design: .rounded, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(KindredTheme.warmCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 8))
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
