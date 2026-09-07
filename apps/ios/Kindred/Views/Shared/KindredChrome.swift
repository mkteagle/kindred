import SwiftUI

/// Chrome the tab container owns but individual screens need to influence.
///
/// Select mode replaces the tab bar with its own action bar rather than
/// stacking one on the other, so the screen entering select mode has to be
/// able to take the tab bar down.
@Observable
@MainActor
final class KindredChrome {
    static let shared = KindredChrome()
    private init() {}

    var hidesTabBar = false
}
