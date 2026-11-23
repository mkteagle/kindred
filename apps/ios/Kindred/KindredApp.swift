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
        let cache = URLCache.shared
        if cache.currentDiskUsage > 0 { cache.removeAllCachedResponses() }
        cache.diskCapacity = 0
        configureAppearance()
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-test-home") {
            DemoDataProvider.shared.isActive = true
            return
        }
        #endif
        SyncManager.shared.configure()
        Task {
            await FlickrUploader.shared.cleanupAbandonedStagingFiles()
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(KindredTheme.accent)
                .onOpenURL { url in
                    guard url.scheme?.lowercased() == "kindred" else { return }
                    Task { @MainActor in
                        _ = PairingCoordinator.shared.handle(url: url)
                    }
                }
        }
    }

    private func configureAppearance() {
        // UIKit chrome uses the same adaptive palette as the SwiftUI views.
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
        if let large = UIFont(name: "InstrumentSans-Bold", size: 30) {
            navAppearance.largeTitleTextAttributes = [
                .font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: large),
                .foregroundColor: UIColor(KindredTheme.ink),
            ]
        }
        if let inline = UIFont(name: "InstrumentSans-SemiBold", size: 17) {
            navAppearance.titleTextAttributes = [
                .font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: inline),
                .foregroundColor: UIColor(KindredTheme.ink),
            ]
        }

        let scrolled = navAppearance.copy()
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
    @Environment(\.scenePhase) private var scenePhase

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
                .id(session.currentUser?.id)
                .onChange(of: scenePhase, initial: true) { _, phase in
                    if phase == .active {
                        ReviewPhotoStore.shared.refresh()
                        SyncManager.shared.resumeBackupInForeground()
                    }
                }
                .task {
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
