import SwiftUI

/// Central theme for the Kindred app.
/// Uses pine/teal as primary, ember/pink as accent, and warm paper backgrounds.
enum KindredTheme {
    // MARK: - Colors

    /// Pine/teal primary color (#23606a)
    static let pine = Color(red: 0x23 / 255.0, green: 0x60 / 255.0, blue: 0x6a / 255.0)

    /// Ember/pink accent color (#f80798)
    static let ember = Color(red: 0xf8 / 255.0, green: 0x07 / 255.0, blue: 0x98 / 255.0)

    /// Dark accent (#1a1a2e)
    static let darkAccent = Color(red: 0x1a / 255.0, green: 0x1a / 255.0, blue: 0x2e / 255.0)

    /// Warm paper background
    static let warmBackground = Color(red: 0xFA / 255.0, green: 0xF7 / 255.0, blue: 0xF2 / 255.0)

    /// Slightly darker warm tone for cards/secondary backgrounds
    static let warmCardBackground = Color(red: 0xF3 / 255.0, green: 0xEF / 255.0, blue: 0xE8 / 255.0)

    /// Card shadow color
    static let cardShadow = Color.black.opacity(0.08)

    // MARK: - Gradients

    /// Warm gradient for login screen background
    static let warmGradient = LinearGradient(
        colors: [
            Color(red: 0xFA / 255.0, green: 0xF7 / 255.0, blue: 0xF2 / 255.0),
            Color(red: 0xEE / 255.0, green: 0xE5 / 255.0, blue: 0xD6 / 255.0),
            pine.opacity(0.15)
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    // MARK: - Corner Radius

    static let cardRadius: CGFloat = 12
    static let buttonRadius: CGFloat = 14

    // MARK: - Shadows

    static func cardShadowModifier() -> some ViewModifier {
        CardShadowModifier()
    }
}

// MARK: - Card Shadow Modifier

struct CardShadowModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .shadow(color: KindredTheme.cardShadow, radius: 6, x: 0, y: 2)
    }
}

// MARK: - View Extensions

extension View {
    func kindredCardStyle() -> some View {
        self
            .background(KindredTheme.warmCardBackground)
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.cardRadius))
            .shadow(color: KindredTheme.cardShadow, radius: 6, x: 0, y: 2)
    }

    func kindredWarmBackground() -> some View {
        self
            .background(KindredTheme.warmBackground)
    }
}
