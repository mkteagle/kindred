import SwiftUI

struct SearchView: View {
    var isActive = true
    var onNavigateToTab: ((Int) -> Void)? = nil

    private enum Scope: String, CaseIterable {
        case all = "All"
        case videos = "Videos"
        case thisYear = "This year"
    }

    private struct Request: Equatable {
        let text: String
        let date: SearchDateRange?
        let media: MediaFilter
    }

    @State private var query = ""
    @State private var scope: Scope = .all
    @State private var isBrowsing = false
    @State private var history: [String] = []
    @State private var photos: [LibraryPhoto] = []
    @State private var people: [String: String] = [:]
    @State private var personForPhoto: [String: String] = [:]
    @State private var selectedPerson: String?
    @State private var request: Request?
    @State private var nextCursor: String?
    @State private var isLoading = false
    @State private var isLoadingPage = false
    @State private var failed = false
    @State private var pageFailed = false
    @State private var searchTask: Task<Void, Never>?
    @State private var pageTask: Task<Void, Never>?
    @State private var viewing: [LibraryPhoto]?
    @State private var selectedPhoto: LibraryPhoto?
    @State private var showInbox = false
    @State private var inboxVM = InboxViewModel()
    @ObservedObject private var readState = NotificationReadState.shared
    @FocusState private var fieldFocused: Bool
    @Environment(\.horizontalSizeClass) private var widthClass

    private let pageSize = 60
    private let textResultLimit = 120

    private var parsed: SearchDateRange.Parsed { SearchDateRange.parse(query) }
    private var showResults: Bool { !parsed.original.isEmpty || isBrowsing }
    private var visiblePhotos: [LibraryPhoto] {
        guard let selectedPerson else { return photos }
        return photos.filter { personForPhoto[$0.id] == selectedPerson }
    }
    private var expanded: Bool { KindredTabletLayout.isExpanded(widthClass) }
    private var gutter: CGFloat { expanded ? KindredTabletLayout.gutter : KindredTheme.gutter }
    private var canvasWidth: CGFloat { expanded ? KindredTabletLayout.canvasWidth : 760 }
    private var gridGap: CGFloat { expanded ? 10 : 6 }
    private var columns: [GridItem] {
        if expanded { return [GridItem(.adaptive(minimum: 160), spacing: gridGap)] }
        return Array(repeating: GridItem(.flexible(), spacing: gridGap), count: 2)
    }
    private var historyKey: String? {
        guard !DemoDataProvider.shared.isActive, let id = SessionManager.shared.currentUser?.id else { return nil }
        return "kindred_recent_searches.\(id)"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Search")
                        .font(.display(expanded ? 42 : 34, weight: .bold, relativeTo: .largeTitle))
                        .foregroundStyle(KindredTheme.ink)
                        .accessibilityAddTraits(.isHeader)
                        .padding(.top, expanded ? 17 : 8)
                        .padding(.bottom, expanded ? 22 : 15)

                    searchField
                    if showResults {
                        resultsContent.padding(.top, 14)
                    } else {
                        startContent.padding(.top, 25)
                    }
                }
                .padding(.horizontal, gutter)
                .padding(.bottom, 28)
                .frame(maxWidth: canvasWidth)
                .frame(maxWidth: .infinity)
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                KindredAppBar(unreadCount: inboxVM.unreadCount(readState: readState), horizontalInset: gutter) {
                    showInbox = true
                }
                .frame(maxWidth: canvasWidth)
                .frame(maxWidth: .infinity)
                .background(KindredTheme.bg)
            }
            .accessibilityIdentifier("search.scrollView")
            .scrollDismissesKeyboard(.interactively)
            .scrollIndicators(.hidden)
            .kindredPaperBackground()
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showInbox) {
                NotificationInboxView(onNavigateToTab: onNavigateToTab)
            }
            .fullScreenCover(item: $selectedPhoto, onDismiss: { viewing = nil }) { photo in
                PhotoViewerView(photos: viewing ?? [photo], initial: photo)
            }
        }
        .onAppear {
            if let historyKey {
                history = UserDefaults.standard.stringArray(forKey: historyKey) ?? []
            }
        }
        .task(id: isActive) {
            if isActive { await inboxVM.loadSyncHistory() }
        }
        .onChange(of: isActive) { _, active in
            if !active { fieldFocused = false }
        }
        .onChange(of: query) { _, _ in scheduleSearch() }
        .onDisappear {
            searchTask?.cancel()
            pageTask?.cancel()
            request = nil
        }
        .task {
            if showResults, request == nil { scheduleSearch(immediate: true) }
        }
    }

    private var searchField: some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 19))
                .accessibilityHidden(true)
            TextField("Search your library", text: $query,
                      prompt: Text("Search your library").foregroundStyle(KindredTheme.inkMeta))
                .font(.body(16, weight: .medium, relativeTo: .body))
                .foregroundStyle(KindredTheme.ink)
                .tint(KindredTheme.accent)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($fieldFocused)
                .onSubmit {
                    fieldFocused = false
                    rememberSearch()
                    scheduleSearch(immediate: true)
                }
                .accessibilityLabel("Search your library")
                .accessibilityIdentifier("search.input")
            if showResults {
                Button(action: clearSearch) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 17))
                        .frame(width: 40, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .foregroundStyle(KindredTheme.inkMeta)
        .padding(.leading, 14)
        .padding(.trailing, showResults ? 2 : 14)
        .frame(minHeight: expanded ? 56 : 46)
        .background(KindredTheme.fillStrongest, in: .rect(cornerRadius: expanded ? 16 : 12))
    }

    private var startContent: some View {
        VStack(alignment: .leading, spacing: 31) {
            if !history.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    heading("Recent searches")
                    horizontalChips {
                        ForEach(history, id: \.self) { recent in
                            Button {
                                query = recent
                                isBrowsing = false
                                scope = .all
                                fieldFocused = false
                                rememberSearch()
                                scheduleSearch(immediate: true)
                            } label: {
                                chipLabel(recent, icon: "clock")
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .accessibilityIdentifier("search.recents")
                }
            }

            VStack(alignment: .leading, spacing: 12) {
                heading("Browse")
                browseRow("All photos", icon: "photo", scope: .all)
                browseRow("Videos", icon: "play.rectangle", scope: .videos)
                browseRow("This year", icon: "calendar", scope: .thisYear)
            }
        }
    }

    private func heading(_ title: String) -> some View {
        Text(title)
            .font(.display(22, weight: .bold, relativeTo: .title2))
            .foregroundStyle(KindredTheme.ink)
            .accessibilityAddTraits(.isHeader)
    }

    private func browseRow(_ title: String, icon: String, scope selectedScope: Scope) -> some View {
        Button {
            isBrowsing = true
            fieldFocused = false
            selectScope(selectedScope)
        } label: {
            HStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundStyle(KindredTheme.inkSecondary)
                    .frame(width: 24)
                    .accessibilityHidden(true)
                Text(title)
                    .font(.body(16, weight: .medium, relativeTo: .body))
                    .foregroundStyle(KindredTheme.ink)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(KindredTheme.inkMeta)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 47)
            .background(KindredTheme.fillStrongest, in: .rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    private var resultsContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            horizontalChips {
                ForEach(Scope.allCases, id: \.self) { item in
                    Button {
                        selectScope(item)
                    } label: {
                        chipLabel(item.rawValue, isSelected: scope == item)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(scope == item ? .isSelected : [])
                }
            }
            if let date = parsed.date {
                Button {
                    query = parsed.text
                    scope = scope == .thisYear ? .all : scope
                    scheduleSearch(immediate: true)
                } label: {
                    chipLabel(date.label, icon: "calendar", trailingIcon: "xmark", isSelected: true)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove date filter, \(date.label)")
                .accessibilityIdentifier("search.dateFilter")
            }

            if !people.isEmpty { peopleChips }

            if isLoading && photos.isEmpty {
                skeleton
            } else if failed && photos.isEmpty {
                message("Couldn’t load results", detail: nil, retry: true)
            } else if visiblePhotos.isEmpty {
                if request != nil {
                    message("No results", detail: "Try another date, name, or description.", retry: false)
                }
            } else {
                Text(resultCount)
                    .font(.body(15, weight: .medium, relativeTo: .subheadline))
                    .foregroundStyle(KindredTheme.inkSecondary)
                    .accessibilityIdentifier("search.resultCount")
                resultsGrid
            }
        }
    }

    private var peopleChips: some View {
        horizontalChips {
            ForEach(people.keys.sorted { people[$0, default: ""] < people[$1, default: ""] }, id: \.self) { key in
                Button {
                    selectedPerson = selectedPerson == key ? nil : key
                } label: {
                    chipLabel(people[key, default: ""], icon: "person.crop.circle", isSelected: selectedPerson == key)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selectedPerson == key ? .isSelected : [])
            }
        }
    }

    private func horizontalChips<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8, content: content)
        }
        .scrollIndicators(.hidden)
    }

    private func chipLabel(
        _ title: String, icon: String? = nil, trailingIcon: String? = nil, isSelected: Bool = false
    ) -> some View {
        HStack(spacing: 7) {
            if let icon {
                Image(systemName: icon).accessibilityHidden(true)
            }
            Text(title).lineLimit(1)
            if let trailingIcon {
                Image(systemName: trailingIcon).font(.caption).accessibilityHidden(true)
            }
        }
        .font(.body(14, weight: .medium, relativeTo: .subheadline))
        .foregroundStyle(KindredTheme.ink)
        .padding(.horizontal, 14)
        .frame(minHeight: 36)
        .background(isSelected ? KindredTheme.accent.opacity(0.34) : KindredTheme.fillStrongest, in: Capsule())
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private var resultCount: String {
        let count = visiblePhotos.count
        if nextCursor != nil || (request?.text.isEmpty == false && count == textResultLimit) {
            return "\(count)+ results"
        }
        return count == 1 ? "1 result" : "\(count) results"
    }

    private var resultsGrid: some View {
        VStack(spacing: 12) {
            LazyVGrid(columns: columns, spacing: gridGap) {
                ForEach(visiblePhotos) { photo in
                    Button {
                        fieldFocused = false
                        rememberSearch()
                        viewing = visiblePhotos
                        selectedPhoto = photo
                    } label: {
                        PhotoTile(photo: photo, cornerRadius: 12)
                            .aspectRatio(1, contentMode: .fit)
                    }
                    .buttonStyle(.plain)
                    .task {
                        guard photos.suffix(6).contains(where: { $0.id == photo.id }), !pageFailed else { return }
                        loadNextPage()
                    }
                }
            }
            if pageFailed {
                Button("Couldn’t load more results. Try again", action: loadNextPage)
                    .foregroundStyle(KindredTheme.accent)
                    .padding(.vertical, 8)
            } else if isLoadingPage || isLoading {
                ProgressView().padding(.vertical, 8)
            }
        }
    }

    private var skeleton: some View {
        LazyVGrid(columns: columns, spacing: gridGap) {
            ForEach(0..<4, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 12)
                    .fill(KindredTheme.tile)
                    .aspectRatio(1, contentMode: .fit)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading search results")
    }

    private func message(_ title: String, detail: String?, retry: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.kindredH3).foregroundStyle(KindredTheme.ink)
            if let detail {
                Text(detail).font(.kindredBody).foregroundStyle(KindredTheme.inkSecondary)
            }
            if retry {
                Button("Try again") { scheduleSearch(immediate: true, force: true) }
                    .foregroundStyle(KindredTheme.accent)
                    .padding(.vertical, 6)
            }
        }
        .padding(.vertical, 14)
    }

    private func rememberSearch() {
        let value = parsed.original
        guard !value.isEmpty else { return }
        history = Array(([value] + history.filter { $0.caseInsensitiveCompare(value) != .orderedSame }).prefix(8))
        if let historyKey { UserDefaults.standard.set(history, forKey: historyKey) }
    }

    private func clearSearch() {
        isBrowsing = false
        scope = .all
        query = ""
        fieldFocused = false
        scheduleSearch(immediate: true)
    }

    private func selectScope(_ item: Scope) {
        if item == .thisYear, parsed.date != nil {
            query = parsed.text
            if query.isEmpty { isBrowsing = true }
        }
        scope = item
        scheduleSearch(immediate: true)
    }

    private func scheduleSearch(immediate: Bool = false, force: Bool = false) {
        let parsed = parsed
        let next = showResults ? Request(
            text: parsed.text, date: parsed.date ?? (scope == .thisYear ? .thisYear : nil),
            media: scope == .videos ? .video : .all
        ) : nil
        if !force, let next, request == next, !failed, (!isLoading || !immediate) { return }

        searchTask?.cancel()
        pageTask?.cancel()
        request = next
        nextCursor = nil
        photos = []
        people = [:]
        personForPhoto = [:]
        selectedPerson = nil
        failed = false
        pageFailed = false
        isLoadingPage = false
        guard let next else { isLoading = false; return }
        isLoading = true
        searchTask = Task {
            do {
                if !immediate { try await Task.sleep(for: .milliseconds(280)) }
                if next.text.isEmpty {
                    let page = try await catalogPage(for: next)
                    try Task.checkCancellation()
                    photos = page.photos
                    nextCursor = page.next_cursor
                } else {
                    try await searchText(for: next)
                }
            } catch where !Task.isCancelled {
                failed = true
            } catch {}
            if !Task.isCancelled { isLoading = false }
        }
    }

    private func catalogPage(for request: Request, cursor: String? = nil) async throws -> LibraryPage {
        if DemoDataProvider.shared.isActive {
            let photos = DemoDataProvider.shared.libraryPage(media: request.media).photos.filter {
                request.date?.contains($0.date_taken) ?? true
            }
            return LibraryPage(photos: photos, next_cursor: nil)
        }
        return try await APIClient.shared.libraryPhotos(
            media: request.media, cursor: cursor,
            dateFrom: request.date?.start, dateTo: request.date?.end, limit: pageSize
        )
    }

    private func searchText(for request: Request) async throws {
        if DemoDataProvider.shared.isActive {
            let hits = DemoDataProvider.shared.searchHits(query: request.text).filter { hit in
                (request.media != .video || hit.media_kind == .video)
                    && (request.date?.contains(hit.date_taken) ?? true)
            }
            applyHits(hits)
            return
        }

        let direct = try await APIClient.shared.searchLibrary(
            query: request.text, media: request.media, dateFrom: request.date?.start,
            dateTo: request.date?.end, limit: textResultLimit, mode: .quick
        )
        try Task.checkCancellation()
        applyHits(direct.results)
        guard direct.visual_pending == true else { return }

        do {
            let visual = try await APIClient.shared.searchLibrary(
                query: request.text, media: request.media, dateFrom: request.date?.start,
                dateTo: request.date?.end, limit: textResultLimit, mode: .visual
            )
            try Task.checkCancellation()
            applyHits(Array((direct.results + visual.results).uniquedByPhoto().prefix(textResultLimit)))
        } catch where !photos.isEmpty && !Task.isCancelled {
            // Keep the direct matches when the visual service is unavailable.
        }
    }

    private func applyHits(_ hits: [SearchHit]) {
        photos = hits.uniquedByPhoto().map(\.asLibraryPhoto)
        for hit in hits {
            guard let id = hit.match_cluster_id, let name = hit.match_name else { continue }
            people[id] = name
            personForPhoto[hit.photo_id] = id
        }
    }

    private func loadNextPage() {
        guard !isLoading, !isLoadingPage, let request, let cursor = nextCursor else { return }
        isLoadingPage = true
        pageFailed = false
        pageTask = Task {
            do {
                let page = try await catalogPage(for: request, cursor: cursor)
                try Task.checkCancellation()
                let known = Set(photos.map(\.id))
                photos.append(contentsOf: page.photos.filter { !known.contains($0.id) })
                nextCursor = page.next_cursor == cursor ? nil : page.next_cursor
            } catch where !Task.isCancelled {
                pageFailed = true
            } catch {}
            if !Task.isCancelled { isLoadingPage = false }
        }
    }
}

private extension Array where Element == SearchHit {
    func uniquedByPhoto() -> [SearchHit] {
        var seen = Set<String>()
        return filter { seen.insert($0.photo_id).inserted }
    }
}
