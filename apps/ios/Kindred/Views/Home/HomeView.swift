import SwiftUI

/// Screen 01 — Home. The inverse lockup and a bell, a time-of-day eyebrow over
/// the standing title, the brand's memory wall, two stat cards, and the latest
/// day as a mosaic.
struct HomeView: View {
    var onNavigateToTab: ((Int) -> Void)? = nil

    @State private var recent: [LibraryPhoto] = []
    @State private var latestDay: PhotoDay?
    @State private var newThisWeek: Int?
    @State private var newThisWeekIsFloor = false
    @State private var peopleToName: Int?
    @State private var inboxVM = InboxViewModel()
    @ObservedObject private var readState = NotificationReadState.shared
    @State private var showInbox = false
    @State private var viewing: LibraryPhoto?
    @State private var hasAppeared = false
    @State private var lastLoadedAt: Date?
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isIPad: Bool { horizontalSizeClass == .regular }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    KindredAppBar(
                        unreadCount: inboxVM.unreadCount(readState: readState),
                        onBellTap: { showInbox = true }
                    )

                    greeting
                        .kindredEntry(hasAppeared)

                    MemoryWall(photos: Array(recent.prefix(4)))
                        .frame(height: isIPad ? 250 : 196)
                        .padding(.horizontal, 14)
                        .padding(.top, 22)
                        .padding(.bottom, 6)
                        .kindredEntry(hasAppeared, delay: 0.06)

                    thisWeek
                        .kindredEntry(hasAppeared, delay: 0.12)

                    latestDaySection
                        .kindredEntry(hasAppeared, delay: 0.18)

                    Color.clear.frame(height: 32)
                }
                .frame(maxWidth: isIPad ? 900 : .infinity, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("home.scrollView")
            .background(KindredTheme.bg.ignoresSafeArea())
            .navigationBarHidden(true)
            .fullScreenCover(item: $viewing) { photo in
                PhotoViewerView(photos: latestDay?.photos ?? recent, initial: photo)
            }
            .sheet(isPresented: $showInbox) {
                NotificationInboxView(onNavigateToTab: onNavigateToTab)
            }
            .task {
                await load()
                withAnimation { hasAppeared = true }
            }
            .refreshable { await load() }
            .onReceive(
                NotificationCenter.default.publisher(
                    for: UIApplication.willEnterForegroundNotification
                )
            ) { _ in
                guard let loaded = lastLoadedAt, Date().timeIntervalSince(loaded) > 300 else { return }
                Task { await load() }
            }
        }
    }

    // MARK: - Greeting

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 8) {
            KindredEyebrow(text: timeOfDay, color: KindredTheme.amber)
            Text("A quieter view\nof your week.")
                .font(.display(33, weight: .bold, relativeTo: .largeTitle))
                .tracking(-0.33)
                .lineSpacing(-4)
                .foregroundStyle(KindredTheme.ink)
                .accessibilityAddTraits(.isHeader)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, KindredTheme.gutter)
        .padding(.top, 14)
    }

    private var timeOfDay: String {
        let now = Date()
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("EEEE")
        let day = formatter.string(from: now)
        switch Calendar.current.component(.hour, from: now) {
        case 5..<12: return "\(day) morning"
        case 12..<17: return "\(day) afternoon"
        case 17..<21: return "\(day) evening"
        default: return "\(day) night"
        }
    }

    // MARK: - This week

    private var thisWeek: some View {
        VStack(alignment: .leading, spacing: 10) {
            KindredEyebrow(text: "This week")
            HStack(spacing: 10) {
                KindredStatCard(value: newThisWeekLabel, label: "new moments")
                Button {
                    onNavigateToTab?(1)
                } label: {
                    KindredStatCard(
                        value: peopleToName.map { "\($0)" } ?? "—", label: "people to name"
                    )
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens People")
            }
        }
        .padding(.horizontal, KindredTheme.gutter)
        .padding(.top, 16)
    }

    /// The catalog has no "count matching these facets" endpoint, so this is
    /// the size of one page of the last seven days. When the page is full there
    /// are more, and the number is shown as a floor rather than a guess.
    /// TODO: a `/library/count` taking the same facets as /library/photos
    /// would make this exact.
    private var newThisWeekLabel: String {
        guard let newThisWeek else { return "—" }
        return newThisWeekIsFloor ? "\(newThisWeek)+" : "\(newThisWeek)"
    }

    // MARK: - Latest day

    @ViewBuilder
    private var latestDaySection: some View {
        if let day = latestDay {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(day.longTitle)
                        .font(.display(17, weight: .semibold, relativeTo: .headline))
                        .foregroundStyle(KindredTheme.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(day.countLabel)
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.inkMeta)
                    Spacer()
                }
                .padding(.horizontal, KindredTheme.gutter)

                MosaicGrid(
                    photos: Array(day.photos.prefix(9)),
                    rowHeight: isIPad ? 120 : 84,
                    spacing: 2,
                    onTap: { viewing = $0 }
                )
                .padding(.horizontal, KindredTheme.gutter)
            }
            .padding(.top, 20)
        }
    }

    // MARK: - Data

    private func load() async {
        if DemoDataProvider.shared.isActive {
            recent = DemoDataProvider.shared.libraryPage().photos
            latestDay = PhotoDay.group(recent).first
            newThisWeek = recent.count
            newThisWeekIsFloor = false
            peopleToName = DemoDataProvider.shared
                .getClusterSummary(category: "people").clusters
                .filter { $0.label == nil }.count
            lastLoadedAt = Date()
            return
        }

        async let page = try? await APIClient.shared.libraryPhotos(limit: 60)
        async let weekPage = try? await APIClient.shared.libraryPhotos(
            dateFrom: HomeView.sevenDaysAgo, limit: 100
        )
        async let people = try? await APIClient.shared.getClusterSummary(category: "people")
        async let inbox: () = inboxVM.loadSyncHistory()

        let library = await page
        recent = library?.photos ?? []
        latestDay = PhotoDay.group(recent).first

        if let week = await weekPage {
            newThisWeek = week.photos.count
            newThisWeekIsFloor = week.next_cursor != nil
        }

        if let people = await people {
            peopleToName = people.clusters.filter { $0.label == nil }.count
        }
        await inbox
        lastLoadedAt = Date()
    }

    private static var sevenDaysAgo: String {
        let date = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

// MARK: - Memory wall

/// The brand's memory wall: four photos in 5pt near-white borders at fixed
/// rotations, layered. Deliberately hand-placed rather than a grid — the
/// scatter is the identity.
struct MemoryWall: View {
    let photos: [LibraryPhoto]

    private struct Placement {
        let x: CGFloat      // fraction of width, centre of the card
        let y: CGFloat      // points from the top, centre of the card
        let width: CGFloat  // fraction of width
        let rotation: Double
        let z: Double
    }

    private static let placements: [Placement] = [
        .init(x: 0.23, y: 76, width: 0.38, rotation: -8, z: 1),
        .init(x: 0.75, y: 62, width: 0.40, rotation: 6, z: 2),
        .init(x: 0.43, y: 138, width: 0.46, rotation: -1, z: 5),
        .init(x: 0.74, y: 150, width: 0.36, rotation: 4, z: 3),
    ]

    var body: some View {
        GeometryReader { geo in
            ZStack {
                ForEach(Array(Self.placements.enumerated()), id: \.offset) { position, placement in
                    card(at: position, placement: placement, width: geo.size.width)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Recent photos")
    }

    @ViewBuilder
    private func card(at position: Int, placement: Placement, width: CGFloat) -> some View {
        let cardWidth = width * placement.width
        Group {
            if photos.indices.contains(position) {
                KindredThumbnail(photo: photos[position])
            } else {
                KindredTheme.tile
            }
        }
        .frame(width: cardWidth, height: cardWidth * 1.25)
        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusXS))
        .padding(5)
        .background(Color(hex: 0xF1F1EC, alpha: 0.92))
        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusXS))
        .rotationEffect(.degrees(placement.rotation))
        .shadow(color: .black.opacity(0.45), radius: 14, x: 0, y: 14)
        .position(x: width * placement.x, y: placement.y)
        .zIndex(placement.z)
    }
}
