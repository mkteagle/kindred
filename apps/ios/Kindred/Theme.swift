import SwiftUI

// MARK: - Design Tokens

/// Kindred design system — warm, editorial, family-photo-first.
/// Tokens lifted from the web app's globals.css (source of truth).
enum KindredTheme {

    // ── Brand Palette ──────────────────────────────────────

    /// Primary ink (#2A201B)
    static let ash = Color(hex: 0x2A201B)
    /// Deep charcoal brown (#4A281A)
    static let ash2 = Color(hex: 0x4A281A)

    /// Primary surface (#FBF4E7)
    static let paper = Color(hex: 0xFBF4E7)
    /// Secondary surface / panels (#F7EBD4)
    static let canvas = Color(hex: 0xF7EBD4)
    /// Card surface — warm white (#FFFDF8)
    static let card = Color(hex: 0xFFFDF8)

    /// Primary accent — CTAs, badges (#C9551C)
    static let ember = Color(hex: 0xC9551C)
    /// Secondary accent (#F28A4B)
    static let emberSoft = Color(hex: 0xF28A4B)
    /// Eyebrow alt / terracotta (#A84A1D)
    static let terracotta = Color(hex: 0xA84A1D)

    /// Beeswax glow, secondary CTA (#E9B85D)
    static let gold = Color(hex: 0xE9B85D)

    /// Secondary text / walnut (#6D3C24)
    static let pine = Color(hex: 0x6D3C24)
    /// Tertiary text (#7D553F)
    static let mist = Color(hex: 0x7D553F)
    /// Muted captions (#946F5B)
    static let muted = Color(hex: 0x946F5B)

    /// Success, confirmed states (#2F4A36)
    static let forest = Color(hex: 0x2F4A36)
    /// Data accent (#4A6B4F)
    static let sage = Color(hex: 0x4A6B4F)
    /// Soft fills (#7A9072)
    static let lichen = Color(hex: 0x7A9072)
    /// Tint background (#CFD8B8)
    static let mossMist = Color(hex: 0xCFD8B8)

    /// Danger / dismiss (#A4324C)
    static let rosehip = Color(hex: 0xA4324C)
    /// Info / links (#3B6582)
    static let slateBlue = Color(hex: 0x3B6582)

    // ── Semantic Colors ────────────────────────────────────

    /// Hairline borders
    static let line = Color(hex: 0x4A281A).opacity(0.12)
    /// Stronger borders, inputs
    static let lineDark = Color(hex: 0x4A281A).opacity(0.20)

    // Legacy aliases (for code that still references old names)
    static let warmBackground = paper
    static let warmCardBackground = canvas
    static let darkAccent = ash

    // ── Radii ──────────────────────────────────────────────

    static let radiusXS: CGFloat = 6    // image thumbs
    static let radiusSM: CGFloat = 8    // default — cards, buttons, inputs
    static let radiusMD: CGFloat = 12   // grouped lists
    static let radiusLG: CGFloat = 18   // modals
    static let radiusXL: CGFloat = 22   // sheet tops
    static let radius2XL: CGFloat = 28  // big features
    static let radiusPill: CGFloat = 999

    /// Default card radius (matches radiusSM)
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

    // ── Shadows ────────────────────────────────────────────

    static let cardShadow = Color(hex: 0x6D3C24).opacity(0.12)
    static let cardShadowHeavy = Color(hex: 0x6D3C24).opacity(0.16)

    // ── Gradients ──────────────────────────────────────────

    static let warmGradient = LinearGradient(
        colors: [paper, canvas, ember.opacity(0.08)],
        startPoint: .top,
        endPoint: .bottom
    )

    static let emberGradient = LinearGradient(
        colors: [ember, emberSoft, gold],
        startPoint: .leading,
        endPoint: .trailing
    )

    static let forestGradient = LinearGradient(
        colors: [forest, lichen],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let avatarGradient = LinearGradient(
        colors: [gold, ember],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
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
/// Display: Space Grotesk (500/600/700)
/// Body: Instrument Sans (400/500/600/700)
/// Mono: IBM Plex Mono (400/500/600)
extension Font {

    // ── Space Grotesk (Display) ────────────────────────────

    static func display(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        let name: String
        switch weight {
        case .bold: name = "SpaceGrotesk-Bold"
        case .semibold: name = "SpaceGrotesk-SemiBold"
        default: name = "SpaceGrotesk-Medium"
        }
        return .custom(name, size: size)
    }

    /// h1 — 30-34pt screen titles
    static let kindredH1 = Font.custom("SpaceGrotesk-Bold", size: 30)
    /// h2 — 22-24pt card sections
    static let kindredH2 = Font.custom("SpaceGrotesk-Bold", size: 22)
    /// h3 — 20pt subsections
    static let kindredH3 = Font.custom("SpaceGrotesk-Bold", size: 20)
    /// Title bar — 18pt
    static let kindredTitle = Font.custom("SpaceGrotesk-Bold", size: 18)
    /// Card title — 15pt
    static let kindredCardTitle = Font.custom("SpaceGrotesk-Bold", size: 15)
    /// Name labels — 13pt bold
    static let kindredName = Font.custom("SpaceGrotesk-Bold", size: 13)

    // ── Instrument Sans (Body) ─────────────────────────────

    static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .bold: name = "InstrumentSans-Bold"
        case .semibold: name = "InstrumentSans-SemiBold"
        case .medium: name = "InstrumentSans-Medium"
        default: name = "InstrumentSans-Regular"
        }
        return .custom(name, size: size)
    }

    /// Body large — 17pt
    static let kindredBodyLG = Font.custom("InstrumentSans-Regular", size: 17)
    /// Body default — 15pt
    static let kindredBody = Font.custom("InstrumentSans-Regular", size: 15)
    /// Caption — 13pt
    static let kindredCaption = Font.custom("InstrumentSans-Regular", size: 13)
    /// Button — 15pt bold
    static let kindredButton = Font.custom("InstrumentSans-Bold", size: 15)
    /// Button small — 14pt bold
    static let kindredButtonSM = Font.custom("InstrumentSans-Bold", size: 14)
    /// Label — 14pt semibold
    static let kindredLabel = Font.custom("InstrumentSans-SemiBold", size: 14)

    // ── IBM Plex Mono ──────────────────────────────────────

    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .semibold: name = "IBMPlexMono-SemiBold"
        case .medium: name = "IBMPlexMono-Medium"
        default: name = "IBMPlexMono-Regular"
        }
        return .custom(name, size: size)
    }

    /// Eyebrow — 10pt semibold
    static let kindredEyebrow = Font.custom("IBMPlexMono-SemiBold", size: 10)
    /// Micro — 9pt
    static let kindredMicro = Font.custom("IBMPlexMono-Regular", size: 9)
    /// Meta — 10pt
    static let kindredMeta = Font.custom("IBMPlexMono-Regular", size: 10)
    /// Input label — 9pt semibold
    static let kindredInputLabel = Font.custom("IBMPlexMono-SemiBold", size: 9)
}

// MARK: - View Modifiers

extension View {
    func kindredCardStyle() -> some View {
        self
            .background(KindredTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.cardRadius))
            .overlay(
                RoundedRectangle(cornerRadius: KindredTheme.cardRadius)
                    .stroke(KindredTheme.line, lineWidth: 1)
            )
            .shadow(color: KindredTheme.cardShadow, radius: 11, x: 0, y: 10)
    }

    func kindredGroupedCard() -> some View {
        self
            .background(KindredTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusMD))
            .overlay(
                RoundedRectangle(cornerRadius: KindredTheme.radiusMD)
                    .stroke(KindredTheme.line, lineWidth: 1)
            )
    }

    func kindredWarmBackground() -> some View {
        self.background(KindredTheme.paper)
    }

    func kindredPaperBackground() -> some View {
        self
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(KindredTheme.paper.ignoresSafeArea())
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
                        KindredTheme.paper,
                        KindredTheme.canvas,
                        KindredTheme.paper
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
