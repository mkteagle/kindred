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
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-test-home") {
            DemoDataProvider.shared.isActive = true
            return
        }
        #endif
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
                .preferredColorScheme(.dark)
                .tint(KindredTheme.accent)
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
        // Dark first, everywhere. The redesign has no light theme on mobile,
        // so the whole UIKit layer is pinned rather than following the system.
        let ground = UIColor(KindredTheme.bg)

        let tabAppearance = UITabBarAppearance()
        tabAppearance.configureWithOpaqueBackground()
        tabAppearance.backgroundColor = ground
        UITabBar.appearance().standardAppearance = tabAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabAppearance
        // The system tab bar is replaced by KindredTabBar (frosted, capsule pill).
        UITabBar.appearance().isHidden = true

        // Transparent nav bars so the large title collapses over the content,
        // per the platform stance in IOS.md.
        let navAppearance = UINavigationBarAppearance()
        navAppearance.configureWithTransparentBackground()
        navAppearance.backgroundColor = .clear
        navAppearance.shadowColor = .clear
        if let large = UIFont(name: "SpaceGrotesk-Bold", size: 30) {
            navAppearance.largeTitleTextAttributes = [
                .font: large,
                .foregroundColor: UIColor(KindredTheme.ink),
                .kern: -0.3,
            ]
        }
        if let inline = UIFont(name: "SpaceGrotesk-SemiBold", size: 17) {
            navAppearance.titleTextAttributes = [
                .font: inline,
                .foregroundColor: UIColor(KindredTheme.ink),
            ]
        }

        let scrolled = navAppearance.copy() as! UINavigationBarAppearance
        scrolled.configureWithDefaultBackground()
        scrolled.backgroundColor = UIColor(KindredTheme.chrome)
        scrolled.shadowColor = UIColor(KindredTheme.hairline)

        UINavigationBar.appearance().scrollEdgeAppearance = navAppearance
        UINavigationBar.appearance().standardAppearance = scrolled
        UINavigationBar.appearance().compactAppearance = scrolled
        UINavigationBar.appearance().tintColor = UIColor(KindredTheme.accent)

        UITableView.appearance().backgroundColor = ground
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
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-test-home") {
            ContentView()
        } else {
            sessionContent
        }
        #else
        sessionContent
        #endif
    }

    @ViewBuilder
    private var sessionContent: some View {
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
