import Foundation
import PostHog

/// Lightweight wrapper around PostHog for event tracking.
enum Analytics {
    static func configure() {
        let config = PostHogConfig(apiKey: "phc_4pP9W6HkYyajqLR49iA6UoYkDz17l0eAAdhpONFAUwx")
        config.host = "https://us.i.posthog.com"
        config.captureScreenViews = true
        config.captureApplicationLifecycleEvents = true
        PostHogSDK.shared.setup(config)
    }

    static func identify(userId: String, properties: [String: Any] = [:]) {
        PostHogSDK.shared.identify(userId, userProperties: properties)
    }

    static func capture(_ event: String, properties: [String: Any] = [:]) {
        PostHogSDK.shared.capture(event, properties: properties)
    }

    static func screen(_ name: String, properties: [String: Any] = [:]) {
        PostHogSDK.shared.screen(name, properties: properties)
    }

    static func reset() {
        PostHogSDK.shared.reset()
    }
}
