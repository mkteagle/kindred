import SwiftUI

struct SearchView: View {
    @State private var viewModel = SearchViewModel()
    @State private var selectedPhoto: PhotoGridItem?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Page header
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        KindredEyebrow(text: "Search")
                        Text("What are you looking for?")
                            .font(.kindredH2)
                            .foregroundStyle(KindredTheme.ash)
                    }
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.top, 10)
                .padding(.bottom, 4)

                // Search input
                searchInput

                // Content
                if viewModel.isSearching {
                    Spacer()
                    ProgressView()
                        .tint(KindredTheme.ember)
                    Spacer()
                } else if viewModel.hasSearched && viewModel.results.isEmpty {
                    ContentUnavailableView.search(text: viewModel.query)
                } else if !viewModel.results.isEmpty {
                    searchResults
                } else {
                    defaultBrowseContent
                }
            }
            .kindredPaperBackground()
            .navigationBarHidden(true)
            .sheet(item: $selectedPhoto) { item in
                FullScreenPhotoView(item: item)
            }
            .onChange(of: viewModel.query) {
                viewModel.search()
            }
        }
    }

    // MARK: - Search Input

    private var searchInput: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(KindredTheme.mist)

            TextField("People, places, or things…", text: $viewModel.query)
                .font(.kindredBody)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .onSubmit { viewModel.search() }

            if !viewModel.query.isEmpty {
                Button {
                    viewModel.query = ""
                    viewModel.results = []
                    viewModel.hasSearched = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(KindredTheme.mist)
                }
            } else {
                Text("VOICE")
                    .font(.kindredMicro)
                    .tracking(1.4)
                    .foregroundStyle(KindredTheme.pine)
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 46)
        .background(KindredTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
        .overlay(
            RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                .stroke(KindredTheme.lineDark, lineWidth: 1)
        )
        .shadow(color: Color(hex: 0x11161B).opacity(0.06), radius: 11, x: 0, y: 10)
        .padding(.horizontal, 20)
        .padding(.top, 14)
    }

    // MARK: - Search Results

    private var searchResults: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // People matches
                let personResults = viewModel.results.filter { $0.match_type == "person" }
                let uniqueClusters = uniqueMatchedClusters(from: personResults)

                if !uniqueClusters.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        KindredEyebrow(text: "People")
                            .padding(.horizontal, 20)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(uniqueClusters, id: \.clusterId) { match in
                                    matchedPersonCard(
                                        match: match,
                                        photoCount: personResults.filter { $0.match_cluster_id == match.clusterId }.count
                                    )
                                }
                            }
                            .padding(.horizontal, 20)
                        }
                    }
                }

                // Photo results grid
                let items = viewModel.results.map { PhotoGridItem(from: $0) }
                if !items.isEmpty {
                    KindredEyebrow(text: "\(items.count) results")
                        .padding(.horizontal, 20)

                    PhotoGridView(photoURLs: items) { item in
                        selectedPhoto = item
                    }
                }
            }
            .padding(.top, 16)
            .padding(.bottom, 110)
        }
    }

    // MARK: - Default Browse Content (empty state)

    private var defaultBrowseContent: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "magnifyingglass")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(KindredTheme.pine.opacity(0.4))
            Text("Search your photos")
                .font(.kindredH3)
                .foregroundStyle(KindredTheme.ash)
            Text("Try names, places, or things\u{2026}")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.mist)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Matched Person Card

    struct MatchedCluster {
        let clusterId: String
        let name: String
        let category: String
        let thumbURL: String?
    }

    private func uniqueMatchedClusters(from results: [SearchResult]) -> [MatchedCluster] {
        var seen = Set<String>()
        var clusters: [MatchedCluster] = []
        for r in results {
            guard let cid = r.match_cluster_id, !seen.contains(cid) else { continue }
            seen.insert(cid)
            clusters.append(MatchedCluster(
                clusterId: cid,
                name: r.match_name ?? "Unknown",
                category: r.match_category ?? "people",
                thumbURL: r.thumb_url
            ))
        }
        return clusters
    }

    private func matchedPersonCard(match: MatchedCluster, photoCount: Int) -> some View {
        VStack(spacing: 6) {
            KindredAvatar(url: match.thumbURL, size: 56)
            Text(match.name)
                .font(.display(12, weight: .bold))
                .foregroundStyle(KindredTheme.ash)
                .lineLimit(1)
            Text("\(photoCount) photos")
                .font(.kindredMicro)
                .foregroundStyle(KindredTheme.mist)
        }
        .frame(width: 72)
    }
}
