import SwiftUI

@main
struct KindredApp: App {
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
