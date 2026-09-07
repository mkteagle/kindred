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
            // A paired device must talk to its own household's server, so this
            // has to happen before anything else makes a request.
            await PairingService.restoreServerURL()
            let server = await APIClient.shared.currentBaseURL()
            await OAuthHelper.loadConfig(from: server)
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .onOpenURL { url in
                    guard url.scheme?.lowercased() == "kindred" else { return }
                    Task { @MainActor in
                        // Pairing and the Flickr OAuth callback share the
                        // scheme, so dispatch on the host rather than handing
                        // every kindred:// URL to Flickr.
                        if PairingCoordinator.shared.handle(url: url) { return }
                        FlickrAuth.shared.handleCallback(url: url)
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
    @State private var pairing = PairingCoordinator.shared
    @State private var hasSeenOnboarding = UserDefaults.standard.bool(forKey: "hasSeenOnboarding")

    var body: some View {
        content
            // A pairing link can arrive signed in, signed out or mid-onboarding,
            // so the sheet hangs off the root rather than any one screen.
            .sheet(isPresented: $pairing.isPresenting) {
                PairDeviceView(initialPairing: pairing.pending)
                    .onDisappear { pairing.pending = nil }
            }
    }

    @ViewBuilder
    private var content: some View {
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
