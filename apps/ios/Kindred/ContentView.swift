import SwiftUI

struct ContentView: View {
    @State private var selectedTab = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            // Content area — fills entire screen
            Group {
                switch selectedTab {
                case 0: HomeView()
                case 1: LibraryView()
                case 2: SearchView()
                case 3: SettingsView()
                default: HomeView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            // Glassmorphic tab bar overlays the bottom, extends into safe area
            KindredTabBar(selectedTab: $selectedTab)
        }
        .ignoresSafeArea(.keyboard)
    }
}

#Preview {
    ContentView()
}
