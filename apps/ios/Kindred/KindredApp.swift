import SwiftUI
import UIKit

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        if identifier == BackgroundUploadSession.sessionIdentifier {
            BackgroundUploadSession.shared.backgroundCompletionHandler = completionHandler
        } else {
            completionHandler()
        }
    }
}

@main
struct KindredApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    init() {
        configureAppearance()
        Analytics.configure()
        SyncManager.shared.configure()
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
        let warmBg = UIColor(KindredTheme.paper)

        let tabAppearance = UITabBarAppearance()
        tabAppearance.configureWithOpaqueBackground()
        tabAppearance.backgroundColor = warmBg
        UITabBar.appearance().standardAppearance = tabAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabAppearance
        // Hide system tab bar — we use our own KindredTabBar
        UITabBar.appearance().isHidden = true

        let navAppearance = UINavigationBarAppearance()
        navAppearance.configureWithOpaqueBackground()
        navAppearance.backgroundColor = warmBg
        navAppearance.shadowColor = .clear
        // Use Space Grotesk for nav titles
        if let boldDesc = UIFontDescriptor(name: "SpaceGrotesk-Bold", size: 34).withSymbolicTraits(.traitBold) {
            navAppearance.largeTitleTextAttributes = [
                .font: UIFont(descriptor: boldDesc, size: 34),
                .foregroundColor: UIColor(KindredTheme.ash),
            ]
        }
        if let titleDesc = UIFontDescriptor(name: "SpaceGrotesk-Bold", size: 17).withSymbolicTraits(.traitBold) {
            navAppearance.titleTextAttributes = [
                .font: UIFont(descriptor: titleDesc, size: 17),
                .foregroundColor: UIColor(KindredTheme.ash),
            ]
        }
        UINavigationBar.appearance().standardAppearance = navAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navAppearance
        UINavigationBar.appearance().compactAppearance = navAppearance
        UINavigationBar.appearance().tintColor = UIColor(KindredTheme.ember)

        UITableView.appearance().backgroundColor = warmBg
    }
}

struct RootView: View {
    @State private var session = SessionManager.shared
    @State private var hasSeenOnboarding = UserDefaults.standard.bool(forKey: "hasSeenOnboarding")

    var body: some View {
        if session.isAuthenticated {
            ContentView()
                .task {
                    // If a stale demo token survived an app restart, clear it
                    if session.sessionToken == "demo" && !DemoDataProvider.shared.isActive {
                        session.logout()
                        return
                    }
                    // Skip network refresh in demo mode
                    guard !DemoDataProvider.shared.isActive else { return }
                    await session.refreshUser()
                }
        } else if !hasSeenOnboarding {
            OnboardingView {
                hasSeenOnboarding = true
                UserDefaults.standard.set(true, forKey: "hasSeenOnboarding")
            }
        } else {
            LoginView()
        }
    }
}
