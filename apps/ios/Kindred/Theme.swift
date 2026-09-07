import SwiftUI

// MARK: - Design Tokens

/// Kindred design system — dark first, photo forward.
///
/// Values are ported verbatim from the shared handoff (`design_handoff_kindred_apps/README.md`),
/// which is the same token column the web redesign ships. Nothing here is re-derived:
/// if a value looks arbitrary it is because it came from the palette table, not from taste.
///
/// The redesign replaced a warm, light palette. The historical token names
/// (`ash`, `paper`, `ember`, …) are kept as aliases at the bottom of the brand
/// section so the ~15k lines of existing screens keep compiling and land on the
/// right side of the new contrast; new code should use the semantic names.
enum KindredTheme {

    // ── Brand Palette ──────────────────────────────────────

    /// Forest — logo stem, avatar gradients (#495645)
    static let forestGreen = Color(hex: 0x495645)
    /// Terracotta — the single accent: active tab, primary buttons, selection (#cc7f61)
    static let accent = Color(hex: 0xCC7F61)
    /// Amber — secondary accent, gradients, "since" eyebrows (#d59851)
    static let amber = Color(hex: 0xD59851)
    /// Sage — success / upload complete (#8fa085)
    static let sageGreen = Color(hex: 0x8FA085)
    /// Sage text — success copy (#a8bb9c)
    static let sageText = Color(hex: 0xA8BB9C)
    /// On-accent ink — text and glyphs on terracotta/amber. Never white. (#14150f)
    static let onAccent = Color(hex: 0x14150F)

    // ── Danger ─────────────────────────────────────────────

    static let dangerBorder = Color(hex: 0xB73E57, alpha: 0.35)
    static let dangerFill = Color(hex: 0xB73E57, alpha: 0.12)
    static let dangerText = Color(hex: 0xE08095)

    // ── Dark surfaces ──────────────────────────────────────

    /// App background (#0c0e0c)
    static let bg = Color(hex: 0x0C0E0C)
    /// Frosted chrome tint — tab bar, nav bar (rgba(12,14,12,.86))
    static let chrome = Color(hex: 0x0C0E0C, alpha: 0.86)
    /// Opaque mobile bar (rgba(23,26,22,.98))
    static let barSolid = Color(hex: 0x171A16, alpha: 0.98)
    /// Sheet surface (#191c17)
    static let sheet = Color(hex: 0x191C17)
    /// Frosted sheet tint (rgba(20,23,20,.96))
    static let sheetFrosted = Color(hex: 0x141714, alpha: 0.96)
    /// Viewer stage (#080908)
    static let stage = Color(hex: 0x080908)
    /// Photo tile placeholder (#191c18)
    static let tile = Color(hex: 0x191C18)
    /// Backdrop behind a presented sheet (rgba(5,6,5,.55))
    static let scrim = Color(hex: 0x050605, alpha: 0.55)

    // ── Ink ────────────────────────────────────────────────

    /// Primary ink (#f1f1ec)
    static let ink = Color(hex: 0xF1F1EC)
    /// Secondary ink (#cfd0c9)
    static let inkSecondary = Color(hex: 0xCFD0C9)
    /// Body copy (#b6b8b0)
    static let inkBody = Color(hex: 0xB6B8B0)
    /// Metadata, mono counts (#9ba095)
    static let inkMeta = Color(hex: 0x9BA095)

    // ── Hairlines and fills ────────────────────────────────

    static let hairline = Color(hex: 0xF1F1EC, alpha: 0.10)
    static let hairlineSoft = Color(hex: 0xF1F1EC, alpha: 0.08)
    static let hairlineStrong = Color(hex: 0xF1F1EC, alpha: 0.16)

    static let fill = Color(hex: 0xF1F1EC, alpha: 0.05)
    static let fillStrong = Color(hex: 0xF1F1EC, alpha: 0.08)
    static let fillStrongest = Color(hex: 0xF1F1EC, alpha: 0.11)

    /// On-photo chips and cover badges (rgba(12,14,12,.76))
    static let onPhotoChip = Color(hex: 0x0C0E0C, alpha: 0.76)

    // ── Legacy aliases ─────────────────────────────────────
    // Kept so the screens that have not been rebuilt yet still compile and
    // still read correctly against a dark ground. Prefer the names above.

    /// Primary ink. Was #2A201B on paper; now the light ink on the dark ground.
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
    /// No blue anywhere in the redesign — links take the accent.
    static let slateBlue = accent

    static let line = hairline
    static let lineDark = hairlineStrong

    static let warmBackground = bg
    static let warmCardBackground = fill
    static let darkAccent = ink

    // ── Radii ──────────────────────────────────────────────

    /// Photo tiles — tight, so the photos read as one field.
    static let radiusTile: CGFloat = 3
    static let radiusXS: CGFloat = 4
    /// Brand rule: cards and sheets are 8px on iOS, not the platform's 12–16.
    static let radiusSM: CGFloat = 8
    /// Grouped inset lists.
    static let radiusMD: CGFloat = 12
    static let radiusLG: CGFloat = 18
    /// Sheet top corners.
    static let radiusXL: CGFloat = 22
    static let radius2XL: CGFloat = 28
    static let radiusPill: CGFloat = 999

    static let cardRadius: CGFloat = 8
    static let buttonRadius: CGFloat = 8

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
    static let tileGap: CGFloat = 2
    /// Screen gutter.
    static let gutter: CGFloat = 20

    // ── Shadows ────────────────────────────────────────────

    static let cardShadow = Color.black.opacity(0.45)
    static let cardShadowHeavy = Color.black.opacity(0.5)

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
            .init(color: Color(hex: 0x0C0E0C, alpha: 0.55), location: 0),
            .init(color: Color(hex: 0x0C0E0C, alpha: 0), location: 0.35),
            .init(color: Color(hex: 0x0C0E0C, alpha: 0.92), location: 1),
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    /// Bottom-only scrim for a poster card's title row.
    static let posterScrim = LinearGradient(
        stops: [
            .init(color: Color(hex: 0x0C0E0C, alpha: 0), location: 0.45),
            .init(color: Color(hex: 0x0C0E0C, alpha: 0.82), location: 1),
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
/// Display: Space Grotesk (500/600/700) — titles, names, big numbers
/// Body: Instrument Sans (400–800) — everything else
/// Mono: IBM Plex Mono (400–600) — counts, metadata, durations, eyebrows
///
/// Every face is registered `relativeTo:` a text style so it grows with
/// Dynamic Type rather than sitting at a fixed point size.
extension Font {

    // ── Space Grotesk (Display) ────────────────────────────

    static func display(
        _ size: CGFloat,
        weight: Font.Weight = .bold,
        relativeTo style: Font.TextStyle = .title
    ) -> Font {
        let name: String
        switch weight {
        case .bold, .heavy, .black: name = "SpaceGrotesk-Bold"
        case .semibold: name = "SpaceGrotesk-SemiBold"
        default: name = "SpaceGrotesk-Medium"
        }
        return .custom(name, size: size, relativeTo: style)
    }

    /// h1 — 30pt screen titles
    static let kindredH1 = Font.custom("SpaceGrotesk-Bold", size: 30, relativeTo: .largeTitle)
    /// h2 — 22pt card sections
    static let kindredH2 = Font.custom("SpaceGrotesk-SemiBold", size: 22, relativeTo: .title2)
    /// h3 — 20pt subsections
    static let kindredH3 = Font.custom("SpaceGrotesk-SemiBold", size: 20, relativeTo: .title3)
    /// Title bar — 17pt
    static let kindredTitle = Font.custom("SpaceGrotesk-SemiBold", size: 17, relativeTo: .headline)
    /// Card title — 15pt
    static let kindredCardTitle = Font.custom("SpaceGrotesk-SemiBold", size: 15, relativeTo: .headline)
    /// Name labels — 13pt
    static let kindredName = Font.custom("SpaceGrotesk-SemiBold", size: 13, relativeTo: .subheadline)
    /// Day header — 16pt
    static let kindredDayTitle = Font.custom("SpaceGrotesk-SemiBold", size: 16, relativeTo: .headline)

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

    /// Eyebrow — 10pt semibold, uppercase, .18em tracking. Required above section titles.
    static let kindredEyebrow = Font.custom("IBMPlexMono-SemiBold", size: 10, relativeTo: .caption2)
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
