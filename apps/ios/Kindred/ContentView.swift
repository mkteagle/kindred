import SwiftUI

struct ContentView: View {
    @State private var selectedTab = 0
    @State private var demo = DemoDataProvider.shared

    var body: some View {
        ZStack(alignment: .bottom) {
            // Keep all tabs alive — just hide inactive ones
            // This prevents rebuilding views and re-fetching data on every tab switch
            HomeView(onNavigateToTab: { tab in
                withAnimation(.easeOut(duration: 0.16)) {
                    selectedTab = tab
                }
            })
            .opacity(selectedTab == 0 ? 1 : 0)
            .allowsHitTesting(selectedTab == 0)

            LibraryView()
                .opacity(selectedTab == 1 ? 1 : 0)
                .allowsHitTesting(selectedTab == 1)

            SearchView()
                .opacity(selectedTab == 2 ? 1 : 0)
                .allowsHitTesting(selectedTab == 2)

            SettingsView()
                .opacity(selectedTab == 3 ? 1 : 0)
                .allowsHitTesting(selectedTab == 3)

            // Tab bar
            KindredTabBar(selectedTab: $selectedTab)
        }
        .ignoresSafeArea(.keyboard)
    }
}

#Preview {
    ContentView()
}
