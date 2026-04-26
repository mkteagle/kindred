import Foundation
#if canImport(PostHog)
import PostHog
#endif

/// Lightweight wrapper around PostHog for event tracking.
/// Uses `canImport` so the app compiles even if PostHog SPM
/// hasn't resolved yet in the CLI build environment.
enum Analytics {
    static func configure() {
        #if canImport(PostHog)
        let config = PostHogConfig(apiKey: "phc_4pP9W6HkYyajqLR49iA6UoYkDz17l0eAAdhpONFAUwx")
        config.host = "https://us.i.posthog.com"
        config.captureScreenViews = true
        config.captureApplicationLifecycleEvents = true
        PostHogSDK.shared.setup(config)
        #endif
    }

    static func identify(userId: String, properties: [String: Any] = [:]) {
        #if canImport(PostHog)
        PostHogSDK.shared.identify(userId, userProperties: properties)
        #endif
    }

    static func capture(_ event: String, properties: [String: Any] = [:]) {
        #if canImport(PostHog)
        PostHogSDK.shared.capture(event, properties: properties)
        #endif
    }

    static func screen(_ name: String, properties: [String: Any] = [:]) {
        #if canImport(PostHog)
        PostHogSDK.shared.screen(name, properties: properties)
        #endif
    }

    static func reset() {
        #if canImport(PostHog)
        PostHogSDK.shared.reset()
        #endif
    }
}
