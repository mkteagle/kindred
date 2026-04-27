import SwiftUI

struct HomeView: View {
    @State private var libraryVM = LibraryViewModel()
    @State private var exploreVM = ExploreViewModel()
    @State private var inboxVM = InboxViewModel()
    @ObservedObject private var readState = NotificationReadState.shared
    @State private var selectedPhoto: PhotoGridItem?
    @State private var showTogether = false
    @State private var showMemory = false
    @State private var showInbox = false
    @State private var lastLoadedAt: Date?
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isIPad: Bool { horizontalSizeClass == .regular }

    /// Callback for tab navigation from notification taps
    var onNavigateToTab: ((Int) -> Void)? = nil

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    // App bar
                    KindredAppBar(
                        unreadCount: inboxVM.unreadCount(readState: readState),
                        onBellTap: { showInbox = true }
                    )

                    // Greeting
                    greetingBlock

                    // Memory wall scatter
                    memoryWallScatter

                    // Together feature link
                    togetherLink

                    // "Worth finding again" carousel
                    worthFindingSection

                    // People row
                    peopleRow

                    // "On this day" card
                    onThisDayCard

                    Spacer().frame(height: isIPad ? 32 : 110)
                }
                .frame(maxWidth: isIPad ? 900 : .infinity, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .kindredPaperBackground()
            .navigationBarHidden(true)
            .navigationDestination(for: ClusterSummary.self) { cluster in
                ClusterDetailView(
                    cluster: cluster,
                    category: .people,
                    viewModel: libraryVM
                )
            }
            .sheet(item: $selectedPhoto) { item in
                FullScreenPhotoView(item: item)
            }
            .fullScreenCover(isPresented: $showTogether) {
                TogetherPickerView()
            }
            .fullScreenCover(isPresented: $showMemory) {
                MemoryView(
                    photos: onThisDayPhotos,
                    title: onThisDayTitle,
                    subtitle: "\(onThisDayPhotos.count) photos from \(onThisDayYear)"
                )
            }
            .sheet(isPresented: $showInbox) {
                NotificationInboxView(
                    onNavigateToTab: onNavigateToTab
                )
            }
            .task {
                async let stats: () = libraryVM.loadStats()
                async let clusters: () = libraryVM.loadClusters()
                async let timeline: () = exploreVM.loadTimeline()
                async let inbox: () = inboxVM.loadSyncHistory()
                _ = await (stats, clusters, timeline, inbox)
                lastLoadedAt = Date()
            }
            .refreshable {
                async let clusters: () = libraryVM.loadClusters()
                async let timeline: () = exploreVM.loadTimeline()
                async let inbox: () = inboxVM.loadSyncHistory()
                _ = await (clusters, timeline, inbox)
                lastLoadedAt = Date()
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
                // Refresh if data is older than 5 minutes
                if let loaded = lastLoadedAt, Date().timeIntervalSince(loaded) > 300 {
                    Task {
                        await libraryVM.loadClusters()
                        await exploreVM.loadTimeline()
                        await inboxVM.loadSyncHistory()
                        lastLoadedAt = Date()
                    }
                }
            }
        }
    }

    // MARK: - Greeting

    private var greetingBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            KindredEyebrow(text: greetingTimeOfDay, color: KindredTheme.gold)
            Text("A quieter view\nof your week.")
                .font(.display(34, weight: .bold))
                .foregroundStyle(KindredTheme.ash)
                .lineSpacing(-4)
                .tracking(-0.34)
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 6)
    }

    private var greetingTimeOfDay: String {
        let hour = Calendar.current.component(.hour, from: Date())
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE"
        let day = formatter.string(from: Date())
        switch hour {
        case 5..<12: return "\(day) morning"
        case 12..<17: return "\(day) afternoon"
        case 17..<21: return "\(day) evening"
        default: return "\(day) night"
        }
    }

    // MARK: - Memory Wall Scatter

    private var memoryWallScatter: some View {
        GeometryReader { geo in
            let w = geo.size.width
            ZStack {
                let recentPhotos = recentPhotoURLs(count: 4)

                if recentPhotos.count >= 4 {
                    scatterItem(url: recentPhotos[0], x: w * 0.20, y: 50, size: w * 0.28, rotation: -8, z: 1)
                    scatterItem(url: recentPhotos[1], x: w * 0.72, y: 30, size: w * 0.30, rotation: 6, z: 2)
                    scatterItem(url: recentPhotos[2], x: w * 0.42, y: 100, size: w * 0.34, rotation: -1, z: 5)
                    scatterItem(url: recentPhotos[3], x: w * 0.75, y: 110, size: w * 0.26, rotation: 4, z: 3)
                } else {
                    placeholderScatter(width: w)
                }

                // Badge
                VStack(alignment: .leading, spacing: 1) {
                    Text("THIS WEEK")
                        .font(.mono(8, weight: .semibold))
                        .tracking(1.1)
                        .foregroundStyle(KindredTheme.gold)
                    Text("\(recentPhotoCount) new moments")
                        .font(.display(12, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    KindredTheme.paper.opacity(0.94)
                        .background(.ultraThinMaterial)
                )
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(KindredTheme.line, lineWidth: 1)
                )
                .shadow(color: KindredTheme.cardShadow, radius: 11, x: 0, y: 10)
                .position(x: w * 0.72, y: 148)
            }
        }
        .frame(height: isIPad ? 260 : 195)
        .clipped() // Prevent photos from bleeding into content below
        .padding(.horizontal, 14)
        .padding(.top, 16)
        .padding(.bottom, 4)
    }

    private func scatterItem(url: String, x: CGFloat, y: CGFloat, size: CGFloat, rotation: Double, z: Int) -> some View {
        Group {
            if DemoDataProvider.isDemoURL(url) {
                DemoThumbnailView(urlString: url, cornerRadius: 4)
            } else {
                AsyncImage(url: URL(string: url)) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        KindredTheme.canvas
                    }
                }
            }
        }
        .frame(width: size, height: size * 1.25)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .padding(5)
        .background(Color.white.opacity(0.95))
        .rotationEffect(.degrees(rotation))
        .shadow(color: KindredTheme.cardShadow, radius: 14, x: 0, y: 14)
        .position(x: x, y: y)
        .zIndex(Double(z))
    }

    private func placeholderScatter(width w: CGFloat) -> some View {
        ForEach(0..<4, id: \.self) { i in
            let configs: [(x: CGFloat, y: CGFloat, s: CGFloat, r: Double)] = [
                (0.20, 50, 0.28, -8), (0.72, 30, 0.30, 6),
                (0.42, 100, 0.34, -1), (0.75, 110, 0.26, 4),
            ]
            let c = configs[i]
            RoundedRectangle(cornerRadius: 4)
                .fill(KindredTheme.canvas)
                .frame(width: w * c.s, height: w * c.s * 1.25)
                .padding(5)
                .background(KindredTheme.card)
                .rotationEffect(.degrees(c.r))
                .shadow(color: KindredTheme.cardShadow, radius: 14, x: 0, y: 14)
                .position(x: w * c.x, y: c.y)
                .zIndex(Double(i))
        }
    }

    // MARK: - Together Link

    private var togetherLink: some View {
        Button { showTogether = true } label: {
            HStack(spacing: 12) {
                // Stacked avatar preview
                ZStack {
                    ForEach(Array(topClusters.prefix(3).enumerated()), id: \.element.id) { index, cluster in
                        KindredAvatar(url: cluster.avatar ?? cluster.thumb_url, size: 32, borderWidth: 2)
                            .offset(x: CGFloat(index) * 14)
                            .zIndex(Double(3 - index))
                    }
                }
                .frame(width: 60, alignment: .leading)

                VStack(alignment: .leading, spacing: 3) {
                    Text("Together")
                        .font(.kindredCardTitle)
                        .foregroundStyle(KindredTheme.ash)
                    Text("Find photos with multiple people")
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.mist)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(KindredTheme.ember)
            }
            .padding(14)
            .background(KindredTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusMD))
            .overlay(
                RoundedRectangle(cornerRadius: KindredTheme.radiusMD)
                    .stroke(KindredTheme.line, lineWidth: 1)
            )
            .shadow(color: KindredTheme.cardShadow, radius: 8, x: 0, y: 6)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 20)
        .padding(.top, 16)
    }

    // MARK: - Worth Finding Again

    private var worthFindingSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredSectionHeader(
                eyebrow: "For you",
                title: "Worth finding again",
                trailingText: "See all →"
            )
            .padding(.horizontal, 20)
            .padding(.top, 14)
            .padding(.bottom, 8)

            if libraryVM.isLoading {
                // Skeleton cards while loading
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: isIPad ? 16 : 12) {
                        ForEach(0..<(isIPad ? 5 : 3), id: \.self) { _ in
                            VStack(alignment: .leading, spacing: 0) {
                                SkeletonCard()
                                    .frame(width: isIPad ? 240 : 200, height: isIPad ? 160 : 130)
                                VStack(alignment: .leading, spacing: 6) {
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(KindredTheme.canvas)
                                        .frame(width: 120, height: 14)
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(KindredTheme.canvas)
                                        .frame(width: 80, height: 10)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 12)
                            }
                            .frame(width: isIPad ? 240 : 200)
                            .kindredCardStyle()
                        }
                    }
                    .padding(.leading, 20)
                }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: isIPad ? 16 : 12) {
                        ForEach(topClusters.prefix(isIPad ? 10 : 6)) { cluster in
                            NavigationLink(value: cluster) {
                                memoryCard(cluster: cluster)
                            }
                            .contentShape(Rectangle())
                            .buttonStyle(.plain)
                        }
                        Spacer().frame(width: 8)
                    }
                    .padding(.leading, 20)
                }
            }
        }
    }

    private func memoryCard(cluster: ClusterSummary) -> some View {
        let cardWidth: CGFloat = isIPad ? 240 : 200
        let cardHeight: CGFloat = isIPad ? 160 : 130
        return VStack(alignment: .leading, spacing: 0) {
            // Cover image
            let coverURL = cluster.photo_url ?? cluster.thumb_url ?? cluster.avatar
            Group {
                if let coverURL, DemoDataProvider.isDemoURL(coverURL) {
                    DemoThumbnailView(urlString: coverURL, cornerRadius: 0)
                } else {
                    AsyncImage(url: URL(string: coverURL ?? "")) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFill()
                        default:
                            KindredTheme.canvas
                        }
                    }
                }
            }
            .frame(width: cardWidth, height: cardHeight)
            .clipped()

            VStack(alignment: .leading, spacing: 4) {
                Text(cluster.label ?? "Unnamed")
                    .font(.kindredCardTitle)
                    .foregroundStyle(KindredTheme.ash)
                    .lineLimit(1)
                Text("\(cluster.photo_count) photos")
                    .font(.kindredMeta)
                    .foregroundStyle(KindredTheme.mist)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .frame(width: cardWidth)
        .background(KindredTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
        .overlay(
            RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                .stroke(KindredTheme.line, lineWidth: 1)
        )
        .shadow(color: Color(hex: 0x11161B).opacity(0.08), radius: 14, x: 0, y: 12)
    }

    // MARK: - People Row

    private var peopleRow: some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredSectionHeader(eyebrow: "People", title: "You keep coming back to")
                .padding(.horizontal, 20)
                .padding(.top, 22)
                .padding(.bottom, 8)

            if libraryVM.isLoading {
                // Skeleton avatars
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: isIPad ? 18 : 14) {
                        ForEach(0..<(isIPad ? 10 : 6), id: \.self) { _ in
                            VStack(spacing: 4) {
                                Circle()
                                    .fill(KindredTheme.canvas)
                                    .frame(width: isIPad ? 64 : 56, height: isIPad ? 64 : 56)
                                    .kindredShimmer()
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(KindredTheme.canvas)
                                    .frame(width: 40, height: 10)
                            }
                            .frame(width: isIPad ? 72 : 60)
                        }
                    }
                    .padding(.leading, 20)
                }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: isIPad ? 18 : 14) {
                        ForEach(topClusters.prefix(isIPad ? 14 : 8)) { cluster in
                            NavigationLink(value: cluster) {
                                VStack(spacing: 4) {
                                    KindredAvatar(url: cluster.avatar ?? cluster.thumb_url, size: isIPad ? 64 : 56)
                                    Text(cluster.label?.split(separator: " ").first.map(String.init) ?? "?")
                                        .font(.kindredName)
                                        .foregroundStyle(KindredTheme.ash)
                                        .lineLimit(1)
                                    Text("\(cluster.photo_count)")
                                        .font(.kindredMicro)
                                        .foregroundStyle(KindredTheme.mist)
                                }
                                .frame(width: isIPad ? 72 : 60)
                            }
                            .contentShape(Rectangle())
                            .buttonStyle(.plain)
                        }
                        Spacer().frame(width: 8)
                    }
                    .padding(.leading, 20)
                }
            }
        }
    }

    // MARK: - On This Day

    private var onThisDayCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            KindredEyebrow(text: "On this day · \(onThisDayYear)", color: KindredTheme.ember)

            Text(onThisDayTitle)
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ash)
                .lineSpacing(-1)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 6) {
                // Thumbnail row — only show what fits
                ForEach(onThisDayPhotos.prefix(3), id: \.id) { photo in
                    let thumbOrPhoto = photo.thumbURL ?? photo.photoURL
                    Group {
                        if DemoDataProvider.isDemoURL(thumbOrPhoto) {
                            DemoThumbnailView(urlString: thumbOrPhoto, cornerRadius: 6)
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
                    .frame(width: 52, height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }

                Spacer()

                VStack(spacing: 6) {
                    Button {
                        showMemory = true
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "play.fill")
                                .font(.system(size: 9))
                            Text("Play")
                                .font(.body(12, weight: .bold))
                        }
                        .foregroundStyle(KindredTheme.paper)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(KindredTheme.ember)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    Button {
                        selectedPhoto = onThisDayPhotos.first
                    } label: {
                        Text("Open")
                            .font(.body(12, weight: .bold))
                            .foregroundStyle(KindredTheme.ash)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(KindredTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(KindredTheme.line, lineWidth: 1)
                            )
                    }
                }
            }
            .padding(.top, 6)
        }
        .padding(18)
        .background(KindredTheme.canvas)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(KindredTheme.line, lineWidth: 1)
        )
        .padding(.horizontal, 20)
        .padding(.top, 24)
    }

    // MARK: - Data Helpers

    private var topClusters: [ClusterSummary] {
        libraryVM.clusters.sorted { $0.photo_count > $1.photo_count }
    }

    private func recentPhotoURLs(count: Int) -> [String] {
        var urls: [String] = []
        for month in exploreVM.timeline.prefix(2) {
            for photo in month.photos {
                if let thumb = photo.thumb_url {
                    urls.append(thumb)
                }
                if urls.count >= count { return urls }
            }
        }
        return urls
    }

    private var recentPhotoCount: Int {
        exploreVM.timeline.first?.count ?? 0
    }

    private var onThisDayPhotos: [PhotoGridItem] {
        // Use oldest timeline month's photos as "on this day" placeholder
        guard let oldMonth = exploreVM.timeline.last else { return [] }
        return oldMonth.photos.prefix(3).map { photo in
            PhotoGridItem(
                id: photo.photo_id,
                photoURL: photo.thumb_url ?? "",
                thumbURL: photo.thumb_url,
                flickrURL: photo.flickr_url,
                title: photo.photo_title
            )
        }
    }

    private var onThisDayYear: String {
        guard let month = exploreVM.timeline.last else { return "2022" }
        return String(month.month.prefix(4))
    }

    private var onThisDayTitle: String {
        guard let month = exploreVM.timeline.last else {
            return "The afternoon the light\ncame through the kitchen."
        }
        // Format "2009-06" → "June 2009"
        let parts = month.month.split(separator: "-")
        if parts.count == 2, let monthNum = Int(parts[1]) {
            let formatter = DateFormatter()
            let monthName = formatter.monthSymbols[max(0, monthNum - 1)]
            return "Moments from\n\(monthName) \(parts[0])"
        }
        return "Moments from\n\(month.month)"
    }
}
