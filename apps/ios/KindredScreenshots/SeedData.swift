import Foundation

/// Configuration for the screenshot test environment.
///
/// The screenshots connect to the real Kindred backend (api.kindredphotos.app)
/// which has real data. For CI or offline use, you can override these values
/// with environment variables.
///
/// ## Environment Variables
///
/// Set these in your Xcode scheme or CI environment:
///
/// | Variable                     | Description                              | Default                           |
/// |------------------------------|------------------------------------------|-----------------------------------|
/// | `KINDRED_API_BASE`           | Backend URL                              | `https://api.kindredphotos.app`   |
/// | `KINDRED_DEMO_EMAIL`         | Login email for screenshots              | *(none)*                          |
/// | `KINDRED_DEMO_PASSWORD`      | Login password for screenshots           | *(none)*                          |
/// | `KINDRED_SCREENSHOT_MODE`    | Enables screenshot-specific behaviors    | `1`                               |
/// | `KINDRED_SHOW_ONBOARDING`    | Forces onboarding screen to appear       | *(unset)*                         |
/// | `KINDRED_SEARCH_QUERY`       | Term used for search results screenshot  | `beach`                           |
///
/// ## Using with the Real Backend
///
/// The default configuration points at `api.kindredphotos.app`. To use it:
///
/// 1. Create a demo account on the Kindred instance.
/// 2. Set `KINDRED_DEMO_EMAIL` and `KINDRED_DEMO_PASSWORD` in the scheme
///    environment variables or in your CI secrets.
/// 3. Make sure the demo account has enough data: photos, people clusters,
///    pet clusters, etc.
///
/// ## Using Demo Mode
///
/// If you want to use entirely synthetic data, set the `KINDRED_SCREENSHOT_MODE`
/// environment variable to `1` in the app target. The app can check for this
/// variable via `ProcessInfo.processInfo.environment["KINDRED_SCREENSHOT_MODE"]`
/// and load bundled demo assets instead of making network calls.
///
/// To add demo mode support to the app:
///
/// ```swift
/// // In your app's SessionManager or APIClient:
/// var isScreenshotMode: Bool {
///     ProcessInfo.processInfo.environment["KINDRED_SCREENSHOT_MODE"] == "1"
/// }
/// ```
///
enum SeedData {

    /// Base URL for the Kindred API.
    static let apiBaseURL: String = {
        ProcessInfo.processInfo.environment["KINDRED_API_BASE"]
            ?? "https://api.kindredphotos.app"
    }()

    /// Demo account email (optional, set via environment variable).
    static let demoEmail: String? = {
        ProcessInfo.processInfo.environment["KINDRED_DEMO_EMAIL"]
    }()

    /// Demo account password (optional, set via environment variable).
    static let demoPassword: String? = {
        ProcessInfo.processInfo.environment["KINDRED_DEMO_PASSWORD"]
    }()

    /// Search query to use for the search results screenshot.
    static let searchQuery: String = {
        ProcessInfo.processInfo.environment["KINDRED_SEARCH_QUERY"]
            ?? "beach"
    }()

    /// Whether to force-show onboarding even if the user has seen it.
    static let forceOnboarding: Bool = {
        ProcessInfo.processInfo.environment["KINDRED_SHOW_ONBOARDING"] == "1"
    }()
}
