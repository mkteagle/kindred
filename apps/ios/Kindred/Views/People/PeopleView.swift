import SwiftUI

/// Screen 04 — People. A review banner over a three-up circular face grid.
///
/// Unnamed clusters are not hidden: naming them is the main job this screen
/// exists to hand out, so they sit in the grid in italic at .82 opacity.
struct PeopleView<Header: View>: View {
    @ViewBuilder var header: Header

    @State private var clusters: [ClusterSummary] = []
    @State private var unnamedCount = 0
    @State private var isLoading = true
    @State private var scrollOffset: CGFloat = 0
    @State private var reviewing = false
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var columns: [GridItem] {
        let count = horizontalSizeClass == .regular ? 5 : 3
        return Array(repeating: GridItem(.flexible(), spacing: 12), count: count)
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 0) {
                Color.clear.frame(height: 0).readsScrollOffset(in: "people")

                CollapsingTitleHeader(
                    eyebrow: "People first", title: "People", offset: scrollOffset
                )
                header
                    .padding(.bottom, 16)

                if unnamedCount > 0 {
                    reviewBanner
                        .padding(.horizontal, KindredTheme.gutter)
                        .padding(.bottom, 16)
                }

                if isLoading {
                    ProgressView()
                        .tint(KindredTheme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                } else {
                    LazyVGrid(columns: columns, spacing: 18) {
                        ForEach(clusters) { cluster in
                            NavigationLink(value: cluster) {
                                faceCell(cluster)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, KindredTheme.gutter)
                }

                Color.clear.frame(height: 100)
            }
        }
        .coordinateSpace(name: "people")
        .onPreferenceChange(ScrollOffsetKey.self) { scrollOffset = $0 }
        .navigationDestination(for: ClusterSummary.self) { cluster in
            PersonDetailView(cluster: cluster, category: .people)
        }
        .fullScreenCover(isPresented: $reviewing) {
            ReviewNamingView(queue: clusters.filter { $0.label == nil }) {
                Task { await load() }
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    // MARK: - Review banner

    private var reviewBanner: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(unnamedCount) need a name")
                    .font(.display(14, weight: .semibold, relativeTo: .headline))
                    .foregroundStyle(KindredTheme.ink)
                // TODO: the "possible duplicates" count needs an endpoint that
                // reports near-identical people clusters. /duplicates today
                // compares photos, not faces, so the line stays off until then.
                Text("Name them once and every photo follows")
                    .font(.kindredMeta)
                    .foregroundStyle(KindredTheme.inkMeta)
            }
            Spacer(minLength: 8)
            Button("Review") { reviewing = true }
                .font(.body(12, weight: .bold, relativeTo: .footnote))
                .foregroundStyle(KindredTheme.onAccent)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(KindredTheme.accent, in: RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .kindredCardStyle()
        .accessibilityElement(children: .contain)
    }

    // MARK: - Face cell

    private func faceCell(_ cluster: ClusterSummary) -> some View {
        VStack(spacing: 7) {
            FaceCircle(url: cluster.avatar ?? cluster.thumb_url)

            Text(cluster.label ?? "Unnamed")
                .font(.body(13, weight: .semibold, relativeTo: .subheadline))
                .italic(cluster.label == nil)
                .foregroundStyle(cluster.label == nil ? KindredTheme.inkBody : KindredTheme.ink)
                .lineLimit(1)

            Text("\(cluster.photo_count)")
                .font(.kindredMeta)
                .foregroundStyle(KindredTheme.inkMeta)
        }
        .opacity(cluster.label == nil ? 0.82 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(cluster.label ?? "Unnamed person"), \(cluster.photo_count) photos"
        )
    }

    // MARK: - Data

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await APIClient.shared.getClusterSummary(category: "people")
            // Named first, then the unnamed backlog, each by size.
            clusters = response.clusters.sorted { lhs, rhs in
                switch (lhs.label, rhs.label) {
                case (.some, .none): return true
                case (.none, .some): return false
                default: return lhs.photo_count > rhs.photo_count
                }
            }
            unnamedCount = clusters.filter { $0.label == nil }.count
        } catch {
            clusters = []
        }
    }
}

// MARK: - Animals and other categories

/// The same face grid for pets and vehicles, reached from the Library chips.
struct ClusterGridView<Header: View>: View {
    let category: ClusterCategory
    @ViewBuilder var header: Header

    @State private var clusters: [ClusterSummary] = []
    @State private var isLoading = true
    @State private var scrollOffset: CGFloat = 0
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var columns: [GridItem] {
        let count = horizontalSizeClass == .regular ? 5 : 3
        return Array(repeating: GridItem(.flexible(), spacing: 12), count: count)
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 0) {
                Color.clear.frame(height: 0).readsScrollOffset(in: "clusters")

                CollapsingTitleHeader(
                    eyebrow: "\(clusters.count) groups",
                    title: category.displayName,
                    offset: scrollOffset
                )
                header
                    .padding(.bottom, 16)

                if isLoading {
                    ProgressView()
                        .tint(KindredTheme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                } else {
                    LazyVGrid(columns: columns, spacing: 18) {
                        ForEach(clusters) { cluster in
                            NavigationLink(value: cluster) {
                                VStack(spacing: 7) {
                                    FaceCircle(url: cluster.avatar ?? cluster.thumb_url)
                                    Text(cluster.label ?? "Unnamed")
                                        .font(.body(13, weight: .semibold, relativeTo: .subheadline))
                                        .italic(cluster.label == nil)
                                        .foregroundStyle(
                                            cluster.label == nil ? KindredTheme.inkBody : KindredTheme.ink
                                        )
                                        .lineLimit(1)
                                    Text("\(cluster.photo_count)")
                                        .font(.kindredMeta)
                                        .foregroundStyle(KindredTheme.inkMeta)
                                }
                                .opacity(cluster.label == nil ? 0.82 : 1)
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel(
                                    "\(cluster.label ?? "Unnamed"), \(cluster.photo_count) photos"
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, KindredTheme.gutter)
                }

                Color.clear.frame(height: 100)
            }
        }
        .coordinateSpace(name: "clusters")
        .onPreferenceChange(ScrollOffsetKey.self) { scrollOffset = $0 }
        .navigationDestination(for: ClusterSummary.self) { cluster in
            PersonDetailView(cluster: cluster, category: category)
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        let response = try? await APIClient.shared.getClusterSummary(category: category.rawValue)
        clusters = (response?.clusters ?? []).sorted { $0.photo_count > $1.photo_count }
    }
}
