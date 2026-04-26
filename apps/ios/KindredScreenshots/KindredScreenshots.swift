import XCTest

/// UI tests that capture App Store screenshots for every key screen.
///
/// Run with:
///   xcodebuild test \
///     -project Kindred.xcodeproj \
///     -scheme KindredScreenshots \
///     -destination 'platform=iOS Simulator,name=iPhone 15 Pro Max' \
///     -resultBundlePath TestResults.xcresult
///
/// Screenshots are saved as XCUIScreenshotAttachment objects inside the
/// test result bundle. Extract them with `xcparse` or the runner script.
final class KindredScreenshots: XCTestCase {

    private var app: XCUIApplication!

    // MARK: - Lifecycle

    override func setUp() {
        super.setUp()
        continueAfterFailure = true

        app = XCUIApplication()

        // Pass environment flags so the app can opt into demo / screenshot mode
        app.launchEnvironment["KINDRED_SCREENSHOT_MODE"] = "1"
        app.launchEnvironment["KINDRED_API_BASE"] = SeedData.apiBaseURL

        // Pre-seed credentials if needed
        if let email = SeedData.demoEmail, let password = SeedData.demoPassword {
            app.launchEnvironment["KINDRED_DEMO_EMAIL"] = email
            app.launchEnvironment["KINDRED_DEMO_PASSWORD"] = password
        }

        app.launch()

        // Allow time for initial data load and auth
        waitForAppReady()
    }

    override func tearDown() {
        app = nil
        super.tearDown()
    }

    // MARK: - Screenshot Capture Test

    func testCaptureAllScreenshots() {
        // If we land on onboarding, handle it first and capture last
        let hasOnboarding = app.staticTexts["Welcome to Kindred"].waitForExistence(timeout: 3)
        if hasOnboarding {
            captureOnboardingScreenshot()
            dismissOnboarding()
            waitForAppReady()
        }

        // Ensure we're on the main content (Home tab)
        ensureAuthenticated()

        // 1. Home Feed
        captureHomeFeed()

        // 2. Library - People tab
        captureLibraryPeople()

        // 3. Library - Pets tab
        captureLibraryPets()

        // 4. Search (empty state)
        captureSearchEmpty()

        // 5. Search results
        captureSearchResults()

        // 6. Photo detail
        capturePhotoDetail()

        // 7. Together picker
        captureTogetherPicker()

        // 8. Settings
        captureSettings()

        // 9. Notifications inbox
        captureNotificationsInbox()

        // 10. Onboarding (if we haven't already)
        if !hasOnboarding {
            captureOnboardingViaReset()
        }
    }

    // MARK: - Individual Screen Captures

    private func captureHomeFeed() {
        tapTab("Home")
        sleep(2) // Let photo grid and carousels load
        takeScreenshot(named: "01_home_feed")
    }

    private func captureLibraryPeople() {
        tapTab("Library")
        sleep(2) // Let clusters load

        // Ensure People chip is selected (it's the default)
        let peopleChip = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'People'")).firstMatch
        if peopleChip.waitForExistence(timeout: 3) {
            peopleChip.tap()
            sleep(1)
        }

        takeScreenshot(named: "02_library_people")
    }

    private func captureLibraryPets() {
        // Already on Library tab
        let petsChip = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Pets'")).firstMatch
        if petsChip.waitForExistence(timeout: 3) {
            petsChip.tap()
            sleep(1)
        }

        takeScreenshot(named: "03_library_pets")
    }

    private func captureSearchEmpty() {
        tapTab("Search")
        sleep(1)
        takeScreenshot(named: "04_search_browse")
    }

    private func captureSearchResults() {
        // Tap the search field and type a query
        let searchField = app.textFields.firstMatch
        if searchField.waitForExistence(timeout: 3) {
            searchField.tap()
            searchField.typeText(SeedData.searchQuery)
            sleep(2) // Wait for results
        }
        takeScreenshot(named: "05_search_results")

        // Clear the search
        if let clearButton = findClearButton() {
            clearButton.tap()
        } else {
            // Dismiss keyboard and clear manually
            searchField.clearText()
        }
    }

    private func capturePhotoDetail() {
        // Navigate to Home and tap a photo
        tapTab("Home")
        sleep(1)

        // Try to find and tap any image/button in the photo grid
        let photos = app.images.allElementsBoundByIndex
        if photos.count > 2 {
            photos[2].tap() // Tap the third photo (skip header elements)
            sleep(1)
            takeScreenshot(named: "06_photo_detail")
            // Dismiss the detail view
            dismissSheet()
        } else {
            // Fallback: capture whatever is showing
            takeScreenshot(named: "06_photo_detail")
        }
    }

    private func captureTogetherPicker() {
        tapTab("Home")
        sleep(1)

        // Find and tap the "Together" link/button on the home screen
        let togetherButton = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'together' OR label CONTAINS[c] 'Together'")
        ).firstMatch

        if togetherButton.waitForExistence(timeout: 3) {
            togetherButton.tap()
            sleep(2) // Let people grid load
            takeScreenshot(named: "07_together_picker")
            // Dismiss
            dismissFullScreenCover()
        } else {
            // Fallback: try other ways to reach Together
            let togetherText = app.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] 'together'")
            ).firstMatch
            if togetherText.waitForExistence(timeout: 2) {
                togetherText.tap()
                sleep(2)
                takeScreenshot(named: "07_together_picker")
                dismissFullScreenCover()
            }
        }
    }

    private func captureSettings() {
        tapTab("Settings")
        sleep(1)
        takeScreenshot(named: "08_settings")
    }

    private func captureNotificationsInbox() {
        tapTab("Home")
        sleep(1)

        // Tap the bell icon in the app bar
        let bellButton = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'notification' OR label CONTAINS[c] 'bell' OR label CONTAINS[c] 'inbox'")
        ).firstMatch

        if bellButton.waitForExistence(timeout: 3) {
            bellButton.tap()
            sleep(1)
            takeScreenshot(named: "09_notifications_inbox")
            dismissSheet()
        } else {
            // Try finding by SF Symbol name
            let bellImage = app.buttons["bell"].firstMatch
            if bellImage.waitForExistence(timeout: 2) {
                bellImage.tap()
                sleep(1)
                takeScreenshot(named: "09_notifications_inbox")
                dismissSheet()
            }
        }
    }

    private func captureOnboardingScreenshot() {
        sleep(1)
        takeScreenshot(named: "10_onboarding")
    }

    private func captureOnboardingViaReset() {
        // If we need to capture onboarding but the app already passed it,
        // we can relaunch with the flag cleared
        app.terminate()

        let freshApp = XCUIApplication()
        freshApp.launchEnvironment["KINDRED_SCREENSHOT_MODE"] = "1"
        freshApp.launchEnvironment["KINDRED_SHOW_ONBOARDING"] = "1"
        freshApp.launch()

        let welcomeText = freshApp.staticTexts["Welcome to Kindred"]
        if welcomeText.waitForExistence(timeout: 5) {
            sleep(1)
            takeNamedScreenshot(named: "10_onboarding", app: freshApp)
        }

        freshApp.terminate()

        // Relaunch the main app for any remaining work
        app.launch()
    }

    // MARK: - Helpers

    private func waitForAppReady() {
        // Wait for the main UI to appear (either onboarding, login, or home)
        let homeTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Home'")).firstMatch
        let loginView = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Sign In'")).firstMatch
        let onboarding = app.staticTexts["Welcome to Kindred"]

        let startTime = Date()
        while Date().timeIntervalSince(startTime) < 10 {
            if homeTab.exists || loginView.exists || onboarding.exists {
                return
            }
            sleep(1)
        }
    }

    private func ensureAuthenticated() {
        let signInButton = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'Sign In' OR label CONTAINS[c] 'Log In'")
        ).firstMatch

        if signInButton.waitForExistence(timeout: 2) {
            // Auto-login using demo credentials if available
            if let email = SeedData.demoEmail, let password = SeedData.demoPassword {
                let emailField = app.textFields.matching(
                    NSPredicate(format: "placeholderValue CONTAINS[c] 'email'")
                ).firstMatch
                let passwordField = app.secureTextFields.firstMatch

                if emailField.waitForExistence(timeout: 3) {
                    emailField.tap()
                    emailField.typeText(email)
                }
                if passwordField.waitForExistence(timeout: 3) {
                    passwordField.tap()
                    passwordField.typeText(password)
                }
                signInButton.tap()
                sleep(3) // Wait for auth
            }
        }
    }

    private func tapTab(_ label: String) {
        let tab = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        if tab.waitForExistence(timeout: 3) {
            tab.tap()
            sleep(1) // Allow transition
        }
    }

    private func takeScreenshot(named name: String) {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func takeNamedScreenshot(named name: String, app: XCUIApplication) {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func dismissSheet() {
        // Swipe down to dismiss presented sheet
        let window = app.windows.firstMatch
        let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15))
        let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
        start.press(forDuration: 0.1, thenDragTo: end)
        sleep(1)
    }

    private func dismissFullScreenCover() {
        // Try close button first
        let closeButton = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'close' OR label CONTAINS[c] 'dismiss' OR label CONTAINS[c] 'xmark'")
        ).firstMatch
        if closeButton.waitForExistence(timeout: 2) {
            closeButton.tap()
            sleep(1)
            return
        }

        // Try navigation back button
        let backButton = app.navigationBars.buttons.firstMatch
        if backButton.waitForExistence(timeout: 2) {
            backButton.tap()
            sleep(1)
            return
        }

        // Fallback: swipe down
        dismissSheet()
    }

    private func findClearButton() -> XCUIElement? {
        let clear = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'clear' OR label CONTAINS[c] 'Clear'")
        ).firstMatch
        return clear.exists ? clear : nil
    }

    private func dismissOnboarding() {
        // Swipe through onboarding pages or tap "Get Started"
        for _ in 0..<5 {
            let getStarted = app.buttons.matching(
                NSPredicate(format: "label CONTAINS[c] 'Get Started' OR label CONTAINS[c] 'Continue' OR label CONTAINS[c] 'Sign In'")
            ).firstMatch
            if getStarted.waitForExistence(timeout: 1) {
                getStarted.tap()
                sleep(1)
                return
            }
            // Swipe left to next page
            app.swipeLeft()
            sleep(1)
        }
    }
}

// MARK: - XCUIElement Helpers

extension XCUIElement {
    func clearText() {
        guard let stringValue = self.value as? String, !stringValue.isEmpty else { return }
        self.tap()
        let deleteString = String(repeating: XCUIKeyboardKey.delete.rawValue, count: stringValue.count)
        self.typeText(deleteString)
    }
}
