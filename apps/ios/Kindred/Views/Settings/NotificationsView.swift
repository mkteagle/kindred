import SwiftUI

// MARK: - Notification Channel

enum NotificationChannel: String, CaseIterable {
    case push, email, inbox

    var label: String {
        switch self {
        case .push: return "PUSH"
        case .email: return "EMAIL"
        case .inbox: return "INBOX"
        }
    }

    var color: Color {
        switch self {
        case .push: return KindredTheme.ember
        case .email: return KindredTheme.pine
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
    var emailEnabled: Bool
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
        NotificationType(id: "photos.backed_up", label: "New photos backed up", caption: "Daily digest", group: .photos, pushEnabled: false, emailEnabled: true, inAppEnabled: true, frequency: .daily),
        NotificationType(id: "photos.memory_ready", label: "Memory ready", caption: "On this day, trips, spotlights", group: .photos, pushEnabled: true, emailEnabled: false, inAppEnabled: true),
        NotificationType(id: "photos.together_found", label: "Together found", caption: "When 2+ people now share a photo", group: .photos, pushEnabled: true, emailEnabled: false, inAppEnabled: true),
        NotificationType(id: "photos.sync_paused", label: "Sync paused", caption: "Out of Wi-Fi or storage", group: .photos, pushEnabled: true, emailEnabled: false, inAppEnabled: true),
        // Household
        NotificationType(id: "household.member_joined", label: "Member joined or left", caption: "Always", group: .household, pushEnabled: true, emailEnabled: true, inAppEnabled: true),
        NotificationType(id: "household.activity", label: "Photo activity", caption: "Comments and hearts", group: .household, pushEnabled: false, emailEnabled: false, inAppEnabled: true),
        NotificationType(id: "household.cover_updated", label: "Cover updated", caption: "", group: .household, pushEnabled: false, emailEnabled: false, inAppEnabled: true),
        // Admin
        NotificationType(id: "admin.storage_warning", label: "Storage warning", caption: "< 10% free", group: .admin, pushEnabled: true, emailEnabled: true, inAppEnabled: true, isAdmin: true),
        NotificationType(id: "admin.signin_new_device", label: "Sign-in from new device", caption: "Always", group: .admin, pushEnabled: true, emailEnabled: true, inAppEnabled: true, isAdmin: true),
        NotificationType(id: "admin.billing", label: "Billing", caption: "Renewals + receipts", group: .admin, pushEnabled: false, emailEnabled: true, inAppEnabled: false, inAppLocked: false, isAdmin: true),
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

                Spacer().frame(height: 40)
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
                            channelPip(on: notifType.emailEnabled, color: NotificationChannel.email.color)
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

                Spacer().frame(height: 40)
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

            Divider().overlay(KindredTheme.line).padding(.leading, 14)

            // Email
            channelRow(
                pipColor: NotificationChannel.email.color,
                label: "Email digest",
                caption: "Weekly summary",
                toggleColor: KindredTheme.pine,
                isOn: Binding(
                    get: { notifType.emailEnabled },
                    set: { newValue in
                        if let idx = typeIndex {
                            notifState.types[idx].emailEnabled = newValue
                        }
                    }
                ),
                locked: false
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

// MARK: - Inbox View (Screen 07)

struct NotificationInboxView: View {
    @State private var filter: InboxFilter = .all
    @Environment(\.dismiss) private var dismiss

    private let groups: [(eyebrow: String, items: [InboxItem])] = [
        ("Today", [
            InboxItem(id: "1", kind: .memory, title: "A new memory is ready.", body: "\u{201c}Cabin weekend, Lake Galena\u{201d} \u{2014} 14 photos.", time: "9:24am", isNew: true, thumbnailURL: "https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?auto=format&fit=crop&w=120&q=80"),
            InboxItem(id: "2", kind: .together, title: "Maya & Theo together \u{2014} 23 new shots.", body: "From the past 4 weeks.", time: "9:24am", isNew: true),
            InboxItem(id: "3", kind: .sync, title: "1,242 photos backed up overnight.", body: "Sync finished at 4:18am.", time: "8:00am"),
        ]),
        ("Yesterday", [
            InboxItem(id: "4", kind: .household, title: "Sarah joined Wright household.", body: "Invited by Mom.", time: "5:42pm"),
            InboxItem(id: "5", kind: .cover, title: "Cover photo updated for Maya.", body: "By Mom.", time: "10:11am"),
        ]),
        ("Earlier", [
            InboxItem(id: "6", kind: .admin, title: "Storage at 92%.", body: "Review largest months.", time: "Aug 14", isAdmin: true),
            InboxItem(id: "7", kind: .signin, title: "Sign-in from new iPad.", body: "Was this you?", time: "Aug 12", isAdmin: true),
        ]),
    ]

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
                        ForEach(Array(filteredGroups.enumerated()), id: \.element.eyebrow) { _, group in
                            KindredEyebrow(text: group.eyebrow, color: KindredTheme.pine)
                                .padding(.horizontal, 20)
                                .padding(.top, 10)
                                .padding(.bottom, 6)

                            VStack(spacing: 0) {
                                ForEach(Array(group.items.enumerated()), id: \.element.id) { index, item in
                                    inboxRow(item: item)

                                    if index < group.items.count - 1 {
                                        Divider().overlay(KindredTheme.line).padding(.leading, 14)
                                    }
                                }
                            }
                            .kindredGroupedCard()
                            .padding(.horizontal, 16)
                        }
                        Spacer().frame(height: 110)
                    }
                }
            }
            .kindredPaperBackground()
            .navigationBarHidden(true)
        }
    }

    // MARK: - Inbox Row

    private func inboxRow(item: InboxItem) -> some View {
        HStack(alignment: .top, spacing: 11) {
            // New indicator
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
