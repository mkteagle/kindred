import SwiftUI

/// Screen 06 — Search. One field, scope chips, the people the query matched as
/// pills, a mono result count, and a three-up grid with match badges.
struct SearchView: View {

    enum Scope: String, CaseIterable, Identifiable {
        case all = "All"
        case thisYear = "Taken this year"
        case videos = "Videos"
        var id: String { rawValue }
    }

    @State private var query = ""
    @State private var scope: Scope = .all
    @State private var results: [SearchHit] = []
    @State private var isSearching = false
    @State private var hasSearched = false
    @State private var error: String?
    @State private var scrollOffset: CGFloat = 0
    @State private var viewing: LibraryPhoto?
    @State private var activePerson: String?
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var fieldFocused: Bool
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var columns: [GridItem] {
        let count = horizontalSizeClass == .regular ? 5 : 3
        return Array(repeating: GridItem(.flexible(), spacing: KindredTheme.tileGap), count: count)
    }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    Color.clear.frame(height: 0).readsScrollOffset(in: "search")

                    CollapsingTitleHeader(
                        eyebrow: "Find anything", title: "Search", offset: scrollOffset
                    )

                    searchField
                        .padding(.horizontal, KindredTheme.gutter)

                    KindredChipRow(items: Scope.allCases, label: { $0.rawValue }, selection: $scope)
                        .padding(.top, 12)

                    if !peoplePills.isEmpty {
                        peoplePillRow
                            .padding(.top, 14)
                    }

                    if hasSearched {
                        Text(resultCountLine)
                            .font(.kindredMeta)
                            .foregroundStyle(KindredTheme.inkMeta)
                            .padding(.horizontal, KindredTheme.gutter)
                            .padding(.top, 14)
                            .padding(.bottom, 8)
                    }

                    if isSearching {
                        ProgressView()
                            .tint(KindredTheme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                    } else if hasSearched && visibleResults.isEmpty {
                        emptyState
                    } else {
                        resultGrid
                    }

                    Color.clear.frame(height: 100)
                }
            }
            .coordinateSpace(name: "search")
            .onPreferenceChange(ScrollOffsetKey.self) { scrollOffset = $0 }
            .background(KindredTheme.bg.ignoresSafeArea())
            .navigationBarHidden(true)
            .fullScreenCover(item: $viewing) { photo in
                PhotoViewerView(photos: visibleResults.map(\.asLibraryPhoto), initial: photo)
            }
        }
        .onChange(of: query) { _, _ in scheduleSearch() }
        .onChange(of: scope) { _, _ in scheduleSearch(immediate: true) }
    }

    // MARK: - Field

    private var searchField: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(KindredTheme.accent)
                .accessibilityHidden(true)

            TextField("Search your library", text: $query)
                .font(.display(16, weight: .medium, relativeTo: .body))
                .foregroundStyle(KindredTheme.ink)
                .tint(KindredTheme.accent)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($fieldFocused)
                .onSubmit { scheduleSearch(immediate: true) }
                .accessibilityLabel("Search your library")

            if !query.isEmpty {
                Button {
                    query = ""
                    results = []
                    hasSearched = false
                    activePerson = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(KindredTheme.bg)
                        .frame(width: 17, height: 17)
                        .background(Color(hex: 0xF1F1EC, alpha: 0.2), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 40)
        .background(KindredTheme.fillStrong)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - People pills

    /// The names the backend matched, in its own ranking. Tapping one narrows
    /// the grid to that person.
    private var peoplePills: [(id: String, name: String)] {
        var seen = Set<String>()
        var pills: [(String, String)] = []
        for hit in results {
            guard let id = hit.match_cluster_id, let name = hit.match_name,
                  !seen.contains(id) else { continue }
            seen.insert(id)
            pills.append((id, name))
        }
        return pills
    }

    private var peoplePillRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(peoplePills, id: \.id) { pill in
                    let isActive = activePerson == pill.id
                    Button {
                        activePerson = isActive ? nil : pill.id
                    } label: {
                        HStack(spacing: 7) {
                            KindredAvatar(url: nil, size: 22)
                            Text(pill.name)
                                .font(.body(12, weight: .semibold, relativeTo: .footnote))
                        }
                        .padding(.leading, 5)
                        .padding(.trailing, 11)
                        .padding(.vertical, 5)
                        .foregroundStyle(isActive ? KindredTheme.onAccent : KindredTheme.ink)
                        .background(isActive ? KindredTheme.accent : Color.clear, in: Capsule())
                        .overlay(
                            Capsule().stroke(
                                isActive ? .clear : Color(hex: 0xF1F1EC, alpha: 0.14), lineWidth: 1
                            )
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(pill.name)
                    .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
                }
            }
            .padding(.horizontal, KindredTheme.gutter)
        }
        .scrollClipDisabled()
    }

    // MARK: - Results

    private var visibleResults: [SearchHit] {
        guard let activePerson else { return results }
        return results.filter { $0.match_cluster_id == activePerson }
    }

    private var resultCountLine: String {
        let count = visibleResults.count
        let noun = count == 1 ? "result" : "results"
        return query.isEmpty ? "\(count) \(noun)" : "\(count) \(noun) · best match first"
    }

    private var resultGrid: some View {
        LazyVGrid(columns: columns, spacing: KindredTheme.tileGap) {
            ForEach(visibleResults) { hit in
                SquarePhotoTile(photo: hit.asLibraryPhoto, matchPercent: hit.matchPercent)
                    .onTapGesture { viewing = hit.asLibraryPhoto }
            }
        }
        .padding(.horizontal, KindredTheme.tileGap)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("Nothing matched.")
                .font(.kindredH3)
                .foregroundStyle(KindredTheme.ink)
            Text("Try a name, a place, or what you remember being in the picture.")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.inkBody)
                .multilineTextAlignment(.center)
            if let error {
                Text(error)
                    .font(.kindredCaption)
                    .foregroundStyle(KindredTheme.dangerText)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 40)
        .padding(.top, 60)
    }

    // MARK: - Querying

    private func scheduleSearch(immediate: Bool = false) {
        searchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        // An empty query with a scope set is still a valid filtered browse.
        guard !trimmed.isEmpty || scope != .all else {
            results = []
            hasSearched = false
            return
        }
        searchTask = Task {
            if !immediate {
                try? await Task.sleep(for: .milliseconds(280))
                guard !Task.isCancelled else { return }
            }
            await run(trimmed)
        }
    }

    private func run(_ trimmed: String) async {
        isSearching = true
        hasSearched = true
        error = nil
        defer { isSearching = false }

        if DemoDataProvider.shared.isActive {
            results = DemoDataProvider.shared.searchHits(query: trimmed)
            return
        }

        do {
            let response = try await APIClient.shared.searchLibrary(
                query: trimmed,
                media: scope == .videos ? .video : .all,
                dateFrom: scope == .thisYear ? SearchView.startOfYear : nil,
                limit: 120
            )
            guard !Task.isCancelled else { return }
            results = response.results
            if let activePerson, !results.contains(where: { $0.match_cluster_id == activePerson }) {
                self.activePerson = nil
            }
        } catch {
            guard !Task.isCancelled else { return }
            results = []
            self.error = error.localizedDescription
        }
    }

    private static var startOfYear: String {
        String(format: "%04d-01-01", Calendar.current.component(.year, from: Date()))
    }
}
