import SwiftUI

// MARK: - Design Tokens

/// The library palette shared with the web app, resolved against iOS appearance.
enum KindredTheme {
    private static func adaptive(_ light: UInt32, _ dark: UInt32, alpha: CGFloat = 1) -> Color {
        Color(uiColor: UIColor { traits in
            let rgb = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((rgb >> 16) & 0xff) / 255,
                green: CGFloat((rgb >> 8) & 0xff) / 255,
                blue: CGFloat(rgb & 0xff) / 255,
                alpha: alpha
            )
        })
    }

    static let forestGreen = adaptive(0x20786C, 0x64CBBE)
    static let accent = adaptive(0x6554C0, 0xB6A6F1)
    static let amber = adaptive(0x9B4935, 0xF28B70)
    static let sageGreen = adaptive(0x258576, 0x35AA9C)
    static let sageText = adaptive(0x20786C, 0x8DDDD3)
    static let onAccent = adaptive(0xFFFFFF, 0x21193F)
    static let onSuccess = adaptive(0xFFFFFF, 0x102824)

    static let dangerBorder = adaptive(0x943D50, 0xF4A8B8, alpha: 0.40)
    static let dangerFill = adaptive(0xB73E57, 0xE08095, alpha: 0.12)
    static let dangerText = adaptive(0x943D50, 0xF4A8B8)

    static let bg = adaptive(0xF7F7F3, 0x191820)
    static let chrome = adaptive(0xF7F7F3, 0x191820, alpha: 0.94)
    static let barSolid = adaptive(0xFFFFFF, 0x24232E, alpha: 0.98)
    static let sheet = adaptive(0xFFFFFF, 0x24232E)
    static let sheetFrosted = adaptive(0xFFFFFF, 0x24232E, alpha: 0.96)
    static let stage = adaptive(0xF7F7F3, 0x14131B)
    static let tile = adaptive(0xE8E7ED, 0x302C3E)
    static let scrim = Color(hex: 0x191820, alpha: 0.55)

    static let ink = adaptive(0x25262C, 0xF4F1FF)
    static let inkSecondary = adaptive(0x454650, 0xDFDCE9)
    static let inkBody = adaptive(0x555460, 0xC8C4D5)
    static let inkMeta = adaptive(0x676873, 0xAAA6BB)

    static let hairline = adaptive(0xE5E5E1, 0x383442)
    static let hairlineSoft = adaptive(0xEFEEEA, 0x302C3E)
    static let hairlineStrong = adaptive(0xD8D4DF, 0x504C62)

    static let fill = adaptive(0xFFFFFF, 0x24232E)
    static let fillStrong = adaptive(0xEFEEF0, 0x32303F)
    static let fillStrongest = adaptive(0xE8E5EE, 0x403B50)

    /// Photo overlays always need light text against a dark surface.
    static let onPhotoChip = Color(hex: 0x191820, alpha: 0.82)
    static let onPhotoInk = Color(hex: 0xF4F1FF)

    // ── Legacy aliases ─────────────────────────────────────
    // Kept so the screens that have not been rebuilt yet still compile and
    // keep using the shared semantic colors.

    /// Primary ink.
    static let ash = ink
    static let ash2 = inkSecondary
    /// App background.
    static let paper = bg
    /// Secondary surface / tile placeholder.
    static let canvas = tile
    /// Card surface.
    static let card = fill
    /// Primary accent.
    static let ember = accent
    static let emberSoft = amber
    static let terracotta = accent
    static let gold = amber
    /// Secondary text.
    static let pine = inkSecondary
    /// Tertiary text.
    static let mist = inkMeta
    static let muted = inkMeta
    /// Success / confirmed.
    static let forest = forestGreen
    static let sage = sageGreen
    static let lichen = sageGreen
    static let mossMist = sageText
    /// Danger.
    static let rosehip = dangerText
    /// Links use the brand accent.
    static let slateBlue = accent

    static let line = hairline
    static let lineDark = hairlineStrong

    static let warmBackground = bg
    static let warmCardBackground = fill
    static let darkAccent = ink

    // ── Radii ──────────────────────────────────────────────

    static let radiusTile: CGFloat = 9
    static let radiusXS: CGFloat = 4
    static let radiusSM: CGFloat = 10
    /// Grouped inset lists.
    static let radiusMD: CGFloat = 12
    static let radiusLG: CGFloat = 18
    /// Sheet top corners.
    static let radiusXL: CGFloat = 22
    static let radius2XL: CGFloat = 28
    static let radiusPill: CGFloat = 999

    static let cardRadius: CGFloat = 14
    static let buttonRadius: CGFloat = 10

    // ── Spacing (4pt grid) ─────────────────────────────────

    static let s1: CGFloat = 4
    static let s2: CGFloat = 8
    static let s3: CGFloat = 12
    static let s4: CGFloat = 16
    static let s5: CGFloat = 20
    static let s6: CGFloat = 24
    static let s8: CGFloat = 32
    static let s10: CGFloat = 40
    static let s12: CGFloat = 48
    static let s16: CGFloat = 64
    static let s20: CGFloat = 80

    /// Gutter between photo tiles.
    static let tileGap: CGFloat = 4
    /// Screen gutter.
    static let gutter: CGFloat = 20

    // ── Shadows ────────────────────────────────────────────

    static let cardShadow = adaptive(0x342D42, 0x000000, alpha: 0.16)
    static let cardShadowHeavy = adaptive(0x342D42, 0x000000, alpha: 0.24)

    // ── Motion ─────────────────────────────────────────────

    /// The handoff's single easing curve: cubic-bezier(0.16, 1, 0.3, 1).
    static func ease(_ duration: Double = 0.24) -> Animation {
        .timingCurve(0.16, 1, 0.3, 1, duration: duration)
    }

    // ── Gradients ──────────────────────────────────────────

    static let warmGradient = LinearGradient(
        colors: [bg, bg],
        startPoint: .top,
        endPoint: .bottom
    )

    /// Terracotta → amber. Progress bars, active fills.
    static let emberGradient = LinearGradient(
        colors: [accent, amber],
        startPoint: .leading,
        endPoint: .trailing
    )

    static let forestGradient = LinearGradient(
        colors: [forestGreen, sageGreen],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Forest → terracotta, per the settings profile card.
    static let avatarGradient = LinearGradient(
        colors: [forestGreen, accent],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Top-and-bottom scrim over a full-bleed cover.
    static let coverScrim = LinearGradient(
        stops: [
            .init(color: Color(hex: 0x191820, alpha: 0.55), location: 0),
            .init(color: Color(hex: 0x191820, alpha: 0), location: 0.35),
            .init(color: Color(hex: 0x191820, alpha: 0.92), location: 1),
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    /// Bottom-only scrim for a poster card's title row.
    static let posterScrim = LinearGradient(
        stops: [
            .init(color: Color(hex: 0x191820, alpha: 0), location: 0.45),
            .init(color: Color(hex: 0x191820, alpha: 0.82), location: 1),
        ],
        startPoint: .top,
        endPoint: .bottom
    )
}

// MARK: - Color Hex Init

extension Color {
    init(hex: UInt, alpha: Double = 1.0) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: alpha
        )
    }
}

// MARK: - Custom Fonts

/// Font extensions for the Kindred brand typography.
/// Instrument Sans for headings and body text. IBM Plex Mono for data.
///
/// Every face is registered `relativeTo:` a text style so it grows with
/// Dynamic Type rather than sitting at a fixed point size.
extension Font {

    // ── Headings ─────────────────────────────────────────

    static func display(
        _ size: CGFloat,
        weight: Font.Weight = .bold,
        relativeTo style: Font.TextStyle = .title
    ) -> Font {
        body(size, weight: weight, relativeTo: style)
    }

    /// h1 — 30pt screen titles
    static let kindredH1 = Font.display(30, relativeTo: .largeTitle)
    /// h2 — 22pt card sections
    static let kindredH2 = Font.display(22, weight: .semibold, relativeTo: .title2)
    /// h3 — 20pt subsections
    static let kindredH3 = Font.display(20, weight: .semibold, relativeTo: .title3)
    /// Title bar — 17pt
    static let kindredTitle = Font.display(17, weight: .semibold, relativeTo: .headline)
    /// Card title — 15pt
    static let kindredCardTitle = Font.display(15, weight: .semibold, relativeTo: .headline)
    /// Name labels — 13pt
    static let kindredName = Font.display(13, weight: .semibold, relativeTo: .subheadline)
    /// Day header — 16pt
    static let kindredDayTitle = Font.display(16, weight: .semibold, relativeTo: .headline)

    // ── Instrument Sans (Body) ─────────────────────────────

    static func body(
        _ size: CGFloat,
        weight: Font.Weight = .regular,
        relativeTo style: Font.TextStyle = .body
    ) -> Font {
        let name: String
        switch weight {
        case .black, .heavy: name = "InstrumentSans-Bold"
        case .bold: name = "InstrumentSans-Bold"
        case .semibold: name = "InstrumentSans-SemiBold"
        case .medium: name = "InstrumentSans-Medium"
        default: name = "InstrumentSans-Regular"
        }
        return .custom(name, size: size, relativeTo: style)
    }

    static let kindredBodyLG = Font.custom("InstrumentSans-Regular", size: 15, relativeTo: .body)
    static let kindredBody = Font.custom("InstrumentSans-Regular", size: 13, relativeTo: .callout)
    static let kindredCaption = Font.custom("InstrumentSans-Regular", size: 12, relativeTo: .footnote)
    /// Button — 15pt/800
    static let kindredButton = Font.custom("InstrumentSans-Bold", size: 15, relativeTo: .headline)
    static let kindredButtonSM = Font.custom("InstrumentSans-Bold", size: 13, relativeTo: .subheadline)
    static let kindredLabel = Font.custom("InstrumentSans-SemiBold", size: 14, relativeTo: .subheadline)

    // ── IBM Plex Mono ──────────────────────────────────────

    static func mono(
        _ size: CGFloat,
        weight: Font.Weight = .regular,
        relativeTo style: Font.TextStyle = .caption
    ) -> Font {
        let name: String
        switch weight {
        case .semibold, .bold, .heavy, .black: name = "IBMPlexMono-SemiBold"
        case .medium: name = "IBMPlexMono-Medium"
        default: name = "IBMPlexMono-Regular"
        }
        return .custom(name, size: size, relativeTo: style)
    }

    static let kindredMicro = Font.custom("IBMPlexMono-Regular", size: 9, relativeTo: .caption2)
    static let kindredMeta = Font.custom("IBMPlexMono-Regular", size: 10, relativeTo: .caption2)
    static let kindredInputLabel = Font.custom("IBMPlexMono-SemiBold", size: 9, relativeTo: .caption2)
}

// MARK: - View Modifiers

extension View {
    /// 8px card — the brand radius, which beats the platform's 12–16.
    func kindredCardStyle() -> some View {
        self
            .background(KindredTheme.fill)
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.cardRadius))
            .overlay(
                RoundedRectangle(cornerRadius: KindredTheme.cardRadius)
                    .stroke(KindredTheme.hairline, lineWidth: 1)
            )
    }

    /// 12px grouped inset list group.
    func kindredGroupedCard() -> some View {
        self
            .background(KindredTheme.fill)
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusMD))
            .overlay(
                RoundedRectangle(cornerRadius: KindredTheme.radiusMD)
                    .stroke(KindredTheme.hairline, lineWidth: 1)
            )
    }

    func kindredWarmBackground() -> some View {
        self.background(KindredTheme.bg)
    }

    func kindredPaperBackground() -> some View {
        self
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(KindredTheme.bg.ignoresSafeArea())
    }

    /// Entry motion from the handoff: 14px rise + fade, no bounce.
    func kindredEntry(_ isVisible: Bool, delay: Double = 0) -> some View {
        self
            .opacity(isVisible ? 1 : 0)
            .offset(y: isVisible ? 0 : 14)
            .animation(KindredTheme.ease(0.38).delay(delay), value: isVisible)
    }
}

// MARK: - Skeleton Shimmer

struct KindredShimmer: ViewModifier {
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay(
                LinearGradient(
                    colors: [
                        KindredTheme.tile,
                        KindredTheme.fillStrong,
                        KindredTheme.tile,
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .offset(x: phase * 300)
                .animation(
                    .easeInOut(duration: 1.4).repeatForever(autoreverses: false),
                    value: phase
                )
            )
            .clipped()
            .onAppear { phase = 1 }
    }
}

extension View {
    func kindredShimmer() -> some View {
        modifier(KindredShimmer())
    }
}
