import SwiftUI

// MARK: - Eyebrow

/// Mono uppercase eyebrow label — the brand's signature micro-label.
struct KindredEyebrow: View {
    let text: String
    var color: Color = KindredTheme.ember
    var isPill: Bool = false

    var body: some View {
        Text(text.uppercased())
            .font(.kindredEyebrow)
            .tracking(1.8) // .18em
            .foregroundStyle(color)
            .if(isPill) { view in
                view
                    .padding(.horizontal, 11)
                    .padding(.vertical, 8)
                    .background(KindredTheme.gold.opacity(0.11))
                    .overlay(
                        RoundedRectangle(cornerRadius: KindredTheme.radiusPill)
                            .stroke(KindredTheme.ember.opacity(0.18), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusPill))
            }
    }
}

// MARK: - Buttons

enum KindredButtonStyle {
    case primary    // ember bg, white text
    case dark       // ash bg, paper text
    case ghost      // transparent, line border, ash text
    case danger     // rosehip tint
    case forest     // forest bg, white text
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
                    .font(isSmall ? .body(12, weight: .bold) : .kindredButtonSM)
            }
            .foregroundStyle(foregroundColor)
            .frame(maxWidth: isFullWidth ? .infinity : nil)
            .frame(height: isSmall ? 34 : 48)
            .padding(.horizontal, isSmall ? 11 : 15)
            .background(backgroundColor)
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
            .overlay(
                RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                    .stroke(borderColor, lineWidth: needsBorder ? 1 : 0)
            )
        }
        .disabled(isLoading)
    }

    private var backgroundColor: Color {
        switch style {
        case .primary: return KindredTheme.ember
        case .dark: return KindredTheme.ash
        case .ghost: return .clear
        case .danger: return KindredTheme.rosehip.opacity(0.1)
        case .forest: return KindredTheme.forest
        }
    }

    private var foregroundColor: Color {
        switch style {
        case .primary, .dark, .forest: return .white
        case .ghost: return KindredTheme.ash
        case .danger: return KindredTheme.rosehip
        }
    }

    private var borderColor: Color {
        switch style {
        case .ghost: return KindredTheme.lineDark
        case .danger: return KindredTheme.rosehip.opacity(0.24)
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
    var borderWidth: CGFloat = 2

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
        .overlay(Circle().stroke(.white, lineWidth: borderWidth))
        .shadow(color: KindredTheme.cardShadow, radius: 7, x: 0, y: 6)
    }

    private var placeholderCircle: some View {
        KindredTheme.avatarGradient
            .overlay {
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.35))
                    .foregroundStyle(.white.opacity(0.8))
            }
    }
}

/// Initials avatar (for household card)
struct KindredInitialsAvatar: View {
    let initials: String
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            KindredTheme.avatarGradient
            Text(initials)
                .font(.display(size * 0.36, weight: .bold))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

// MARK: - Chip Filter

struct KindredChip: View {
    let label: String
    var count: Int? = nil
    var isActive: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Text(label)
                    .font(.body(13, weight: .bold))
                if let count {
                    Text("\(count)")
                        .font(.mono(10))
                        .padding(.horizontal, 6)
                        .frame(minWidth: 20, minHeight: 18)
                        .background(
                            isActive
                                ? KindredTheme.paper.opacity(0.18)
                                : KindredTheme.forest.opacity(0.1)
                        )
                        .foregroundStyle(isActive ? KindredTheme.gold : KindredTheme.pine)
                        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusPill))
                }
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 8)
            .foregroundStyle(isActive ? KindredTheme.paper : KindredTheme.pine)
            .background(isActive ? KindredTheme.ash : KindredTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
            .overlay(
                RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                    .stroke(isActive ? KindredTheme.ash : KindredTheme.line, lineWidth: 1)
            )
        }
    }
}

// MARK: - Tab Bar

struct KindredTabBar: View {
    @Binding var selectedTab: Int

    // Thin-stroke outlined icons matching the design spec
    private let tabs: [(id: Int, label: String, iconDefault: String, iconActive: String)] = [
        (0, "Home", "house", "house.fill"),
        (1, "Library", "square.grid.2x2", "square.grid.2x2.fill"),
        (2, "Search", "magnifyingglass", "magnifyingglass"),
        (3, "Settings", "slider.horizontal.3", "slider.horizontal.3"),
    ]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(tabs, id: \.id) { tab in
                let isActive = selectedTab == tab.id
                Button {
                    withAnimation(.easeOut(duration: 0.16)) {
                        selectedTab = tab.id
                    }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: isActive ? tab.iconActive : tab.iconDefault)
                            .font(.system(size: 18, weight: isActive ? .semibold : .light))
                            .frame(height: 22)
                        Text(tab.label)
                            .font(.body(10, weight: isActive ? .bold : .medium))
                            .tracking(0.2)
                    }
                    .foregroundStyle(isActive ? KindredTheme.ember : KindredTheme.mist)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 14)
                    .background(
                        isActive
                            ? KindredTheme.ember.opacity(0.13)
                            : Color.clear
                    )
                    .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusPill))
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 0)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(
                    KindredTheme.paper.opacity(0.65)
                )
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(KindredTheme.line)
                        .frame(height: 0.5)
                }
                .ignoresSafeArea(.all, edges: .bottom)
        )
    }
}

// MARK: - App Bar (top bar for Home)

struct KindredAppBar: View {
    var unreadCount: Int = 0
    var onBellTap: (() -> Void)? = nil

    var body: some View {
        HStack {
            HStack(spacing: 8) {
                Image("KindredLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 28, height: 28)
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                Text("Kindred")
                    .font(.kindredTitle)
                    .foregroundStyle(KindredTheme.ash)
            }
            Spacer()
            Button {
                onBellTap?()
            } label: {
                ZStack(alignment: .topTrailing) {
                    Circle()
                        .fill(KindredTheme.card)
                        .frame(width: 34, height: 34)
                        .overlay(
                            Circle().stroke(KindredTheme.line, lineWidth: 1)
                        )
                        .overlay {
                            Image(systemName: "bell")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(KindredTheme.pine)
                        }

                    // Unread badge
                    if unreadCount > 0 {
                        Text(unreadCount > 9 ? "9+" : "\(unreadCount)")
                            .font(.mono(8, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(minWidth: 16, minHeight: 16)
                            .background(KindredTheme.ember)
                            .clipShape(Capsule())
                            .offset(x: 4, y: -4)
                    }
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 4)
    }
}

// MARK: - Section Header

struct KindredSectionHeader: View {
    let eyebrow: String
    let title: String
    var trailingText: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .lastTextBaseline) {
                KindredEyebrow(text: eyebrow)
                Spacer()
                if let trailing = trailingText {
                    Text(trailing)
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.pine)
                }
            }
            Text(title)
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ash)
        }
    }
}

// MARK: - Page Header

struct KindredPageHeader: View {
    var eyebrow: String? = nil
    let title: String
    var eyebrowColor: Color = KindredTheme.ember

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let eyebrow {
                KindredEyebrow(text: eyebrow, color: eyebrowColor)
            }
            Text(title)
                .font(.kindredH1)
                .foregroundStyle(KindredTheme.ash)
                .lineSpacing(-2)
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 4)
    }
}

// MARK: - Skeleton Card (redesigned)

struct SkeletonCard: View {
    @State private var shimmer = false

    var body: some View {
        RoundedRectangle(cornerRadius: KindredTheme.cardRadius)
            .fill(KindredTheme.canvas)
            .overlay {
                RoundedRectangle(cornerRadius: KindredTheme.cardRadius)
                    .fill(
                        LinearGradient(
                            colors: [
                                KindredTheme.paper,
                                KindredTheme.canvas,
                                KindredTheme.paper,
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
    }
}

// MARK: - Stat Card

struct KindredStatCard: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.display(18, weight: .bold))
                .foregroundStyle(KindredTheme.ash)
            Text(label.uppercased())
                .font(.kindredMicro)
                .tracking(1)
                .foregroundStyle(KindredTheme.mist)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(KindredTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
        .overlay(
            RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                .stroke(KindredTheme.line, lineWidth: 1)
        )
    }
}

// MARK: - Toggle (forest green style)

struct KindredToggle: View {
    @Binding var isOn: Bool

    var body: some View {
        Toggle("", isOn: $isOn)
            .tint(KindredTheme.forest)
            .labelsHidden()
    }
}

// MARK: - Settings Row

struct KindredSettingsRow<Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.kindredLabel)
                    .foregroundStyle(KindredTheme.ash)
                if let subtitle {
                    Text(subtitle)
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.mist)
                }
            }
            Spacer()
            trailing()
        }
        .padding(14)
    }
}

// MARK: - Photo Count Badge

struct PhotoCountBadge: View {
    let count: Int

    var body: some View {
        Text("\(count) photos")
            .font(.mono(9, weight: .semibold))
            .foregroundStyle(KindredTheme.paper)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(Color.black.opacity(0.76))
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusPill))
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
