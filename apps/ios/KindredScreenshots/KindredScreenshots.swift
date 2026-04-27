import XCTest

/// UI tests that capture App Store screenshots using demo mode.
/// Generates 10 screenshots covering all major features.
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
        // ── 10. Onboarding ──────────────────────────────────
        let getStarted = app.buttons["Get started"]
        let continueBtn = app.buttons["Continue"]
        if getStarted.waitForExistence(timeout: 3) || continueBtn.waitForExistence(timeout: 1) {
            takeScreenshot(named: "10_onboarding")
            for _ in 0..<5 {
                if getStarted.exists { getStarted.tap(); sleep(1) }
                if continueBtn.exists { continueBtn.tap(); sleep(1) }
            }
        }

        // ── 9. Login screen ────────────────────────────────
        let demoButton = app.buttons["Try the demo"]
        if demoButton.waitForExistence(timeout: 5) {
            takeScreenshot(named: "09_login")
            demoButton.tap()
            sleep(2)
        }

        guard app.staticTexts["Kindred"].waitForExistence(timeout: 5) else {
            XCTFail("Could not enter demo mode")
            return
        }

        // ── 1. Home Feed ───────────────────────────────────
        sleep(1)
        takeScreenshot(named: "01_home_feed")

        // ── 7. Together Picker ─────────────────────────────
        // Tap the Together card on the home screen
        let togetherButton = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'Together'")
        ).firstMatch
        if togetherButton.waitForExistence(timeout: 3) {
            togetherButton.tap()
            sleep(2)
            takeScreenshot(named: "07_together_picker")
            // Dismiss Together (tap the back/chevron button)
            let backButton = app.navigationBars.buttons.firstMatch
            if backButton.waitForExistence(timeout: 2) {
                backButton.tap()
                sleep(1)
            }
        }

        // ── 2. Library — People ────────────────────────────
        tapTab("Library")
        sleep(2)
        takeScreenshot(named: "02_library_people")

        // ── 3. Person Detail (Mom) ─────────────────────────
        // Try tapping the Mom card by its label text
        let momLabel = app.staticTexts["Mom"]
        if momLabel.waitForExistence(timeout: 3) && momLabel.isHittable {
            momLabel.tap()
            sleep(2)
            takeScreenshot(named: "03_person_detail")
            // Go back to library
            let backBtn = app.navigationBars.buttons.firstMatch
            if backBtn.waitForExistence(timeout: 2) {
                backBtn.tap()
                sleep(1)
            }
        } else {
            // Fallback: tap the first card in the grid
            let firstCard = app.buttons.matching(
                NSPredicate(format: "label CONTAINS[c] 'Mom'")
            ).firstMatch
            if firstCard.waitForExistence(timeout: 2) {
                firstCard.tap()
                sleep(2)
                takeScreenshot(named: "03_person_detail")
                app.navigationBars.buttons.firstMatch.tap()
                sleep(1)
            }
        }

        // ── 4. Library — Pets ──────────────────────────────
        let petsChip = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'Pets'")
        ).firstMatch
        if petsChip.waitForExistence(timeout: 3) {
            petsChip.tap()
            sleep(1)
        }
        takeScreenshot(named: "04_library_pets")

        // ── 5. Library — Vehicles ──────────────────────────
        let vehiclesChip = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'Vehicles'")
        ).firstMatch
        if vehiclesChip.waitForExistence(timeout: 3) {
            vehiclesChip.tap()
            sleep(1)
        }
        takeScreenshot(named: "05_library_vehicles")

        // ── 6. Search Results ──────────────────────────────
        tapTab("Search")
        sleep(1)
        let searchField = app.textFields.firstMatch
        if searchField.waitForExistence(timeout: 3) {
            searchField.tap()
            searchField.typeText("campfire")
            sleep(2)
            // Dismiss keyboard so results are fully visible
            if app.keyboards.count > 0 {
                app.typeText("\n")
                sleep(1)
            }
        }
        takeScreenshot(named: "06_search_results")

        // ── 8. Settings ────────────────────────────────────
        // Swipe down to ensure keyboard is dismissed and tab bar is accessible
        app.swipeDown()
        sleep(1)
        tapTab("Settings")
        sleep(1)
        takeScreenshot(named: "08_settings")
    }

    private var isIPad: Bool {
        UIDevice.current.userInterfaceIdiom == .pad
    }

    private func tapTab(_ label: String) {
        // Try exact match first (works on iPhone tab bar)
        let tab = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
        if tab.waitForExistence(timeout: 2) && tab.isHittable {
            tab.tap()
            return
        }
        // On iPad, sidebar may be collapsed — try toggling it
        if isIPad {
            // Look for the sidebar toggle button (NavigationSplitView back/menu button)
            let toggles = app.navigationBars.buttons
            if toggles.count > 0 {
                // The first button in the nav bar is usually the sidebar toggle
                let toggle = toggles.firstMatch
                if toggle.exists && toggle.isHittable {
                    toggle.tap()
                    sleep(1)
                }
            }
            // Try finding the sidebar button with CONTAINS (label may include icon name)
            let sidebarBtn = app.buttons.matching(
                NSPredicate(format: "label CONTAINS[c] %@", label)
            ).firstMatch
            if sidebarBtn.waitForExistence(timeout: 3) && sidebarBtn.isHittable {
                sidebarBtn.tap()
                return
            }
            // Last resort: try static texts
            let text = app.staticTexts[label]
            if text.waitForExistence(timeout: 2) && text.isHittable {
                text.tap()
            }
        }
    }

    private func takeScreenshot(named name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        // Save to /tmp — use device-specific subfolder
        let isIPad = UIDevice.current.userInterfaceIdiom == .pad
        let folder = isIPad ? "/tmp/kindred_screenshots_ipad" : "/tmp/kindred_screenshots"
        let data = screenshot.pngRepresentation
        let path = "\(folder)/\(name).png"
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        try? data.write(to: URL(fileURLWithPath: path))
    }
}
