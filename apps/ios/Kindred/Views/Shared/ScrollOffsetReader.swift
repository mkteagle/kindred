import SwiftUI

/// Vertical scroll offset, published through a preference.
///
/// `onScrollGeometryChange` would be tidier but arrived in iOS 18 and the app
/// still ships to 17, so the offset is read the long way.
struct ScrollOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

extension View {
    /// Place at the very top of a scroll view's content.
    func readsScrollOffset(in space: String) -> some View {
        background(
            GeometryReader { geo in
                Color.clear.preference(
                    key: ScrollOffsetKey.self,
                    value: -geo.frame(in: .named(space)).minY
                )
            }
        )
    }
}

/// A large title that collapses into the nav bar, the way the platform's own
/// does — but drawn in Space Grotesk under a mono eyebrow, which the system
/// large title cannot do. IOS.md makes the brand's eyebrow rule beat the
/// platform habit here, so the collapse is rebuilt rather than inherited.
struct CollapsingTitleHeader: View {
    let eyebrow: String
    let title: String
    var eyebrowColor: Color = KindredTheme.accent
    let offset: CGFloat

    /// Fades out over the same distance UIKit uses before swapping in the
    /// inline title.
    private var progress: CGFloat {
        min(1, max(0, offset / 44))
    }

    var body: some View {
        KindredPageHeader(eyebrow: eyebrow, title: title, eyebrowColor: eyebrowColor)
            .opacity(1 - progress)
    }
}
