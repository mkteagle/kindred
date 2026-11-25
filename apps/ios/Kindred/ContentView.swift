import SwiftUI

/// Shared navigation for iPhone, iPad, and resizable windows.
struct ContentView: View {
    @State private var selectedTab = 0
    @State private var visitedTabs: Set<Int> = [0]

    var body: some View {
        ZStack {
            KindredTheme.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                ZStack {
                    // Mount each tab on its first visit. Keep it mounted so its
                    // scroll position and drafts survive a trip to another tab.
                    HomeView(isActive: selectedTab == 0, onNavigateToTab: { tab in
                        withAnimation(KindredTheme.ease(0.16)) { selectTab(tab) }
                    })
                    .opacity(selectedTab == 0 ? 1 : 0)
                    .allowsHitTesting(selectedTab == 0)
                    .accessibilityHidden(selectedTab != 0)

                    if visitedTabs.contains(1) {
                        LibraryView()
                            .opacity(selectedTab == 1 ? 1 : 0)
                            .allowsHitTesting(selectedTab == 1)
                            .accessibilityHidden(selectedTab != 1)
                    }

                    if visitedTabs.contains(2) {
                        SearchView(isActive: selectedTab == 2, onNavigateToTab: selectTab)
                            .opacity(selectedTab == 2 ? 1 : 0)
                            .allowsHitTesting(selectedTab == 2)
                            .accessibilityHidden(selectedTab != 2)
                    }

                    if visitedTabs.contains(3) {
                        SettingsView()
                            .opacity(selectedTab == 3 ? 1 : 0)
                            .allowsHitTesting(selectedTab == 3)
                            .accessibilityHidden(selectedTab != 3)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                // Keep scrolling content inside its own row, above the bar.
                .clipped()

                if !KindredChrome.shared.hidesTabBar {
                    KindredTabBar(selectedTab: Binding(get: { selectedTab }, set: selectTab))
                        .transition(.move(edge: .bottom))
                }
            }
        }
        .ignoresSafeArea(.keyboard)
    }

    private func selectTab(_ tab: Int) {
        visitedTabs.insert(tab)
        selectedTab = tab
    }
}
