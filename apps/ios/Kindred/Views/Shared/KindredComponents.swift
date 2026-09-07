import SwiftUI

// MARK: - Eyebrow

/// Mono uppercase eyebrow — 10pt/600, .18em tracking, terracotta.
/// The handoff makes this *required* above every section title.
struct KindredEyebrow: View {
    let text: String
    var color: Color = KindredTheme.accent
    var isPill: Bool = false

    var body: some View {
        Text(text.uppercased())
            .font(.kindredEyebrow)
            .tracking(1.8) // .18em at 10pt
            .foregroundStyle(color)
            .if(isPill) { view in
                view
                    .padding(.horizontal, 11)
                    .padding(.vertical, 6)
                    .background(KindredTheme.accent.opacity(0.16))
                    .clipShape(Capsule())
            }
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Buttons

enum KindredButtonStyle {
    /// Terracotta fill, on-accent ink. The single primary.
    case primary
    /// Solid ink-on-fill. Used where a second solid is unavoidable.
    case dark
    /// Transparent with a hairline border.
    case ghost
    /// Destructive: danger fill + border + text.
    case danger
    case forest
}

struct KindredButton: View {
    let title: String
    var icon: String? = nil
    var style: KindredButtonStyle = .primary
    var isSmall: Bool = false
    var isFullWidth: Bool = false
    var isLoading: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView()
                        .tint(foregroundColor)
                        .scaleEffect(0.8)
                }
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: isSmall ? 12 : 14, weight: .semibold))
                }
                Text(title)
                    .font(isSmall ? .kindredButtonSM : .kindredButton)
            }
            .foregroundStyle(foregroundColor)
            .frame(maxWidth: isFullWidth ? .infinity : nil)
            .frame(minHeight: isSmall ? 34 : 46)
            .padding(.horizontal, isSmall ? 13 : 18)
            .background(backgroundColor)
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
            .overlay(
                RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                    .stroke(borderColor, lineWidth: needsBorder ? 1 : 0)
            )
        }
        .disabled(isLoading)
        .accessibilityLabel(title)
    }

    private var backgroundColor: Color {
        switch style {
        case .primary: return KindredTheme.accent
        case .dark: return KindredTheme.fillStrongest
        case .ghost: return .clear
        case .danger: return KindredTheme.dangerFill
        case .forest: return KindredTheme.forestGreen
        }
    }

    private var foregroundColor: Color {
        switch style {
        // Brand rule: ink on terracotta is #14150f, never white.
        case .primary: return KindredTheme.onAccent
        case .dark, .ghost, .forest: return KindredTheme.ink
        case .danger: return KindredTheme.dangerText
        }
    }

    private var borderColor: Color {
        switch style {
        case .ghost: return KindredTheme.hairlineStrong
        case .danger: return KindredTheme.dangerBorder
        default: return .clear
        }
    }

    private var needsBorder: Bool {
        style == .ghost || style == .danger
    }
}

// MARK: - Avatar

struct KindredAvatar: View {
    let url: String?
    var size: CGFloat = 64
    var borderWidth: CGFloat = 0

    var body: some View {
        Group {
            if let urlStr = url, DemoDataProvider.isDemoURL(urlStr) {
                DemoThumbnailView(urlString: urlStr, cornerRadius: 0)
            } else if let urlStr = url, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        placeholderCircle
                    }
                }
            } else {
                placeholderCircle
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(
            Circle().stroke(KindredTheme.hairlineStrong, lineWidth: borderWidth)
        )
    }

    private var placeholderCircle: some View {
        KindredTheme.avatarGradient
            .overlay {
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.35))
                    .foregroundStyle(KindredTheme.ink.opacity(0.75))
            }
    }
}

/// Initials avatar — forest → terracotta gradient, per the Settings profile card.
struct KindredInitialsAvatar: View {
    let initials: String
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            KindredTheme.avatarGradient
            Text(initials)
                .font(.display(size * 0.4, weight: .semibold, relativeTo: .headline))
                .foregroundStyle(KindredTheme.ink)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

// MARK: - Chip Filter

/// Horizontal capsule chip. Active is a terracotta fill with on-accent ink;
/// inactive is a hairline outline over the ground.
struct KindredChip: View {
    let label: String
    var count: Int? = nil
    var isActive: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(label)
                    .font(.body(12, weight: isActive ? .bold : .semibold, relativeTo: .footnote))
                if let count {
                    Text("\(count)")
                        .font(.mono(10))
                        .foregroundStyle(isActive ? KindredTheme.onAccent.opacity(0.7) : KindredTheme.inkMeta)
                }
            }
            .lineLimit(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .foregroundStyle(isActive ? KindredTheme.onAccent : KindredTheme.inkSecondary)
            .background(isActive ? KindredTheme.accent : Color.clear)
            .clipShape(Capsule())
            .overlay(
                Capsule().stroke(
                    isActive ? Color.clear : Color(hex: 0xF1F1EC, alpha: 0.14),
                    lineWidth: 1
                )
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(count.map { "\(label), \($0)" } ?? label)
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }
}

/// A scrolling row of chips with the screen gutter applied to its content.
struct KindredChipRow<Item: Hashable>: View {
    let items: [Item]
    let label: (Item) -> String
    var count: (Item) -> Int? = { _ in nil }
    @Binding var selection: Item

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                ForEach(items, id: \.self) { item in
                    KindredChip(
                        label: label(item),
                        count: count(item),
                        isActive: item == selection
                    ) {
                        withAnimation(KindredTheme.ease(0.2)) { selection = item }
                    }
                }
            }
            .padding(.horizontal, KindredTheme.gutter)
        }
        .scrollClipDisabled()
    }
}

// MARK: - Tab Bar

/// Frosted tab bar with the capsule pill behind the active item.
/// `rgba(12,14,12,.86)` + blur, 1px top hairline, padding 10/14/22.
struct KindredTabBar: View {
    @Binding var selectedTab: Int

    private let tabs: [(id: Int, label: String, icon: String)] = [
        (0, "Home", "house"),
        (1, "Library", "square.grid.2x2"),
        (2, "Search", "magnifyingglass"),
        (3, "Settings", "gearshape"),
    ]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(tabs, id: \.id) { tab in
                let isActive = selectedTab == tab.id
                Button {
                    withAnimation(KindredTheme.ease(0.16)) { selectedTab = tab.id }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 22, weight: isActive ? .semibold : .medium))
                            .frame(height: 24)
                        Text(tab.label)
                            .font(.body(10, weight: isActive ? .bold : .medium, relativeTo: .caption2))
                    }
                    .foregroundStyle(isActive ? KindredTheme.accent : KindredTheme.inkMeta)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 14)
                    .background(
                        isActive ? KindredTheme.accent.opacity(0.16) : Color.clear,
                        in: Capsule()
                    )
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.label)
                .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(KindredTheme.chrome)
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(KindredTheme.hairline)
                        .frame(height: 1)
                }
                .ignoresSafeArea(.all, edges: .bottom)
        )
    }
}

// MARK: - App Bar (top bar for Home)

/// The inverse lockup — mark plus wordmark, no plate behind it — and a bell.
struct KindredAppBar: View {
    var unreadCount: Int = 0
    var onBellTap: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 9) {
            Image("KindredLogo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 21, height: 21)
                .accessibilityHidden(true)
            Text("kindred")
                .font(.display(18, weight: .semibold, relativeTo: .headline))
                .foregroundStyle(KindredTheme.ink)
                .accessibilityAddTraits(.isHeader)

            Spacer()

            Button {
                onBellTap?()
            } label: {
                ZStack(alignment: .topTrailing) {
                    Circle()
                        .stroke(Color(hex: 0xF1F1EC, alpha: 0.14), lineWidth: 1)
                        .frame(width: 34, height: 34)
                        .overlay {
                            Image(systemName: "bell")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(KindredTheme.inkSecondary)
                        }

                    if unreadCount > 0 {
                        Text(unreadCount > 9 ? "9+" : "\(unreadCount)")
                            .font(.mono(8, weight: .semibold))
                            .foregroundStyle(KindredTheme.onAccent)
                            .frame(minWidth: 16, minHeight: 16)
                            .background(KindredTheme.accent, in: Capsule())
                            .offset(x: 4, y: -4)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                unreadCount > 0 ? "Notifications, \(unreadCount) unread" : "Notifications"
            )
        }
        .padding(.horizontal, KindredTheme.gutter)
        .padding(.vertical, 6)
    }
}

// MARK: - Section Header

struct KindredSectionHeader: View {
    let eyebrow: String
    let title: String
    var trailingText: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            KindredEyebrow(text: eyebrow)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title)
                    .font(.kindredH2)
                    .foregroundStyle(KindredTheme.ink)
                if let trailing = trailingText {
                    Spacer()
                    Text(trailing)
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.inkMeta)
                }
            }
        }
    }
}

// MARK: - Page Header

/// Large title under a mono eyebrow — the standard screen opening.
struct KindredPageHeader: View {
    var eyebrow: String? = nil
    let title: String
    var eyebrowColor: Color = KindredTheme.accent

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let eyebrow {
                KindredEyebrow(text: eyebrow, color: eyebrowColor)
            }
            Text(title)
                .font(.kindredH1)
                .tracking(-0.3) // -.01em
                .foregroundStyle(KindredTheme.ink)
                .accessibilityAddTraits(.isHeader)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, KindredTheme.gutter)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }
}

// MARK: - Day header

/// "Sat 14 June · Campfire at the lake · Select".
/// The place label is only ever a member-named event or a reverse-geocoded
/// EXIF place — never invented, per the handoff's known gaps.
struct KindredDayHeader: View {
    let title: String
    var place: String?
    var trailing: String?
    var trailingAction: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title)
                .font(.kindredDayTitle)
                .foregroundStyle(KindredTheme.ink)
                .accessibilityAddTraits(.isHeader)
            if let place, !place.isEmpty {
                Text(place)
                    .font(.kindredMeta)
                    .foregroundStyle(KindredTheme.inkMeta)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if let trailing, let trailingAction {
                Button(trailing, action: trailingAction)
                    .font(.kindredMeta)
                    .foregroundStyle(KindredTheme.accent)
            }
        }
        .padding(.horizontal, KindredTheme.gutter)
        .padding(.bottom, 8)
    }
}

// MARK: - Skeleton Card

struct SkeletonCard: View {
    @State private var shimmer = false

    var body: some View {
        RoundedRectangle(cornerRadius: KindredTheme.cardRadius)
            .fill(KindredTheme.tile)
            .overlay {
                RoundedRectangle(cornerRadius: KindredTheme.cardRadius)
                    .fill(
                        LinearGradient(
                            colors: [
                                KindredTheme.tile,
                                KindredTheme.fillStrong,
                                KindredTheme.tile,
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .offset(x: shimmer ? 250 : -250)
                    .animation(
                        .easeInOut(duration: 1.4).repeatForever(autoreverses: false),
                        value: shimmer
                    )
            }
            .clipped()
            .onAppear { shimmer = true }
            .accessibilityHidden(true)
    }
}

// MARK: - Stat Card

/// 8px stat card: Space Grotesk number over a mono label.
struct KindredStatCard: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value)
                .font(.display(22, weight: .semibold, relativeTo: .title2))
                .foregroundStyle(KindredTheme.ink)
            Text(label)
                .font(.kindredMeta)
                .foregroundStyle(KindredTheme.inkMeta)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 13)
        .kindredCardStyle()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(value) \(label)")
    }
}

// MARK: - Toggle

struct KindredToggle: View {
    @Binding var isOn: Bool
    var label: String = ""

    var body: some View {
        Toggle(label, isOn: $isOn)
            .tint(KindredTheme.accent)
            .labelsHidden()
    }
}

// MARK: - Settings Row

struct KindredSettingsRow<Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.kindredLabel)
                    .foregroundStyle(KindredTheme.ink)
                if let subtitle {
                    Text(subtitle)
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.inkMeta)
                }
            }
            Spacer()
            trailing()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

// MARK: - On-photo badges

/// `rgba(12,14,12,.76)` pill, mono 9–10pt — cover badges and on-photo chips.
struct KindredPhotoBadge: View {
    let text: String
    var systemImage: String? = nil

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 7, weight: .bold))
            }
            Text(text)
                .font(.kindredMicro)
        }
        .foregroundStyle(KindredTheme.ink)
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(KindredTheme.onPhotoChip, in: Capsule())
    }
}

struct PhotoCountBadge: View {
    let count: Int

    var body: some View {
        KindredPhotoBadge(text: "\(count) photos")
    }
}

// MARK: - Face circle

/// A 1:1 circular face that fills whatever width the grid gives it.
/// `KindredAvatar` takes a fixed point size; the People grid is fluid.
struct FaceCircle: View {
    let url: String?

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let url, DemoDataProvider.isDemoURL(url) {
                    DemoThumbnailView(urlString: url, cornerRadius: 0)
                } else if let url, let parsed = URL(string: url) {
                    AsyncImage(url: parsed) { phase in
                        switch phase {
                        case .success(let image): image.resizable().scaledToFill()
                        default: KindredTheme.avatarGradient
                        }
                    }
                } else {
                    KindredTheme.avatarGradient
                }
            }
            .clipShape(Circle())
            .accessibilityHidden(true)
    }
}

// MARK: - Conditional View Modifier

extension View {
    @ViewBuilder
    func `if`<Content: View>(_ condition: Bool, transform: (Self) -> Content) -> some View {
        if condition {
            transform(self)
        } else {
            self
        }
    }
}
