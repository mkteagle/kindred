import XCTest

/// UI tests that capture App Store screenshots using demo mode.
/// No network calls, no credentials needed — uses bundled demo data.
final class KindredScreenshots: XCTestCase {

    private var app: XCUIApplication!

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

    func testCaptureAllScreenshots() {
        // Handle onboarding if shown
        let getStarted = app.buttons["Get started"]
        let continueBtn = app.buttons["Continue"]
        if getStarted.waitForExistence(timeout: 3) || continueBtn.waitForExistence(timeout: 1) {
            takeScreenshot(named: "10_onboarding")
            for _ in 0..<5 {
                if getStarted.exists { getStarted.tap(); sleep(1) }
                if continueBtn.exists { continueBtn.tap(); sleep(1) }
            }
        }

        // Tap "Try the demo"
        let demoButton = app.buttons["Try the demo"]
        if demoButton.waitForExistence(timeout: 5) {
            demoButton.tap()
            sleep(2)
        }

        // Verify Home loaded
        guard app.staticTexts["Kindred"].waitForExistence(timeout: 5) else {
            XCTFail("Could not enter demo mode")
            return
        }

        // 01 — Home
        sleep(1)
        takeScreenshot(named: "01_home_feed")

        // 02 — Library People
        tapTab("Library")
        sleep(2)
        takeScreenshot(named: "02_library_people")

        // 03 — Library Pets
        let petsChip = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Pets'")).firstMatch
        if petsChip.waitForExistence(timeout: 3) {
            petsChip.tap()
            sleep(1)
        }
        takeScreenshot(named: "03_library_pets")

        // 04 — Search
        tapTab("Search")
        sleep(1)
        takeScreenshot(named: "04_search")

        // 05 — Search results
        let searchField = app.textFields.firstMatch
        if searchField.waitForExistence(timeout: 3) {
            searchField.tap()
            searchField.typeText("beach")
            sleep(2)
        }
        takeScreenshot(named: "05_search_results")

        // 06 — Settings
        tapTab("Settings")
        sleep(1)
        takeScreenshot(named: "06_settings")

        // 07 — Scroll settings
        app.swipeUp()
        sleep(1)
        takeScreenshot(named: "07_settings_more")

        // Cleanup — scroll to Sign Out and exit demo (best effort, don't fail test)
        app.swipeUp()
        app.swipeUp()
        sleep(1)
        let signOutBtn = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Sign Out'")).firstMatch
        if signOutBtn.exists && signOutBtn.isHittable {
            signOutBtn.tap()
            sleep(1)
        }
    }

    private func tapTab(_ label: String) {
        let tab = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        if tab.waitForExistence(timeout: 3) {
            tab.tap()
        }
    }

    private func takeScreenshot(named name: String) {
        let screenshot = XCUIScreen.main.screenshot()

        // Save to attachment (for Xcode)
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)

        // Also save directly to /tmp for easy access
        let data = screenshot.pngRepresentation
        let path = "/tmp/kindred_screenshots/\(name).png"
        try? FileManager.default.createDirectory(atPath: "/tmp/kindred_screenshots", withIntermediateDirectories: true)
        try? data.write(to: URL(fileURLWithPath: path))
    }
}
