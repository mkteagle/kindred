import SwiftUI

// MARK: - Notification Channel

enum NotificationChannel: String, CaseIterable {
    case push, inbox

    var label: String {
        switch self {
        case .push: return "PUSH"
        case .inbox: return "INBOX"
        }
    }

    var color: Color {
        switch self {
        case .push: return KindredTheme.ember
        case .inbox: return KindredTheme.forest
        }
    }
}

// MARK: - Notification Frequency

enum NotificationFrequency: String, CaseIterable, Identifiable {
    case realtime, daily, weekly

    var id: String { rawValue }

    var label: String {
        switch self {
        case .realtime: return "Real-time"
        case .daily: return "Daily"
        case .weekly: return "Weekly"
        }
    }

    var caption: String {
        switch self {
        case .realtime: return "As ready"
        case .daily: return "9am"
        case .weekly: return "Sat 9am"
        }
    }
}

// MARK: - Notification Type

struct NotificationType: Identifiable {
    let id: String
    let label: String
    let caption: String
    let group: NotificationGroup
    var pushEnabled: Bool
    var inAppEnabled: Bool
    var inAppLocked: Bool = true
    var frequency: NotificationFrequency = .realtime
    var isAdmin: Bool = false
}

enum NotificationGroup: String, CaseIterable {
    case photos = "Photos"
    case household = "Household"
    case admin = "Account \u{00b7} admin"
}

// MARK: - Notification State

@Observable
final class NotificationState {
    static let shared = NotificationState()

    var quietHoursEnabled: Bool = true
    var digestSchedule: String = "Saturdays 9am"

    var types: [NotificationType] = [
        // Photos
        NotificationType(id: "photos.backed_up", label: "New photos backed up", caption: "Daily digest", group: .photos, pushEnabled: false, inAppEnabled: true, frequency: .daily),
        NotificationType(id: "photos.memory_ready", label: "Memory ready", caption: "On this day, trips, spotlights", group: .photos, pushEnabled: true, inAppEnabled: true),
        NotificationType(id: "photos.together_found", label: "Together found", caption: "When 2+ people now share a photo", group: .photos, pushEnabled: true, inAppEnabled: true),
        NotificationType(id: "photos.sync_paused", label: "Sync paused", caption: "Out of Wi-Fi range", group: .photos, pushEnabled: true, inAppEnabled: true),
        // Household
        NotificationType(id: "household.member_joined", label: "Member joined or left", caption: "Always", group: .household, pushEnabled: true, inAppEnabled: true),
        NotificationType(id: "household.activity", label: "Photo activity", caption: "Comments and hearts", group: .household, pushEnabled: false, inAppEnabled: true),
        NotificationType(id: "household.cover_updated", label: "Cover updated", caption: "", group: .household, pushEnabled: false, inAppEnabled: true),
        // Admin
        NotificationType(id: "admin.signin_new_device", label: "Sign-in from new device", caption: "Always", group: .admin, pushEnabled: true, inAppEnabled: true, isAdmin: true),
    ]

    func typesFor(group: NotificationGroup) -> [NotificationType] {
        types.filter { $0.group == group }
    }

    func binding(for id: String) -> Binding<NotificationType> {
        Binding(
            get: { self.types.first(where: { $0.id == id }) ?? self.types[0] },
            set: { newValue in
                if let idx = self.types.firstIndex(where: { $0.id == id }) {
                    self.types[idx] = newValue
                }
            }
        )
    }

    private init() {}
}

// MARK: - Inbox Item

struct InboxItem: Identifiable {
    let id: String
    let kind: InboxItemKind
    let title: String
    let body: String
    let time: String
    var isNew: Bool = false
    var isAdmin: Bool = false
    var thumbnailURL: String? = nil
    var date: Date? = nil
}

enum InboxItemKind: String {
    case memory, together, sync, household, cover, admin, signin

    var icon: String {
        switch self {
        case .memory: return "sun.max.fill"
        case .together: return "person.2.fill"
        case .sync: return "arrow.triangle.2.circlepath"
        case .household: return "house.fill"
        case .cover: return "photo.fill"
        case .admin: return "exclamationmark.triangle.fill"
        case .signin: return "rectangle.portrait.and.arrow.right"
        }
    }

    var iconColor: Color {
        switch self {
        case .memory: return .white
        case .together: return KindredTheme.forest
        case .sync: return KindredTheme.pine
        case .household: return KindredTheme.ember
        case .cover: return KindredTheme.pine
        case .admin: return KindredTheme.rosehip
        case .signin: return KindredTheme.pine
        }
    }

    var backgroundColor: Color {
        switch self {
        case .memory: return .clear // gradient handled separately
        case .together: return KindredTheme.forest.opacity(0.16)
        case .sync: return Color(hex: 0x4A281A).opacity(0.08)
        case .household: return KindredTheme.ember.opacity(0.12)
        case .cover: return Color(hex: 0x4A281A).opacity(0.06)
        case .admin: return KindredTheme.rosehip.opacity(0.14)
        case .signin: return Color(hex: 0x4A281A).opacity(0.06)
        }
    }

    var usesGradient: Bool { self == .memory }
}

enum InboxFilter: String, CaseIterable {
    case all = "All"
    case photos = "Photos"
    case household = "Household"
    case admin = "Admin"
}

// MARK: - Notifications Settings View (Screen 05)

struct NotificationsSettingsView: View {
    @State private var notifState = NotificationState.shared

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                // Channel legend
                channelLegend
                    .padding(.horizontal, 16)
                    .padding(.top, 4)

                // Quiet hours
                sectionEyebrow("Quiet hours")
                quietHoursCard
                    .padding(.horizontal, 16)

                // Grouped sections
                ForEach(NotificationGroup.allCases, id: \.rawValue) { group in
                    let groupTypes = notifState.typesFor(group: group)
                    if !groupTypes.isEmpty {
                        sectionEyebrowWithAdmin(group)
                        groupCard(types: groupTypes)
                            .padding(.horizontal, 16)
                    }
                }

                Spacer().frame(height: 110)
            }
        }
        .kindredPaperBackground()
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Channel Legend

    private var channelLegend: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("How we tell you")
                    .font(.display(13, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                Text("Tap a row to fine-tune")
                    .font(.body(11))
                    .foregroundStyle(KindredTheme.mist)
            }
            Spacer()
            HStack(spacing: 14) {
                ForEach(NotificationChannel.allCases, id: \.rawValue) { channel in
                    VStack(spacing: 3) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(channel.color)
                            .frame(width: 14, height: 14)
                        Text(channel.label)
                            .font(.mono(8, weight: .semibold))
                            .tracking(1.2)
                            .foregroundStyle(KindredTheme.mist)
                    }
                }
            }
        }
        .padding(14)
        .background(KindredTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(KindredTheme.line, lineWidth: 1)
        )
    }

    // MARK: - Quiet Hours

    private var quietHoursCard: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pause overnight")
                        .font(.display(13.5, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                    Text("10pm \u{2014} 7am, every day")
                        .font(.body(11))
                        .foregroundStyle(KindredTheme.mist)
                }
                Spacer()
                KindredToggle(isOn: $notifState.quietHoursEnabled)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)

            Divider().overlay(KindredTheme.line).padding(.leading, 14)

            HStack {
                Text("Memory digest")
                    .font(.body(13.5))
                    .foregroundStyle(KindredTheme.ash)
                Spacer()
                Text(notifState.digestSchedule)
                    .font(.mono(11))
                    .foregroundStyle(KindredTheme.mist)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .kindredGroupedCard()
    }

    // MARK: - Section Eyebrow

    private func sectionEyebrow(_ text: String) -> some View {
        KindredEyebrow(text: text, color: KindredTheme.pine)
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 6)
    }

    private func sectionEyebrowWithAdmin(_ group: NotificationGroup) -> some View {
        HStack(spacing: 8) {
            KindredEyebrow(text: group == .admin ? "Account \u{00b7} admin" : group.rawValue, color: KindredTheme.pine)
            if group == .admin {
                Text("ADMIN")
                    .font(.mono(8, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(KindredTheme.ember)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(KindredTheme.ember.opacity(0.16))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 6)
    }

    // MARK: - Group Card

    private func groupCard(types: [NotificationType]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(types.enumerated()), id: \.element.id) { index, notifType in
                NavigationLink {
                    NotificationTypeDetailView(typeId: notifType.id)
                } label: {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(notifType.label)
                                .font(.display(13.5, weight: .bold))
                                .foregroundStyle(KindredTheme.ash)
                            if !notifType.caption.isEmpty {
                                Text(notifType.caption)
                                    .font(.body(11))
                                    .foregroundStyle(KindredTheme.mist)
                            }
                        }
                        Spacer()
                        // Channel pips
                        HStack(spacing: 6) {
                            channelPip(on: notifType.pushEnabled, color: NotificationChannel.push.color)
                            channelPip(on: notifType.inAppEnabled, color: NotificationChannel.inbox.color)
                        }
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(KindredTheme.mist)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
                .buttonStyle(.plain)

                if index < types.count - 1 {
                    Divider().overlay(KindredTheme.line).padding(.leading, 14)
                }
            }
        }
        .kindredGroupedCard()
    }

    // MARK: - Channel Pip

    private func channelPip(on: Bool, color: Color) -> some View {
        RoundedRectangle(cornerRadius: 5)
            .fill(on ? color : Color(hex: 0x4A281A).opacity(0.08))
            .frame(width: 18, height: 18)
            .overlay {
                if on {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
    }
}

// MARK: - Per-type Detail View (Screen 08)

struct NotificationTypeDetailView: View {
    let typeId: String
    @State private var notifState = NotificationState.shared

    private var notifType: NotificationType {
        notifState.types.first(where: { $0.id == typeId }) ?? notifState.types[0]
    }

    private var typeIndex: Int? {
        notifState.types.firstIndex(where: { $0.id == typeId })
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                // Preview card
                previewCard
                    .padding(.horizontal, 16)
                    .padding(.top, 4)

                // Send via
                sectionEyebrow("Send via")
                sendViaCard
                    .padding(.horizontal, 16)

                // How often
                sectionEyebrow("How often")
                frequencyGrid
                    .padding(.horizontal, 16)

                // Mute
                muteCard
                    .padding(.horizontal, 16)
                    .padding(.top, 18)

                Spacer().frame(height: 110)
            }
        }
        .kindredPaperBackground()
        .navigationTitle(notifType.label)
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Preview Card

    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("WHAT YOU\u{2019}LL SEE")
                .font(.kindredEyebrow)
                .tracking(1.8)
                .foregroundStyle(KindredTheme.ember)

            // Mini push notification
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 7)
                    .fill(
                        LinearGradient(
                            colors: [KindredTheme.gold, KindredTheme.ember],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 28, height: 28)
                    .overlay {
                        Image(systemName: "sun.max")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.white)
                    }

                VStack(alignment: .leading, spacing: 2) {
                    Text("KINDRED \u{00b7} now")
                        .font(.body(11, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                    Text("A new memory is ready.")
                        .font(.display(12.5, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                    Text("\u{201c}Cabin weekend, Lake Galena\u{201d} \u{2014} 14 photos.")
                        .font(.body(11))
                        .foregroundStyle(KindredTheme.pine)
                }
                Spacer()
            }
            .padding(12)
            .background(KindredTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(KindredTheme.line, lineWidth: 1)
            )
            .padding(.top, 10)
        }
        .padding(14)
        .background(
            LinearGradient(
                colors: [KindredTheme.canvas, KindredTheme.card],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(KindredTheme.line, lineWidth: 1)
        )
    }

    // MARK: - Send Via Card

    private var sendViaCard: some View {
        VStack(spacing: 0) {
            // Push
            channelRow(
                pipColor: NotificationChannel.push.color,
                label: "Push notification",
                caption: "Sound + lock screen",
                toggleColor: KindredTheme.ember,
                isOn: Binding(
                    get: { notifType.pushEnabled },
                    set: { newValue in
                        if let idx = typeIndex {
                            notifState.types[idx].pushEnabled = newValue
                        }
                    }
                ),
                locked: false
            )

            Divider().overlay(KindredTheme.line).padding(.leading, 14)

            // In-app inbox
            channelRow(
                pipColor: NotificationChannel.inbox.color,
                label: "In-app inbox",
                caption: "Always kept here",
                toggleColor: KindredTheme.forest,
                isOn: .constant(true),
                locked: notifType.inAppLocked
            )
        }
        .kindredGroupedCard()
    }

    private func channelRow(pipColor: Color, label: String, caption: String, toggleColor: Color, isOn: Binding<Bool>, locked: Bool) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 4)
                .fill(pipColor)
                .frame(width: 14, height: 14)

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.display(13.5, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                Text(caption)
                    .font(.body(11))
                    .foregroundStyle(KindredTheme.mist)
            }
            Spacer()

            if locked {
                Text("ALWAYS")
                    .font(.mono(9, weight: .semibold))
                    .tracking(1)
                    .foregroundStyle(KindredTheme.mist)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Color(hex: 0x4A281A).opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            } else {
                Toggle("", isOn: isOn)
                    .tint(toggleColor)
                    .labelsHidden()
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Frequency Grid

    private var frequencyGrid: some View {
        HStack(spacing: 6) {
            ForEach(NotificationFrequency.allCases) { freq in
                let isSelected = notifType.frequency == freq
                Button {
                    if let idx = typeIndex {
                        notifState.types[idx].frequency = freq
                    }
                } label: {
                    VStack(spacing: 3) {
                        Text(freq.label)
                            .font(.display(13, weight: .bold))
                            .foregroundStyle(isSelected ? KindredTheme.ember : KindredTheme.ash)
                        Text(freq.caption)
                            .font(.mono(9))
                            .tracking(0.6)
                            .foregroundStyle(KindredTheme.mist)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 8)
                    .background(isSelected ? KindredTheme.ember.opacity(0.08) : KindredTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(
                                isSelected ? KindredTheme.ember : KindredTheme.line,
                                lineWidth: isSelected ? 1.5 : 1
                            )
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Mute Card

    private var muteCard: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Mute this type for\u{2026}")
                    .font(.display(13, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                Text("Pauses push only")
                    .font(.body(11))
                    .foregroundStyle(KindredTheme.mist)
            }
            Spacer()
            Text("Choose")
                .font(.body(13, weight: .semibold))
                .foregroundStyle(KindredTheme.ember)
        }
        .padding(14)
        .background(Color(hex: 0x4A281A).opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(KindredTheme.line, lineWidth: 1)
        )
    }

    // MARK: - Section Eyebrow

    private func sectionEyebrow(_ text: String) -> some View {
        KindredEyebrow(text: text, color: KindredTheme.pine)
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 6)
    }
}

// MARK: - Read State Manager

/// Tracks which notification IDs have been read, persisted in UserDefaults.
final class NotificationReadState: ObservableObject {
    static let shared = NotificationReadState()

    private let key = "kindred_read_notification_ids"

    @Published private(set) var readIDs: Set<String> = []

    private init() {
        if let saved = UserDefaults.standard.array(forKey: key) as? [String] {
            readIDs = Set(saved)
        }
    }

    func isRead(_ id: String) -> Bool {
        readIDs.contains(id)
    }

    func markRead(_ id: String) {
        readIDs.insert(id)
        persist()
    }

    func markAllRead(_ ids: [String]) {
        readIDs.formUnion(ids)
        persist()
    }

    private func persist() {
        UserDefaults.standard.set(Array(readIDs), forKey: key)
    }
}

// MARK: - Notification Route

/// Describes where a notification should navigate to when tapped.
enum NotificationRoute {
    case libraryPeople    // Scan completed, new people
    case adminScan        // Scan failed
    case settings         // Storage/admin
}

func routeForNotification(_ item: InboxItem) -> NotificationRoute {
    switch item.kind {
    case .sync, .together:
        return .libraryPeople
    case .admin:
        if item.title.lowercased().contains("scan failed") {
            return .adminScan
        }
        return .settings
    case .memory, .cover:
        return .libraryPeople
    case .household:
        return .settings
    case .signin:
        return .settings
    }
}

// MARK: - Inbox View Model

@Observable
final class InboxViewModel {
    var syncLogs: [SyncLog] = []
    var isLoading = false
    var hasLoaded = false

    func loadSyncHistory() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false; hasLoaded = true }

        do {
            syncLogs = try await APIClient.shared.getSyncs()
        } catch {
            syncLogs = []
        }
    }

    /// Build all inbox items from sync logs (unread state applied via ReadState)
    func allItems(readState: NotificationReadState) -> [InboxItem] {
        var items: [InboxItem] = []
        for (index, log) in syncLogs.enumerated() {
            let date = parseDate(log.finished_at ?? log.started_at)
            let timeString = formatTime(date)

            if log.status == "completed" || log.status == "done" {
                let photosText = (log.total_photos ?? 0).formatted()
                let facesText = log.new_faces ?? 0
                let petsText = log.new_pets ?? 0
                let vehiclesText = log.new_vehicles ?? 0

                var details: [String] = []
                if facesText > 0 { details.append("\(facesText) new people") }
                if petsText > 0 { details.append("\(petsText) pet\(petsText == 1 ? "" : "s")") }
                if vehiclesText > 0 { details.append("\(vehiclesText) vehicle\(vehiclesText == 1 ? "" : "s")") }

                let body: String
                if details.isEmpty {
                    body = "All photos up to date."
                } else {
                    body = "\(photosText) photos indexed. Found \(details.joined(separator: ", "))."
                }

                let syncId = "sync_\(log.id)_\(index)"
                items.append(InboxItem(
                    id: syncId,
                    kind: .sync,
                    title: "Scan completed",
                    body: body,
                    time: timeString,
                    isNew: !readState.isRead(syncId),
                    date: date
                ))

                // Generate cluster notification if new faces found
                if facesText > 0 {
                    let clusterId = "cluster_\(log.id)_\(index)"
                    items.append(InboxItem(
                        id: clusterId,
                        kind: .together,
                        title: "\(facesText) new people cluster\(facesText == 1 ? "" : "s") discovered",
                        body: "Review and label in People.",
                        time: timeString,
                        isNew: !readState.isRead(clusterId),
                        date: date
                    ))
                }
            } else if log.status == "failed" || log.status == "error" {
                let errorId = "error_\(log.id)_\(index)"
                items.append(InboxItem(
                    id: errorId,
                    kind: .admin,
                    title: "Scan failed",
                    body: log.error ?? "An error occurred during scanning.",
                    time: timeString,
                    isNew: !readState.isRead(errorId),
                    isAdmin: true,
                    date: date
                ))
            }
        }
        return items
    }

    /// Convert sync logs into inbox items grouped by date
    func groups(readState: NotificationReadState) -> [(eyebrow: String, items: [InboxItem])] {
        let calendar = Calendar.current
        let items = allItems(readState: readState)

        // Group by date
        var todayItems: [InboxItem] = []
        var yesterdayItems: [InboxItem] = []
        var earlierItems: [InboxItem] = []

        for item in items {
            if let date = item.date {
                if calendar.isDateInToday(date) {
                    todayItems.append(item)
                } else if calendar.isDateInYesterday(date) {
                    yesterdayItems.append(item)
                } else {
                    earlierItems.append(item)
                }
            } else {
                earlierItems.append(item)
            }
        }

        var result: [(eyebrow: String, items: [InboxItem])] = []
        if !todayItems.isEmpty { result.append(("Today", todayItems)) }
        if !yesterdayItems.isEmpty { result.append(("Yesterday", yesterdayItems)) }
        if !earlierItems.isEmpty { result.append(("Earlier", earlierItems)) }

        return result
    }

    func unreadCount(readState: NotificationReadState) -> Int {
        allItems(readState: readState).filter(\.isNew).count
    }

    private func parseDate(_ dateString: String?) -> Date? {
        guard let dateString = dateString else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = formatter.date(from: dateString) { return d }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: dateString)
    }

    private func formatTime(_ date: Date?) -> String {
        guard let date = date else { return "" }
        let calendar = Calendar.current
        if calendar.isDateInToday(date) || calendar.isDateInYesterday(date) {
            let formatter = DateFormatter()
            formatter.dateFormat = "h:mma"
            formatter.amSymbol = "am"
            formatter.pmSymbol = "pm"
            return formatter.string(from: date)
        } else {
            let formatter = DateFormatter()
            formatter.dateFormat = "MMM d"
            return formatter.string(from: date)
        }
    }
}

// MARK: - Inbox View (Screen 07)

struct NotificationInboxView: View {
    @State private var filter: InboxFilter = .all
    @State private var viewModel = InboxViewModel()
    @ObservedObject private var readState = NotificationReadState.shared
    @Environment(\.dismiss) private var dismiss

    /// Callback to navigate: 1 = Library tab, 3 = Settings tab
    var onNavigateToTab: ((Int) -> Void)? = nil
    /// Callback to push AdminScanView in settings
    var onNavigateToAdminScan: (() -> Void)? = nil

    private var groups: [(eyebrow: String, items: [InboxItem])] {
        viewModel.groups(readState: readState)
    }

    private var filteredGroups: [(eyebrow: String, items: [InboxItem])] {
        switch filter {
        case .all:
            return groups
        case .photos:
            return groups.compactMap { group in
                let filtered = group.items.filter { [.memory, .together, .sync].contains($0.kind) }
                return filtered.isEmpty ? nil : (group.eyebrow, filtered)
            }
        case .household:
            return groups.compactMap { group in
                let filtered = group.items.filter { [.household, .cover].contains($0.kind) }
                return filtered.isEmpty ? nil : (group.eyebrow, filtered)
            }
        case .admin:
            return groups.compactMap { group in
                let filtered = group.items.filter { $0.isAdmin }
                return filtered.isEmpty ? nil : (group.eyebrow, filtered)
            }
        }
    }

    private var unreadCount: Int { groups.flatMap(\.items).filter(\.isNew).count }

    private func countFor(_ filterType: InboxFilter) -> Int {
        switch filterType {
        case .all: return groups.flatMap(\.items).count
        case .photos: return groups.flatMap(\.items).filter { [.memory, .together, .sync].contains($0.kind) }.count
        case .household: return groups.flatMap(\.items).filter { [.household, .cover].contains($0.kind) }.count
        case .admin: return groups.flatMap(\.items).filter(\.isAdmin).count
        }
    }

    private func handleTap(_ item: InboxItem) {
        // Mark as read
        readState.markRead(item.id)

        // Dismiss inbox and route
        let route = routeForNotification(item)
        dismiss()

        // Small delay to let sheet dismiss before navigating
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            switch route {
            case .libraryPeople:
                onNavigateToTab?(1) // Library tab
            case .adminScan:
                onNavigateToTab?(3) // Settings tab
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                    onNavigateToAdminScan?()
                }
            case .settings:
                onNavigateToTab?(3) // Settings tab
            }
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Header
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("INBOX \u{00b7} \(unreadCount) NEW")
                            .font(.kindredEyebrow)
                            .tracking(1.8)
                            .foregroundStyle(KindredTheme.ember)
                        Text("Notifications")
                            .font(.display(24, weight: .bold))
                            .foregroundStyle(KindredTheme.ash)
                    }
                    Spacer()

                    if unreadCount > 0 {
                        Button {
                            let allIds = groups.flatMap(\.items).map(\.id)
                            readState.markAllRead(allIds)
                        } label: {
                            Text("Mark all read")
                                .font(.body(12, weight: .semibold))
                                .foregroundStyle(KindredTheme.ember)
                        }
                        .padding(.trailing, 8)
                    }

                    NavigationLink {
                        NotificationsSettingsView()
                    } label: {
                        Circle()
                            .fill(KindredTheme.card)
                            .frame(width: 36, height: 36)
                            .overlay(Circle().stroke(KindredTheme.line, lineWidth: 1))
                            .overlay {
                                Image(systemName: "gearshape")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(KindredTheme.pine)
                            }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 8)

                // Filter pills
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(InboxFilter.allCases, id: \.rawValue) { filterType in
                            let isActive = filter == filterType
                            Button {
                                withAnimation(.easeOut(duration: 0.16)) {
                                    filter = filterType
                                }
                            } label: {
                                HStack(spacing: 6) {
                                    Text(filterType.rawValue)
                                        .font(.display(12, weight: .bold))
                                    Text("\(countFor(filterType))")
                                        .font(.mono(10))
                                        .opacity(0.7)
                                }
                                .padding(.horizontal, 11)
                                .padding(.vertical, 6)
                                .foregroundStyle(isActive ? KindredTheme.paper : KindredTheme.pine)
                                .background(isActive ? KindredTheme.ash : .clear)
                                .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusPill))
                                .overlay(
                                    RoundedRectangle(cornerRadius: KindredTheme.radiusPill)
                                        .stroke(isActive ? KindredTheme.ash : KindredTheme.lineDark, lineWidth: isActive ? 0 : 1)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.bottom, 4)

                // Inbox content
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        if viewModel.isLoading {
                            ProgressView()
                                .tint(KindredTheme.ember)
                                .padding(.top, 40)
                        } else if filteredGroups.isEmpty {
                            VStack(spacing: 12) {
                                Image(systemName: "bell.slash")
                                    .font(.system(size: 36, weight: .light))
                                    .foregroundStyle(KindredTheme.pine.opacity(0.4))
                                Text("No notifications yet")
                                    .font(.kindredH3)
                                    .foregroundStyle(KindredTheme.ash)
                                Text("Scan history will appear here.")
                                    .font(.kindredBody)
                                    .foregroundStyle(KindredTheme.mist)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 60)
                        } else {
                            ForEach(Array(filteredGroups.enumerated()), id: \.element.eyebrow) { _, group in
                                KindredEyebrow(text: group.eyebrow, color: KindredTheme.pine)
                                    .padding(.horizontal, 20)
                                    .padding(.top, 10)
                                    .padding(.bottom, 6)

                                VStack(spacing: 0) {
                                    ForEach(Array(group.items.enumerated()), id: \.element.id) { index, item in
                                        Button {
                                            handleTap(item)
                                        } label: {
                                            inboxRow(item: item)
                                        }
                                        .buttonStyle(.plain)

                                        if index < group.items.count - 1 {
                                            Divider().overlay(KindredTheme.line).padding(.leading, 14)
                                        }
                                    }
                                }
                                .kindredGroupedCard()
                                .padding(.horizontal, 16)
                            }
                        }
                        Spacer().frame(height: 110)
                    }
                }
            }
            .kindredPaperBackground()
            .navigationBarHidden(true)
            .task {
                await viewModel.loadSyncHistory()
            }
        }
    }

    // MARK: - Inbox Row

    private func inboxRow(item: InboxItem) -> some View {
        HStack(alignment: .top, spacing: 11) {
            // Unread indicator dot
            ZStack {
                if item.isNew {
                    Circle()
                        .fill(KindredTheme.ember)
                        .frame(width: 6, height: 6)
                }
            }
            .frame(width: 6)
            .padding(.top, 15)

            // Icon glyph
            if item.kind.usesGradient {
                RoundedRectangle(cornerRadius: 9)
                    .fill(
                        LinearGradient(
                            colors: [KindredTheme.gold, KindredTheme.ember],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 36, height: 36)
                    .overlay {
                        Image(systemName: item.kind.icon)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(item.kind.iconColor)
                    }
            } else {
                RoundedRectangle(cornerRadius: 9)
                    .fill(item.kind.backgroundColor)
                    .frame(width: 36, height: 36)
                    .overlay {
                        Image(systemName: item.kind.icon)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(item.kind.iconColor)
                    }
            }

            // Content
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.title)
                        .font(.display(13, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                        .lineLimit(1)
                    Spacer()
                    Text(item.time)
                        .font(.mono(9))
                        .tracking(0.4)
                        .foregroundStyle(KindredTheme.mist)
                }
                Text(item.body)
                    .font(.body(12))
                    .foregroundStyle(KindredTheme.pine)
                    .lineSpacing(2)
                    .multilineTextAlignment(.leading)

                if item.isAdmin {
                    Text("ADMIN")
                        .font(.mono(8, weight: .semibold))
                        .tracking(1.2)
                        .foregroundStyle(KindredTheme.ember)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(KindredTheme.ember.opacity(0.16))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .padding(.top, 4)
                }
            }

            // Optional thumbnail
            if let thumb = item.thumbnailURL, let url = URL(string: thumb) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        KindredTheme.canvas
                    }
                }
                .frame(width: 42, height: 42)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
}
