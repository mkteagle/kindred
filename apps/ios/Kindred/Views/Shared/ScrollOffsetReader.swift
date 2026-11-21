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

/// Matches the large title's fade with the inline navigation title.
struct CollapsingTitleHeader: View {
    let title: String
    var subtitle: String? = nil
    let offset: CGFloat

    /// Fades out over the same distance UIKit uses before swapping in the
    /// inline title.
    private var progress: CGFloat {
        min(1, max(0, offset / 44))
    }

    var body: some View {
        KindredPageHeader(title: title, subtitle: subtitle)
            .opacity(1 - progress)
    }
}
