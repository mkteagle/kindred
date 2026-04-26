import XCTest

/// UI tests that capture App Store screenshots using demo mode.
/// No network calls, no credentials needed — uses bundled demo data.
///
/// Run with:
///   xcodebuild test \
///     -project Kindred.xcodeproj \
///     -scheme KindredScreenshots \
///     -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' \
///     -resultBundlePath TestResults.xcresult
final class KindredScreenshots: XCTestCase {

    private var app: XCUIApplication!
    private let outputDir = "/tmp/kindred_screenshots"

    override func setUp() {
        super.setUp()
        continueAfterFailure = true
        app = XCUIApplication()
        app.launch()
    }

    override func tearDown() {
        app = nil
        super.tearDown()
    }

    // MARK: - Main Test

    func testCaptureAllScreenshots() {
        // Step 1: Handle onboarding if shown
        let onboardingText = app.staticTexts["A calmer home for\nfamily photos."]
        if onboardingText.waitForExistence(timeout: 3) {
            takeScreenshot(named: "10_onboarding")
            // Tap through to get started
            let getStarted = app.buttons["Get started"]
            if getStarted.exists { getStarted.tap() }
            let continueBtn = app.buttons["Continue"]
            // Tap Continue through all pages
            for _ in 0..<3 {
                if continueBtn.waitForExistence(timeout: 1) { continueBtn.tap() }
            }
            if getStarted.waitForExistence(timeout: 1) { getStarted.tap() }
        }

        // Step 2: Tap "Try the demo" on login screen
        let demoButton = app.buttons["Try the demo"]
        if demoButton.waitForExistence(timeout: 5) {
            demoButton.tap()
            sleep(2) // Let demo mode activate and Home load
        }

        // Step 3: Verify we're on Home (look for "Kindred" text)
        let kindredText = app.staticTexts["Kindred"]
        guard kindredText.waitForExistence(timeout: 5) else {
            XCTFail("Could not enter demo mode — Home screen not found")
            return
        }

        // === CAPTURE ALL SCREENS ===

        // 01 — Home Feed
        sleep(1)
        takeScreenshot(named: "01_home_feed")

        // 02 — Library (People)
        tapTab("Library")
        sleep(2)
        takeScreenshot(named: "02_library_people")

        // 03 — Library (Pets)
        let petsChip = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Pets'")).firstMatch
        if petsChip.waitForExistence(timeout: 3) {
            petsChip.tap()
            sleep(1)
        }
        takeScreenshot(named: "03_library_pets")

        // Switch back to People for later
        let peopleChip = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'People'")).firstMatch
        if peopleChip.waitForExistence(timeout: 2) { peopleChip.tap() }

        // 04 — Search
        tapTab("Search")
        sleep(1)
        takeScreenshot(named: "04_search")

        // 05 — Search with results
        let searchField = app.textFields.firstMatch
        if searchField.waitForExistence(timeout: 3) {
            searchField.tap()
            searchField.typeText("beach")
            sleep(2)
        }
        takeScreenshot(named: "05_search_results")

        // Clear search and go back
        let clearButton = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'xmark'")).firstMatch
        if clearButton.exists { clearButton.tap() }

        // 06 — Tap a person card to see photo detail
        tapTab("Library")
        sleep(1)
        let firstCard = app.buttons.firstMatch
        if firstCard.waitForExistence(timeout: 3) {
            firstCard.tap()
            sleep(2)
            takeScreenshot(named: "06_person_detail")

            // Go back
            let backButton = app.navigationBars.buttons.firstMatch
            if backButton.exists { backButton.tap() }
            sleep(1)
        }

        // 07 — Settings
        tapTab("Settings")
        sleep(1)
        takeScreenshot(named: "07_settings")

        // 08 — Scroll down on settings
        app.swipeUp()
        sleep(1)
        takeScreenshot(named: "08_settings_more")

        // Cleanup — sign out of demo mode so seed data is removed
        tapTab("Settings")
        sleep(1)
        // Look for the demo banner "Sign out" or the Sign Out button
        let signOutBanner = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Sign out'")).firstMatch
        if signOutBanner.waitForExistence(timeout: 2) {
            signOutBanner.tap()
            sleep(1)
        }
        // Confirm sign out if alert appears
        let confirmSignOut = app.alerts.buttons["Sign Out"]
        if confirmSignOut.waitForExistence(timeout: 2) {
            confirmSignOut.tap()
        }
        sleep(1)
    }

    // MARK: - Helpers

    private func tapTab(_ label: String) {
        let tab = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        if tab.waitForExistence(timeout: 3) {
            tab.tap()
        }
    }

    private func takeScreenshot(named name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
