import SwiftUI

@main
struct KindredApp: App {
    init() {
        configureAppearance()
        Analytics.configure()
        SyncManager.shared.configure()
        // Load Flickr consumer credentials from backend
        Task {
            await OAuthHelper.loadConfig(from: "https://api.kindredphotos.app")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .onOpenURL { url in
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

        let tabAppearance = UITabBarAppearance()
        tabAppearance.configureWithOpaqueBackground()
        tabAppearance.backgroundColor = warmBg
        UITabBar.appearance().standardAppearance = tabAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabAppearance

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

        UITableView.appearance().backgroundColor = warmBg
    }
}

struct RootView: View {
    @State private var session = SessionManager.shared

    var body: some View {
        if session.isAuthenticated {
            ContentView()
        } else {
            LoginView()
        }
    }
}
