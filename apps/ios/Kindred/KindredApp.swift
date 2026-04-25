import SwiftUI

@main
struct KindredApp: App {
    init() {
        configureAppearance()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .onOpenURL { url in
                    // Handle kindred://oauth-callback?oauth_token=...&oauth_verifier=...
                    if url.scheme == "kindred" {
                        Task { @MainActor in
                            FlickrAuth.shared.handleCallback(url: url)
                        }
                    }
                }
        }
    }

    private func configureAppearance() {
        let warmBg = UIColor(KindredTheme.warmBackground)

        // Tab bar — warm background, no translucency
        let tabAppearance = UITabBarAppearance()
        tabAppearance.configureWithOpaqueBackground()
        tabAppearance.backgroundColor = warmBg
        UITabBar.appearance().standardAppearance = tabAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabAppearance

        // Navigation bar — warm background, rounded title font
        let navAppearance = UINavigationBarAppearance()
        navAppearance.configureWithOpaqueBackground()
        navAppearance.backgroundColor = warmBg
        if let roundedDesc = UIFontDescriptor.preferredFontDescriptor(withTextStyle: .largeTitle)
            .withDesign(.rounded) {
            navAppearance.largeTitleTextAttributes = [
                .font: UIFont(descriptor: roundedDesc.withSymbolicTraits(.traitBold) ?? roundedDesc, size: 0)
            ]
        }
        if let roundedInline = UIFontDescriptor.preferredFontDescriptor(withTextStyle: .headline)
            .withDesign(.rounded) {
            navAppearance.titleTextAttributes = [
                .font: UIFont(descriptor: roundedInline.withSymbolicTraits(.traitBold) ?? roundedInline, size: 0)
            ]
        }
        UINavigationBar.appearance().standardAppearance = navAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navAppearance
        UINavigationBar.appearance().compactAppearance = navAppearance

        // Table/list background
        UITableView.appearance().backgroundColor = warmBg
    }
}

struct RootView: View {
    @State private var flickrAuth = FlickrAuth.shared

    var body: some View {
        if flickrAuth.isAuthenticated {
            ContentView()
        } else {
            LoginView()
        }
    }
}
