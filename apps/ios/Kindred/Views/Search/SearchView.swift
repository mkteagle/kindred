import SwiftUI

struct SearchView: View {
    @State private var viewModel = SearchViewModel()
    @State private var selectedPhoto: PhotoGridItem?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                HStack(spacing: 12) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(KindredTheme.pine)
                    TextField("Search people, places, things...", text: $viewModel.query)
                        .font(.system(.body, design: .rounded))
                        .textFieldStyle(.plain)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .submitLabel(.search)
                        .onSubmit {
                            viewModel.search()
                        }
                    if !viewModel.query.isEmpty {
                        Button {
                            viewModel.query = ""
                            viewModel.results = []
                            viewModel.hasSearched = false
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(12)
                .background(KindredTheme.warmCardBackground)
                .clipShape(RoundedRectangle(cornerRadius: KindredTheme.cardRadius))
                .shadow(color: KindredTheme.cardShadow, radius: 4, x: 0, y: 2)
                .padding(.horizontal)
                .padding(.vertical, 10)

                // Results
                if viewModel.isSearching {
                    Spacer()
                    ProgressView("Searching...")
                        .font(.system(.body, design: .rounded))
                    Spacer()
                } else if viewModel.hasSearched && viewModel.results.isEmpty {
                    ContentUnavailableView.search(text: viewModel.query)
                } else if !viewModel.results.isEmpty {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            // Matched people/clusters section
                            let personResults = viewModel.results.filter { $0.match_type == "person" }
                            let uniqueClusters = uniqueMatchedClusters(from: personResults)

                            if !uniqueClusters.isEmpty {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("People")
                                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal)

                                    ScrollView(.horizontal, showsIndicators: false) {
                                        HStack(spacing: 12) {
                                            ForEach(uniqueClusters, id: \.clusterId) { match in
                                                matchedPersonCard(match: match, photoCount: personResults.filter { $0.match_cluster_id == match.clusterId }.count)
                                            }
                                        }
                                        .padding(.horizontal)
                                    }
                                }
                            }

                            // Photo results
                            let photoResults = viewModel.results.filter { $0.match_type != "person" }
                            if !photoResults.isEmpty || !personResults.isEmpty {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(photoResults.isEmpty ? "\(personResults.count) photos" : "\(viewModel.results.count) results")
                                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal)

                                    let items = viewModel.results.map { PhotoGridItem(from: $0) }
                                    PhotoGridView(photoURLs: items) { item in
                                        selectedPhoto = item
                                    }
                                }
                            }
                        }
                        .padding(.top, 4)
                    }
                } else {
                    // Empty state
                    Spacer()
                    VStack(spacing: 16) {
                        Image(systemName: "text.magnifyingglass")
                            .font(.system(size: 48, weight: .light))
                            .foregroundStyle(KindredTheme.pine.opacity(0.6))
                        Text("Search your photos")
                            .font(.system(.title3, design: .rounded, weight: .semibold))
                            .foregroundStyle(KindredTheme.darkAccent)
                        Text("Try names like \"Jen\" or \"Mike\", or describe a scene like \"sunset\" or \"birthday cake\".")
                            .font(.system(.subheadline, design: .rounded))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }
                    Spacer()
                }

                if let error = viewModel.error {
                    Text(error)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(.red)
                        .padding()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(KindredTheme.warmBackground.ignoresSafeArea())
            .navigationTitle("Search")
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
            .sheet(item: $selectedPhoto) { item in
                FullScreenPhotoView(item: item)
            }
            .onChange(of: viewModel.query) {
                viewModel.search()
            }
        }
        .tint(KindredTheme.pine)
    }

    // MARK: - Helpers

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
            if let urlStr = match.thumbURL, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 72, height: 72)
                            .clipShape(Circle())
                    } else {
                        Circle()
                            .fill(KindredTheme.pine.opacity(0.15))
                            .frame(width: 72, height: 72)
                    }
                }
            } else {
                Circle()
                    .fill(KindredTheme.pine.opacity(0.15))
                    .frame(width: 72, height: 72)
                    .overlay {
                        Image(systemName: "person.fill")
                            .foregroundStyle(KindredTheme.pine.opacity(0.5))
                    }
            }
            Text(match.name)
                .font(.system(.caption, design: .rounded, weight: .semibold))
                .foregroundStyle(KindredTheme.darkAccent)
                .lineLimit(1)
            Text("\(photoCount) photos")
                .font(.system(.caption2, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .frame(width: 90)
    }
}
