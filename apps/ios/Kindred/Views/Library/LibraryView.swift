import SwiftUI

enum LibrarySortOrder: String, CaseIterable {
    case mostPhotos = "Most photos first"
    case fewestPhotos = "Fewest photos first"
    case aToZ = "A \u{2192} Z"
    case zToA = "Z \u{2192} A"
    case recentlyUpdated = "Recently updated"
}

struct LibraryView: View {
    @State private var viewModel = LibraryViewModel()
    @State private var sortOrder: LibrarySortOrder = .mostPhotos
    @State private var showSortFilter = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Top bar
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Library")
                            .font(.kindredTitle)
                            .foregroundStyle(KindredTheme.ash)
                        if let stats = viewModel.categoryStats(for: viewModel.selectedCategory) {
                            Text("\(stats.photos) photos")
                                .font(.kindredMeta)
                                .foregroundStyle(KindredTheme.mist)
                        }
                    }
                    Spacer()
                    Button {
                        showSortFilter = true
                    } label: {
                        Circle()
                            .fill(KindredTheme.card)
                            .frame(width: 34, height: 34)
                            .overlay(Circle().stroke(KindredTheme.line, lineWidth: 1))
                            .overlay {
                                Image(systemName: "line.3.horizontal.decrease")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(KindredTheme.pine)
                            }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 6)

                // Chip filter row
                chipFilterRow

                // Content
                if viewModel.isLoading {
                    ScrollView {
                        masonrySkeletons
                    }
                } else if let error = viewModel.error {
                    ContentUnavailableView(
                        "Error",
                        systemImage: "exclamationmark.triangle",
                        description: Text(error)
                    )
                } else if viewModel.clusters.isEmpty {
                    emptyLibraryState
                } else {
                    ScrollView {
                        masonryGrid
                            .padding(.horizontal, 14)
                            .padding(.bottom, 110)
                    }
                    .refreshable {
                        await viewModel.loadClusters()
                    }
                }
            }
            .kindredPaperBackground()
            .navigationBarHidden(true)
            .navigationDestination(for: ClusterSummary.self) { cluster in
                ClusterDetailView(
                    cluster: cluster,
                    category: viewModel.selectedCategory,
                    viewModel: viewModel
                )
            }
            .confirmationDialog("Sort by", isPresented: $showSortFilter, titleVisibility: .visible) {
                ForEach(LibrarySortOrder.allCases, id: \.self) { order in
                    Button(order.rawValue) {
                        sortOrder = order
                    }
                }
                Button("Cancel", role: .cancel) {}
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
    }

    // MARK: - Sorted Clusters

    private var sortedClusters: [ClusterSummary] {
        switch sortOrder {
        case .mostPhotos:
            return viewModel.clusters.sorted { $0.photo_count > $1.photo_count }
        case .fewestPhotos:
            return viewModel.clusters.sorted { $0.photo_count < $1.photo_count }
        case .aToZ:
            return viewModel.clusters.sorted { ($0.label ?? "").localizedCaseInsensitiveCompare($1.label ?? "") == .orderedAscending }
        case .zToA:
            return viewModel.clusters.sorted { ($0.label ?? "").localizedCaseInsensitiveCompare($1.label ?? "") == .orderedDescending }
        case .recentlyUpdated:
            // No updated_at field available, keep original server order
            return viewModel.clusters
        }
    }

    // MARK: - Chip Filters

    private var chipFilterRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(ClusterCategory.allCases) { cat in
                    KindredChip(
                        label: cat.displayName,
                        count: categoryCount(for: cat),
                        isActive: viewModel.selectedCategory == cat
                    ) {
                        viewModel.selectedCategory = cat
                    }
                }
            }
            .padding(.horizontal, 20)
        }
        .padding(.top, 14)
        .padding(.bottom, 8)
    }

    private func categoryCount(for cat: ClusterCategory) -> Int {
        viewModel.categoryStats(for: cat)?.groups ?? 0
    }

    // MARK: - Masonry Grid

    private var masonryGrid: some View {
        let clusters = sortedClusters
        let leftColumn = clusters.enumerated().filter { $0.offset % 2 == 0 }.map(\.element)
        let rightColumn = clusters.enumerated().filter { $0.offset % 2 == 1 }.map(\.element)

        return HStack(alignment: .top, spacing: 10) {
            // Left column
            LazyVStack(spacing: 10) {
                ForEach(Array(leftColumn.enumerated()), id: \.element.id) { index, cluster in
                    NavigationLink(value: cluster) {
                        MasonryClusterCard(
                            cluster: cluster,
                            category: viewModel.selectedCategory,
                            height: masonryHeight(for: index * 2),
                            onRename: { newName in
                                Task { await viewModel.renameCluster(clusterId: cluster.id, newName: newName) }
                            }
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            // Right column
            LazyVStack(spacing: 10) {
                ForEach(Array(rightColumn.enumerated()), id: \.element.id) { index, cluster in
                    NavigationLink(value: cluster) {
                        MasonryClusterCard(
                            cluster: cluster,
                            category: viewModel.selectedCategory,
                            height: masonryHeight(for: index * 2 + 1),
                            onRename: { newName in
                                Task { await viewModel.renameCluster(clusterId: cluster.id, newName: newName) }
                            }
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func masonryHeight(for index: Int) -> CGFloat {
        let heights: [CGFloat] = [160, 120, 140, 170, 130, 150]
        return heights[index % heights.count]
    }

    // MARK: - Skeletons

    private var masonrySkeletons: some View {
        HStack(alignment: .top, spacing: 10) {
            LazyVStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { i in
                    SkeletonCard()
                        .frame(height: masonryHeight(for: i * 2))
                        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                }
            }
            LazyVStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { i in
                    SkeletonCard()
                        .frame(height: masonryHeight(for: i * 2 + 1))
                        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 6)
    }

    // MARK: - Empty State

    private var emptyLibraryState: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: viewModel.selectedCategory.icon)
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(KindredTheme.pine.opacity(0.4))
            Text("No \(viewModel.selectedCategory.displayName.lowercased()) yet")
                .font(.kindredH3)
                .foregroundStyle(KindredTheme.ash)
            Text("Sync your library to get started.")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.mist)
            Spacer()
        }
    }
}

// MARK: - Masonry Cluster Card

struct MasonryClusterCard: View {
    let cluster: ClusterSummary
    let category: ClusterCategory
    var height: CGFloat = 150
    var onRename: ((String) -> Void)?
    @State private var showRename = false
    @State private var nameInput = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Cover photo
            let coverURL = cluster.photo_url ?? cluster.thumb_url ?? cluster.avatar
            ZStack(alignment: .bottomLeading) {
                if let urlStr = coverURL, DemoDataProvider.isDemoURL(urlStr) {
                    DemoThumbnailView(urlString: urlStr, cornerRadius: 0)
                        .frame(height: height)
                        .clipped()
                } else if let urlStr = coverURL, let url = URL(string: urlStr) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFill()
                        default:
                            KindredTheme.canvas
                        }
                    }
                    .frame(height: height)
                    .clipped()
                } else {
                    KindredTheme.canvas
                        .frame(height: height)
                        .overlay {
                            Image(systemName: category.icon)
                                .font(.system(size: 24, weight: .light))
                                .foregroundStyle(KindredTheme.pine.opacity(0.3))
                        }
                }

                // Photo count badge
                PhotoCountBadge(count: cluster.photo_count)
                    .padding(8)
            }

            // Name
            VStack(alignment: .leading, spacing: 0) {
                Text(cluster.label ?? "Unnamed")
                    .font(.kindredCardTitle)
                    .foregroundStyle(KindredTheme.ash)
                    .italic(cluster.label == nil)
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .background(KindredTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
        .overlay(
            RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                .stroke(KindredTheme.line, lineWidth: 1)
        )
        .shadow(color: Color(hex: 0x11161B).opacity(0.07), radius: 11, x: 0, y: 10)
        .contextMenu {
            Button {
                nameInput = cluster.label ?? ""
                showRename = true
            } label: {
                Label("Rename", systemImage: "pencil")
            }
        }
        .alert("Rename", isPresented: $showRename) {
            TextField("Name", text: $nameInput)
            Button("Save") {
                if !nameInput.isEmpty { onRename?(nameInput) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Enter a new name for this \(category.displayName.lowercased().dropLast()) group.")
        }
    }
}

// MARK: - Stat Badge (redesigned)

struct StatBadge: View {
    let value: Int
    let label: String

    var body: some View {
        KindredStatCard(value: "\(value)", label: label)
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
