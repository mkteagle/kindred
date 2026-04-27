import SwiftUI

// MARK: - Together Picker

struct TogetherPickerView: View {
    @State private var viewModel = TogetherViewModel()
    @State private var searchText = ""
    @State private var showResults = false
    @State private var selectedPhoto: PhotoGridItem?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        // Header
                        headerSection

                        // Selected chips
                        if !viewModel.selectedPeople.isEmpty {
                            selectedChipsRow
                        }

                        // Search bar
                        searchBar

                        // People grid
                        if viewModel.isLoadingPeople {
                            loadingGrid
                        } else {
                            peopleGrid
                        }

                        // Recent pairings
                        recentPairings

                        Spacer().frame(height: 120)
                    }
                }
                .kindredPaperBackground()

                // Sticky CTA
                stickyCTA
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(KindredTheme.ash)
                            .frame(width: 34, height: 34)
                            .background(KindredTheme.card)
                            .clipShape(Circle())
                            .overlay(Circle().stroke(KindredTheme.line, lineWidth: 1))
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("Together")
                        .font(.display(16, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Text("\(viewModel.selectedPeople.count) / \(viewModel.peopleClusters.count)")
                        .font(.mono(10))
                        .tracking(1.4)
                        .foregroundStyle(KindredTheme.mist)
                }
            }
            .navigationDestination(isPresented: $showResults) {
                TogetherResultsView(viewModel: viewModel, selectedPhoto: $selectedPhoto)
            }
            .sheet(item: $selectedPhoto) { item in
                FullScreenPhotoView(item: item)
            }
            .task {
                await viewModel.loadPeople()
            }
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredEyebrow(text: "Find photos with\u{2026}")
                .padding(.horizontal, 20)
                .padding(.top, 14)

            Text("Pick the people\nin the picture.")
                .font(.display(28, weight: .bold))
                .foregroundStyle(KindredTheme.ash)
                .lineSpacing(-4)
                .tracking(-0.28)
                .padding(.horizontal, 20)
                .padding(.top, 6)

            Text("Choose two or more \u{2014} Kindred will surface every photo where they all appear together.")
                .font(.kindredCaption)
                .foregroundStyle(KindredTheme.pine)
                .lineSpacing(2)
                .padding(.horizontal, 20)
                .padding(.top, 10)
        }
    }

    // MARK: - Selected Chips

    private var selectedChipsRow: some View {
        HStack(spacing: 8) {
            ForEach(viewModel.selectedClusters, id: \.id) { cluster in
                HStack(spacing: 6) {
                    KindredAvatar(url: cluster.avatar ?? cluster.thumb_url, size: 22, borderWidth: 0)
                    Text(cluster.label?.split(separator: " ").first.map(String.init) ?? "?")
                        .font(.display(12, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                    Button {
                        withAnimation(.easeOut(duration: 0.2)) {
                            viewModel.togglePerson(cluster.id)
                        }
                    } label: {
                        Text("\u{00d7}")
                            .font(.mono(11))
                            .foregroundStyle(KindredTheme.mist)
                    }
                }
                .padding(.leading, 4)
                .padding(.trailing, 10)
                .padding(.vertical, 4)
                .background(.white)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(KindredTheme.lineDark, lineWidth: 1))
            }

            Spacer()

            if viewModel.selectedPeople.count < 2 {
                Text("+ ANY ONE MORE")
                    .font(.mono(10, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(KindredTheme.ember)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(KindredTheme.ember.opacity(0.08))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(KindredTheme.ember.opacity(0.2), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 16)
        .padding(.top, 14)
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14))
                .foregroundStyle(KindredTheme.mist)
            TextField("Search the household\u{2026}", text: $searchText)
                .font(.kindredCaption)
                .foregroundStyle(KindredTheme.ash)
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(KindredTheme.mist)
                }
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 38)
        .background(KindredTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
        .overlay(
            RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                .stroke(KindredTheme.line, lineWidth: 1)
        )
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    // MARK: - People Grid

    private var filteredPeople: [ClusterSummary] {
        if searchText.isEmpty { return viewModel.peopleClusters }
        return viewModel.peopleClusters.filter {
            ($0.label ?? "").localizedCaseInsensitiveContains(searchText)
        }
    }

    private var peopleGridColumnCount: Int {
        // Cannot use @Environment here, so check via UIDevice
        UIDevice.current.userInterfaceIdiom == .pad ? 6 : 4
    }

    private var peopleGrid: some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredEyebrow(text: "Household \u{00b7} \(viewModel.peopleClusters.count) named", color: KindredTheme.pine)
                .padding(.horizontal, 16)
                .padding(.top, 14)

            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: peopleGridColumnCount),
                spacing: 12
            ) {
                ForEach(filteredPeople, id: \.id) { person in
                    personTile(person)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
        }
    }

    private func personTile(_ person: ClusterSummary) -> some View {
        let isSelected = viewModel.selectedPeople.contains(person.id)
        return Button {
            withAnimation(.easeOut(duration: 0.2)) {
                viewModel.togglePerson(person.id)
            }
        } label: {
            VStack(spacing: 6) {
                ZStack(alignment: .bottomTrailing) {
                    let avatarURL = person.avatar ?? person.thumb_url
                    if let urlStr = avatarURL, let url = URL(string: urlStr) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image.resizable().scaledToFill()
                            default:
                                KindredTheme.avatarGradient
                                    .overlay {
                                        Image(systemName: "person.fill")
                                            .font(.system(size: 20))
                                            .foregroundStyle(.white.opacity(0.8))
                                    }
                            }
                        }
                        .frame(width: 56, height: 56)
                        .clipShape(Circle())
                        .overlay(
                            Circle()
                                .stroke(isSelected ? KindredTheme.ember : KindredTheme.line, lineWidth: isSelected ? 2.5 : 1.5)
                                .padding(isSelected ? -2 : 0)
                        )
                        .shadow(color: isSelected ? KindredTheme.ember.opacity(0.2) : KindredTheme.cardShadow, radius: isSelected ? 8 : 4, x: 0, y: isSelected ? 6 : 4)
                        .saturation(isSelected ? 1 : 0.85)
                    } else {
                        KindredInitialsAvatar(
                            initials: String((person.label ?? "?").prefix(1)),
                            size: 56
                        )
                        .overlay(
                            Circle()
                                .stroke(isSelected ? KindredTheme.ember : .clear, lineWidth: 2.5)
                                .padding(-2)
                        )
                    }

                    if isSelected {
                        Circle()
                            .fill(KindredTheme.ember)
                            .frame(width: 22, height: 22)
                            .overlay(
                                Image(systemName: "checkmark")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(.white)
                            )
                            .overlay(Circle().stroke(.white, lineWidth: 2))
                            .offset(x: 2, y: 2)
                    }
                }

                Text(person.label?.split(separator: " ").first.map(String.init) ?? "?")
                    .font(.display(12, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                    .lineLimit(1)

                Text(person.photo_count.formatted())
                    .font(.mono(9))
                    .tracking(0.4)
                    .foregroundStyle(KindredTheme.mist)
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Recent Pairings

    private var recentPairings: some View {
        VStack(alignment: .leading, spacing: 0) {
            if viewModel.peopleClusters.count >= 2 {
                KindredEyebrow(text: "Recent pairings", color: KindredTheme.pine)
                    .padding(.horizontal, 16)
                    .padding(.top, 22)

                // Show first couple suggested pairings from top clusters
                ForEach(suggestedPairings.prefix(3), id: \.0) { pairing in
                    pairingRow(pairing.1, pairing.2)
                }
            }
        }
    }

    private var suggestedPairings: [(String, ClusterSummary, ClusterSummary)] {
        let top = viewModel.peopleClusters.prefix(6)
        var pairs: [(String, ClusterSummary, ClusterSummary)] = []
        for i in 0..<top.count {
            for j in (i+1)..<top.count {
                let a = top[top.index(top.startIndex, offsetBy: i)]
                let b = top[top.index(top.startIndex, offsetBy: j)]
                pairs.append(("\(a.id)-\(b.id)", a, b))
            }
            if pairs.count >= 3 { break }
        }
        return pairs
    }

    private func pairingRow(_ a: ClusterSummary, _ b: ClusterSummary) -> some View {
        Button {
            viewModel.selectedPeople = [a.id, b.id]
            Task {
                await viewModel.searchTogether()
                showResults = true
            }
        } label: {
            HStack(spacing: 10) {
                HStack(spacing: -8) {
                    KindredAvatar(url: a.avatar ?? a.thumb_url, size: 28, borderWidth: 2)
                    KindredAvatar(url: b.avatar ?? b.thumb_url, size: 28, borderWidth: 2)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(a.label ?? "?") & \(b.label ?? "?")")
                        .font(.display(13, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                    Text("Tap to find shared photos")
                        .font(.mono(9))
                        .tracking(0.6)
                        .foregroundStyle(KindredTheme.mist)
                }
                Spacer()
                Text("\u{203a}")
                    .font(.mono(11))
                    .foregroundStyle(KindredTheme.mist)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(KindredTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
            .overlay(
                RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                    .stroke(KindredTheme.line, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    // MARK: - Loading Grid

    private var loadingGrid: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: peopleGridColumnCount),
            spacing: 12
        ) {
            ForEach(0..<(peopleGridColumnCount * 2), id: \.self) { _ in
                VStack(spacing: 6) {
                    Circle()
                        .fill(KindredTheme.canvas)
                        .frame(width: 56, height: 56)
                        .kindredShimmer()
                    RoundedRectangle(cornerRadius: 3)
                        .fill(KindredTheme.canvas)
                        .frame(width: 40, height: 10)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 24)
    }

    // MARK: - Sticky CTA

    private var stickyCTA: some View {
        VStack(spacing: 0) {
            LinearGradient(
                colors: [KindredTheme.paper.opacity(0), KindredTheme.paper.opacity(0.95)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 30)

            Button {
                Task {
                    await viewModel.searchTogether()
                    showResults = true
                }
            } label: {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Show photos together")
                            .font(.display(14, weight: .bold))
                            .foregroundStyle(viewModel.canSearch ? KindredTheme.paper : KindredTheme.mist)
                        if viewModel.canSearch {
                            Text("SEARCHING \(viewModel.selectedPeople.count) PEOPLE")
                                .font(.mono(9, weight: .semibold))
                                .tracking(1.4)
                                .foregroundStyle(KindredTheme.paper.opacity(0.6))
                        }
                    }
                    Spacer()
                    Circle()
                        .fill(viewModel.canSearch ? KindredTheme.ember : KindredTheme.ash.opacity(0.2))
                        .frame(width: 32, height: 32)
                        .overlay(
                            Image(systemName: "arrow.right")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(.white)
                        )
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(viewModel.canSearch ? KindredTheme.ash : KindredTheme.ash.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .shadow(color: KindredTheme.cardShadowHeavy, radius: 16, x: 0, y: 16)
            }
            .disabled(!viewModel.canSearch)
            .padding(.horizontal, 16)
            .padding(.bottom, 22)
            .background(KindredTheme.paper.opacity(0.95))
        }
    }
}

// MARK: - Together Results

struct TogetherResultsView: View {
    @Bindable var viewModel: TogetherViewModel
    @Binding var selectedPhoto: PhotoGridItem?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var photoColumns: [GridItem] {
        let count = horizontalSizeClass == .regular ? 5 : 3
        return Array(repeating: GridItem(.flexible(), spacing: 4), count: count)
    }

    var body: some View {
        ZStack {
            if viewModel.totalCount == 0 && !viewModel.isSearching {
                emptyState
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        // Avatar stack + summary
                        avatarHeader

                        // Filter chips
                        filterChips

                        // Photo grid
                        if viewModel.isSearching {
                            ProgressView()
                                .tint(KindredTheme.ember)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 60)
                        } else {
                            photosGrid
                        }

                        Spacer().frame(height: 120)
                    }
                }
            }
        }
        .kindredPaperBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Together")
                    .font(.display(16, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { } label: {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(KindredTheme.ash)
                        .frame(width: 34, height: 34)
                        .background(KindredTheme.card)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(KindredTheme.line, lineWidth: 1))
                }
            }
        }
    }

    // MARK: - Avatar Header

    private var avatarHeader: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                ForEach(Array(viewModel.selectedClusters.enumerated()), id: \.element.id) { index, cluster in
                    KindredAvatar(url: cluster.avatar ?? cluster.thumb_url, size: 44, borderWidth: 3)
                        .padding(.leading, index == 0 ? 0 : -10)
                        .zIndex(Double(viewModel.selectedClusters.count - index))
                }

                Button {
                    dismiss()
                } label: {
                    Text("EDIT \u{203a}")
                        .font(.mono(9, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(KindredTheme.forest)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(KindredTheme.forest.opacity(0.12))
                        .clipShape(Capsule())
                }
                .padding(.leading, 10)
            }

            // Names
            let names = viewModel.selectedClusters.map { $0.label?.split(separator: " ").first.map(String.init) ?? "?" }
            if names.count == 2 {
                (Text(names[0])
                    .foregroundStyle(KindredTheme.ash) +
                Text(" & ")
                    .foregroundStyle(KindredTheme.mist) +
                Text(names[1])
                    .foregroundStyle(KindredTheme.ash))
                    .font(.display(24, weight: .bold))
                    .padding(.top, 6)
            } else if names.count > 2 {
                let allButLast = names.dropLast().joined(separator: ", ")
                (Text(allButLast)
                    .foregroundStyle(KindredTheme.ash) +
                Text(" & ")
                    .foregroundStyle(KindredTheme.mist) +
                Text(names.last ?? "")
                    .foregroundStyle(KindredTheme.ash))
                    .font(.display(24, weight: .bold))
                    .padding(.top, 6)
            }

            // Photo count
            HStack(spacing: 0) {
                Text("\(viewModel.totalCount)")
                    .font(.mono(10, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(KindredTheme.ember)
                Text(" PHOTOS")
                    .font(.mono(10, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(KindredTheme.pine)
            }
            .padding(.top, 8)
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
    }

    // MARK: - Filter Chips

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                filterChip("All", isActive: viewModel.activeFilter == "all") {
                    viewModel.activeFilter = "all"
                }
                filterChip("Year \u{25be}", isActive: false) { }
                filterChip("Place \u{25be}", isActive: false) { }
                filterChip("Just these \(viewModel.selectedPeople.count)", isActive: false) { }
            }
            .padding(.horizontal, 16)
        }
        .padding(.top, 12)
    }

    private func filterChip(_ label: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.display(11, weight: .semibold))
                .foregroundStyle(isActive ? KindredTheme.paper : KindredTheme.ash)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isActive ? KindredTheme.ash : KindredTheme.card)
                .clipShape(Capsule())
                .overlay(
                    Capsule()
                        .stroke(isActive ? Color.clear : KindredTheme.line, lineWidth: 1)
                )
        }
    }

    // MARK: - Photos Grid

    private var photosGrid: some View {
        LazyVGrid(columns: photoColumns, spacing: 4) {
            ForEach(viewModel.results) { photo in
                let item = PhotoGridItem(from: photo)
                let thumbOrPhoto = photo.thumb_url ?? photo.photo_url
                Group {
                    if DemoDataProvider.isDemoURL(thumbOrPhoto) {
                        DemoThumbnailView(urlString: thumbOrPhoto, cornerRadius: 4)
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
                .frame(minWidth: 0, maxWidth: .infinity)
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .contentShape(Rectangle())
                .onTapGesture {
                    selectedPhoto = item
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Avatar stack
            HStack(spacing: -8) {
                ForEach(viewModel.selectedClusters, id: \.id) { cluster in
                    KindredAvatar(url: cluster.avatar ?? cluster.thumb_url, size: 36, borderWidth: 3)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)

            // Names
            let names = viewModel.selectedClusters.map { $0.label?.split(separator: " ").first.map(String.init) ?? "?" }
            if names.count >= 2 {
                (Text(names.dropLast().joined(separator: ", "))
                    .foregroundStyle(KindredTheme.ash) +
                Text(" & ")
                    .foregroundStyle(KindredTheme.mist) +
                Text(names.last ?? "")
                    .foregroundStyle(KindredTheme.ash))
                    .font(.display(24, weight: .bold))
                    .padding(.horizontal, 20)
                    .padding(.top, 10)
            }

            HStack(spacing: 0) {
                Text("0")
                    .font(.mono(10, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(KindredTheme.ember)
                Text(" PHOTOS YET")
                    .font(.mono(10, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(KindredTheme.pine)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)

            // Empty illustration
            VStack(spacing: 14) {
                Circle()
                    .fill(KindredTheme.gold.opacity(0.18))
                    .frame(width: 72, height: 72)
                    .overlay(
                        Image(systemName: "person.2.slash")
                            .font(.system(size: 28, weight: .light))
                            .foregroundStyle(KindredTheme.gold)
                    )

                Text("They haven't crossed paths.")
                    .font(.display(17, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)

                Text("Kindred didn't find any photos with all selected people. Try rescanning, or pick someone else.")
                    .font(.kindredCaption)
                    .foregroundStyle(KindredTheme.pine)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
            .padding(.vertical, 32)
            .background(KindredTheme.card)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(KindredTheme.lineDark, style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal, 24)
            .padding(.top, 32)

            // Suggestions
            suggestedAlternatives

            Spacer()

            // Back CTA
            Button { dismiss() } label: {
                Text("\u{2190} Pick someone else")
                    .font(.display(13, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(KindredTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(KindredTheme.lineDark, lineWidth: 1)
                    )
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 22)
        }
    }

    private var suggestedAlternatives: some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredEyebrow(text: "Try one of these instead", color: KindredTheme.pine)
                .padding(.horizontal, 20)
                .padding(.top, 24)

            let top = viewModel.peopleClusters.prefix(4)
            ForEach(0..<min(3, max(0, top.count - 1)), id: \.self) { i in
                let a = top[top.index(top.startIndex, offsetBy: i)]
                let b = top[top.index(top.startIndex, offsetBy: i + 1)]
                Button {
                    viewModel.selectedPeople = [a.id, b.id]
                    Task { await viewModel.searchTogether() }
                } label: {
                    HStack(spacing: 10) {
                        HStack(spacing: -8) {
                            KindredAvatar(url: a.avatar ?? a.thumb_url, size: 28, borderWidth: 2)
                            KindredAvatar(url: b.avatar ?? b.thumb_url, size: 28, borderWidth: 2)
                        }
                        VStack(alignment: .leading, spacing: 1) {
                            Text("\(a.label ?? "?") & \(b.label ?? "?")")
                                .font(.display(13, weight: .bold))
                                .foregroundStyle(KindredTheme.ash)
                        }
                        Spacer()
                        Text("\u{203a}")
                            .font(.mono(11, weight: .semibold))
                            .foregroundStyle(KindredTheme.ember)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(KindredTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(KindredTheme.line, lineWidth: 1)
                    )
                }
                .contentShape(Rectangle())
            .buttonStyle(.plain)
                .padding(.horizontal, 20)
                .padding(.top, 10)
            }
        }
    }
}
