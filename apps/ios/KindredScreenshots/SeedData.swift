import Foundation

/// Configuration for screenshot tests.
/// Uses the bundled offline demo mode — no credentials or server needed.
/// After tests complete, the demo session is signed out and seed data cleared.
enum SeedData {
    /// Search query to use when capturing search results screenshot
    static let searchQuery = "beach"
}
