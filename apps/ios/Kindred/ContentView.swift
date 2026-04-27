import SwiftUI

struct ContentView: View {
    @State private var selectedTab = 0
    @State private var demo = DemoDataProvider.shared
    @State private var sidebarVisibility: NavigationSplitViewVisibility = .doubleColumn
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        if horizontalSizeClass == .regular {
            iPadLayout
        } else {
            iPhoneLayout
        }
    }

    // MARK: - iPhone Layout (unchanged)

    private var iPhoneLayout: some View {
        ZStack(alignment: .bottom) {
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

            KindredTabBar(selectedTab: $selectedTab)
        }
        .ignoresSafeArea(.keyboard)
    }

    // MARK: - iPad Layout (sidebar + content)

    private var iPadLayout: some View {
        NavigationSplitView(columnVisibility: $sidebarVisibility) {
            iPadSidebar
                .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 300)
                .toolbar(.hidden, for: .navigationBar)
        } detail: {
            iPadDetailContent
        }
        .navigationSplitViewStyle(.balanced)
        .tint(KindredTheme.ember)
    }

    private var iPadSidebar: some View {
        VStack(spacing: 0) {
            // Sidebar header — brand logo (below safe area)
            Spacer().frame(height: 0) // absorbs safe area inset
            HStack(spacing: 8) {
                Image("KindredLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 28, height: 28)
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                Text("Kindred")
                    .font(.kindredTitle)
                    .foregroundStyle(KindredTheme.ash)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 20)

            // Nav items
            VStack(spacing: 4) {
                iPadSidebarItem(icon: "house", activeIcon: "house.fill", label: "Home", tab: 0)
                iPadSidebarItem(icon: "square.grid.2x2", activeIcon: "square.grid.2x2.fill", label: "Library", tab: 1)
                iPadSidebarItem(icon: "magnifyingglass", activeIcon: "magnifyingglass", label: "Search", tab: 2)
                iPadSidebarItem(icon: "slider.horizontal.3", activeIcon: "slider.horizontal.3", label: "Settings", tab: 3)
            }
            .padding(.horizontal, 12)

            Spacer()

            // Footer
            VStack(spacing: 4) {
                HStack(spacing: 6) {
                    Image(systemName: "flame")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(KindredTheme.ember)
                    Text("Kindling Signal")
                        .font(.kindredMicro)
                        .foregroundStyle(KindredTheme.muted)
                }
                Text("v1.0")
                    .font(.kindredMicro)
                    .foregroundStyle(KindredTheme.muted)
            }
            .padding(.bottom, 16)
        }
        .frame(maxHeight: .infinity)
        .background(KindredTheme.paper)
    }

    private func iPadSidebarItem(icon: String, activeIcon: String, label: String, tab: Int) -> some View {
        let isActive = selectedTab == tab
        return Button {
            withAnimation(.easeOut(duration: 0.16)) {
                selectedTab = tab
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: isActive ? activeIcon : icon)
                    .font(.system(size: 18, weight: isActive ? .semibold : .regular))
                    .frame(width: 24)
                Text(label)
                    .font(.body(15, weight: isActive ? .bold : .medium))
                Spacer()
            }
            .foregroundStyle(isActive ? KindredTheme.ember : KindredTheme.pine)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                isActive
                    ? KindredTheme.ember.opacity(0.12)
                    : Color.clear
            )
            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var iPadDetailContent: some View {
        switch selectedTab {
        case 0:
            HomeView(onNavigateToTab: { tab in
                withAnimation(.easeOut(duration: 0.16)) {
                    selectedTab = tab
                }
            })
        case 1:
            LibraryView()
        case 2:
            SearchView()
        case 3:
            SettingsView()
        default:
            HomeView()
        }
    }
}

#Preview {
    ContentView()
}
