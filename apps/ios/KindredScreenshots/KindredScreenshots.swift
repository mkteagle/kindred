import Network
import UIKit
import XCTest

/// UI tests that capture App Store screenshots using demo mode.
/// Generates 10 screenshots covering all major features.
final class KindredScreenshots: XCTestCase {

    private var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        continueAfterFailure = true
        app = XCUIApplication()
        if !name.contains("testLibraryRetriesThenLoadsAfterRelaunch") && !name.contains("testHomeShowsFavoritesBeforeSlowAlbums")
            && !name.contains("testSearchPaginatesCaptureMonth") && !name.contains("testSelectionExportsOriginals")
            && !name.contains("testAdminIndexingProgress") {
            app.launch()
        }
    }

    override func tearDown() {
        app = nil
        super.tearDown()
    }

    @MainActor func testFreshInstallRequiresHouseholdServer() {
        continueAfterFailure = false
        app.terminate()
        app.launchArguments = ["-kindred_server_url", " ", "-hasSeenOnboarding", "YES"]
        app.launch()

        let enterServer = app.buttons["Enter server address"]
        XCTAssertTrue(enterServer.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Scan a pairing code"].exists)
        XCTAssertTrue(app.buttons["Try the demo"].exists)
        XCTAssertFalse(app.buttons["Sign in"].exists)
        XCTAssertFalse(app.buttons["Continue with Google"].exists)

        enterServer.tap()
        let address = app.textFields["https://photos.example.com"]
        XCTAssertTrue(address.waitForExistence(timeout: 5))
        address.tap()
        address.typeText("http://photos.example.com")
        let next = app.buttons["Continue"]
        next.tap()
        XCTAssertTrue(app.staticTexts["Enter your Kindred server’s HTTPS address."].waitForExistence(timeout: 5))

        app.buttons["Cancel"].tap()
        enterServer.tap()
        XCTAssertTrue(address.waitForExistence(timeout: 5))
        address.tap()
        address.typeText("photos.example.com")
        next.tap()
        XCTAssertTrue(app.buttons["Sign in"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["login.serverAddress"].label, "https://photos.example.com")
        XCTAssertFalse(app.buttons["Continue with Google"].exists)
        XCTAssertFalse(app.buttons["Continue with Flickr"].exists)
    }

    @MainActor func testPairingLinkConfirmsServerBeforeClaiming() throws {
        continueAfterFailure = false
        let fixture = try LibraryFixture()
        let ready = expectation(description: "Pairing server is listening")
        fixture.start { ready.fulfill() }
        wait(for: [ready], timeout: 5)
        let address = "http://127.0.0.1:\(try XCTUnwrap(fixture.port))"

        app.terminate()
        app.launchArguments = ["-hasSeenOnboarding", "YES"]
        app.launch()
        var link = URLComponents()
        link.scheme = "kindred"
        link.host = "pair"
        link.queryItems = [URLQueryItem(name: "server", value: address), URLQueryItem(name: "code", value: "ABCD2345")]
        app.open(try XCTUnwrap(link.url))

        let confirm = app.buttons["Connect"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts[address].exists)
        XCTAssertEqual(fixture.pairingClaims, 0)
        confirm.tap()
        XCTAssertTrue(app.staticTexts["Paired"].waitForExistence(timeout: 8))
        XCTAssertEqual(fixture.pairingClaims, 1)
        app.buttons["Done"].tap()
        XCTAssertTrue(app.buttons["Library"].waitForExistence(timeout: 8))

        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["Library"].waitForExistence(timeout: 8))
        try signOutOfFixture()
    }

    func testRedesignedLibraryAndViewer() {
        continueAfterFailure = false
        app.terminate()
        app.launchArguments = ["--ui-test-home"]
        app.launch()
        let library = app.buttons["Library"]
        XCTAssertTrue(library.waitForExistence(timeout: 5))
        library.tap()
        let select = app.buttons["library.select"]
        XCTAssertTrue(select.waitForExistence(timeout: 5))
        takeScreenshot(named: "library-redesign")

        let photo = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Easter morning")).firstMatch
        XCTAssertTrue(photo.isHittable)
        photo.tap()
        XCTAssertTrue(app.buttons["Close photo"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Share"].exists)
        XCTAssertTrue(app.buttons["Info"].exists)
        XCTAssertTrue(app.scrollViews["viewer.filmstrip"].exists)
        takeScreenshot(named: "photo-viewer-redesign")
        app.buttons["Info"].tap()
        XCTAssertTrue(app.staticTexts["Easter morning"].waitForExistence(timeout: 5))
    }

    @MainActor func testAdminIndexingProgress() throws {
        continueAfterFailure = false
        let fixture = try LibraryFixture(isAdmin: true)
        try signIn(to: fixture)
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()

        let indexing = app.descendants(matching: .any)["settings.indexingProgress"].firstMatch
        XCTAssertTrue(indexing.waitForExistence(timeout: 5))
        indexing.tap()
        let thumbnails = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Thumbnails", "Running")).firstMatch
        XCTAssertTrue(thumbnails.waitForExistence(timeout: 8))
        takeScreenshot(named: "admin-indexing-progress")

        app.navigationBars.firstMatch.buttons.firstMatch.tap()
        try signOutOfFixture(settingsAlreadyShown: true)
    }

    @MainActor func testSelectionExportsOriginals() throws {
        continueAfterFailure = false
        let fixture = try LibraryFixture(exerciseExport: true)
        try signIn(to: fixture)
        XCTAssertTrue(app.buttons["Library"].waitForExistence(timeout: 8))
        app.terminate()
        app.launch()
        app.buttons["Library"].tap()

        let select = app.buttons["library.select"]
        XCTAssertTrue(select.waitForExistence(timeout: 5))
        let savedPhoto = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "First original")).firstMatch
        savedPhoto.tap()
        XCTAssertTrue(app.buttons["Remove favorite"].waitForExistence(timeout: 5))
        app.buttons["Close photo"].tap()
        select.tap()
        XCTAssertTrue(app.buttons["Review selection"].exists)
        XCTAssertFalse(app.buttons["Review selection"].isEnabled)
        app.buttons["Select all"].tap()
        XCTAssertTrue(app.staticTexts["3 selected"].exists)
        app.buttons["library.reviewSelection"].tap()
        XCTAssertTrue(app.navigationBars["3 selected"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Edit selection"].exists)
        XCTAssertTrue(app.staticTexts["November 16, 2025"].exists)
        XCTAssertTrue(app.staticTexts["November 9, 2025"].exists)
        takeScreenshot(named: "library-selected-media")
        app.buttons["library.downloadZIP"].tap()
        let downloads = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in fixture.originalsRequested.count == 3 }, object: nil)
        wait(for: [downloads], timeout: 8)
        XCTAssertEqual(fixture.originalsRequested, ["export-still-1", "export-still-2", "export-clip"])
        let shareTarget = app.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS[c] %@ OR label == %@", "Kindred Originals", "Save to Files"
        )).firstMatch
        let isSharing = shareTarget.waitForExistence(timeout: 8)
        takeScreenshot(named: "library-zip-share-sheet")
        XCTAssertTrue(isSharing)
    }

    func testCaptureIPadSearch() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad screenshot") }
        continueAfterFailure = false
        app.terminate()
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["--ui-test-home"]
        app.launch()
        defer { XCUIDevice.shared.orientation = .portrait }

        let search = app.buttons["Search"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 8))
        search.tap()
        let field = app.textFields["search.input"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("campfire\n")
        XCTAssertTrue(app.staticTexts["search.resultCount"].waitForExistence(timeout: 5))
        takeScreenshot(named: "search-ipad")
    }

    func testSearchRecentsAndResults() {
        continueAfterFailure = false
        app.terminate()
        app.launchArguments = ["--ui-test-home"]
        app.launch()
        app.buttons["Search"].tap()

        let field = app.textFields["search.input"]
        let clear = app.buttons["Clear search"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        for term in ["birthday", "dog", "campfire"] {
            field.tap()
            field.typeText(term + "\n")
            XCTAssertTrue(app.staticTexts["search.resultCount"].waitForExistence(timeout: 5))
            clear.tap()
        }

        let recent = app.buttons["campfire"]
        XCTAssertTrue(recent.waitForExistence(timeout: 5))
        takeScreenshot(named: "search-start")
        recent.tap()
        XCTAssertTrue(app.staticTexts["search.resultCount"].waitForExistence(timeout: 5))
        let tabsReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.buttons["Settings"].isHittable
        }, object: nil)
        wait(for: [tabsReady], timeout: 5)
        takeScreenshot(named: "search-results")

        clear.tap()
        app.buttons["All photos"].tap()
        XCTAssertTrue(app.staticTexts["search.resultCount"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Easter morning")).firstMatch.exists)
    }

    @MainActor func testSearchPaginatesCaptureMonth() throws {
        continueAfterFailure = false
        let fixture = try LibraryFixture(exerciseDateSearch: true)
        try signIn(to: fixture)
        XCTAssertTrue(app.buttons["Search"].waitForExistence(timeout: 8))
        app.terminate()
        app.launch()
        app.buttons["Search"].tap()

        let field = app.textFields["search.input"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("November 2025\n")
        let date = app.buttons["search.dateFilter"]
        XCTAssertTrue(date.waitForExistence(timeout: 5))
        XCTAssertEqual(date.label, "Remove date filter, November 2025")

        let still = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "November still")).firstMatch
        let video = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "November clip")).firstMatch
        let older = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Earlier November still")).firstMatch
        XCTAssertTrue(still.waitForExistence(timeout: 5))
        XCTAssertTrue(video.exists)
        XCTAssertTrue(older.waitForExistence(timeout: 5))
        XCTAssertTrue(fixture.requestedNovemberPageTwo)
        app.buttons["Videos"].tap()
        XCTAssertTrue(video.waitForExistence(timeout: 5))
        XCTAssertFalse(still.exists)
        XCTAssertTrue(fixture.requestedNovemberVideos)
        date.tap()
        XCTAssertTrue(app.staticTexts["Recent searches"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["November 2025"].exists)
        try signOutOfFixture()
    }

    func testHomeScrollsAndPreservesPositionAcrossTabs() {
        app.terminate()
        app.launchArguments = ["--ui-test-home"]
        app.launch()

        let home = app.buttons["Home"]
        XCTAssertTrue(home.waitForExistence(timeout: 5))
        home.tap()
        let scrollView = app.scrollViews["home.scrollView"]
        XCTAssertTrue(scrollView.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(scrollView.frame.maxY, home.frame.minY,
                                 "Home content must end above the bottom navigation")
        let heading = app.staticTexts["home.favoritesHeading"]
        XCTAssertTrue(heading.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Camping"].waitForExistence(timeout: 5))
        takeScreenshot(named: "home-favorites-and-albums")
        let originalY = heading.frame.minY
        let window = app.windows.firstMatch
        let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.78))
        let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        start.press(forDuration: 0.05, thenDragTo: end)
        let moved = NSPredicate { _, _ in heading.frame.minY < originalY - 5 }
        expectation(for: moved, evaluatedWith: nil)
        waitForExpectations(timeout: 3)
        let scrolledY = heading.frame.minY

        app.buttons["Settings"].tap()
        home.tap()
        XCTAssertEqual(heading.frame.minY, scrolledY, accuracy: 5)
        end.press(forDuration: 0.05, thenDragTo: start)
        let returned = NSPredicate { _, _ in heading.frame.minY > scrolledY + 5 }
        expectation(for: returned, evaluatedWith: nil)
        waitForExpectations(timeout: 3)

        app.buttons["See all favorites"].tap()
        let favoritesBar = app.navigationBars["Favorites"]
        XCTAssertTrue(favoritesBar.waitForExistence(timeout: 5))
        let photo = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Grandma's visit")).firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 5))
        photo.tap()
        XCTAssertTrue(app.buttons["Remove favorite"].waitForExistence(timeout: 5))
        app.buttons["Remove favorite"].tap()
        XCTAssertTrue(app.buttons["Favorite"].waitForExistence(timeout: 5))
        app.buttons["Close photo"].tap()
        let removed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !photo.exists }, object: nil)
        wait(for: [removed], timeout: 6)
        favoritesBar.buttons.firstMatch.tap()

        let camping = app.buttons["Camping"]
        if !camping.isHittable { scrollView.swipeUp() }
        camping.tap()
        XCTAssertTrue(app.navigationBars["Camping"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Easter morning")).firstMatch
            .waitForExistence(timeout: 5))
    }

    @MainActor func testHomeShowsFavoritesBeforeSlowAlbums() throws {
        continueAfterFailure = false
        let fixture = try LibraryFixture(holdHomeRequests: true)
        try signIn(to: fixture)

        let skeleton = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Loading favorites")).firstMatch
        XCTAssertTrue(skeleton.waitForExistence(timeout: 8))
        app.terminate()
        app.launch()
        XCTAssertTrue(skeleton.waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["home.favoritesHeading"].exists)
        takeScreenshot(named: "home-loading")

        fixture.releaseHomeRequests(.favorites)
        let photo = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Fixture photo")).firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 8))
        let thumbnail = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in fixture.sawJPEG }, object: nil)
        wait(for: [thumbnail], timeout: 5)
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Loading albums")).firstMatch.exists)

        fixture.releaseHomeRequests(.albums)
        XCTAssertTrue(app.buttons["Fixture album"].waitForExistence(timeout: 5))

        fixture.failLibrary()
        let requestCount = fixture.favoriteRequests
        let feed = app.scrollViews["home.scrollView"]
        let pullStart = feed.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.18))
        let pullEnd = feed.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.70))
        pullStart.press(forDuration: 0.08, thenDragTo: pullEnd, withVelocity: .slow, thenHoldForDuration: 0.5)
        let refreshRequested = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in fixture.favoriteRequests > requestCount }, object: nil)
        wait(for: [refreshRequested], timeout: 6)
        let refreshFailure = app.buttons["Couldn’t load favorites. Try again"]
        XCTAssertTrue(refreshFailure.waitForExistence(timeout: 8))
        XCTAssertTrue(photo.exists)
        fixture.restoreLibrary()
        refreshFailure.tap()
        let recovered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !refreshFailure.exists }, object: nil)
        wait(for: [recovered], timeout: 8)
        try signOutOfFixture()
    }

    func testBackupShowsBothDestinations() {
        continueAfterFailure = false
        app.terminate()
        app.launchArguments = ["--ui-test-home"]
        app.launch()

        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        let backup = app.descendants(matching: .any)["settings.backup"].firstMatch
        XCTAssertTrue(backup.waitForExistence(timeout: 5))
        takeScreenshot(named: "settings-index")
        backup.tap()

        let photosPermission = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow Full Access"]
        if photosPermission.waitForExistence(timeout: 2) {
            photosPermission.tap()
        }

        let backupBar = app.navigationBars["Backup & Sync"]
        XCTAssertTrue(backupBar.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["backup.autoBackup"].firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["backup.wifiOnly"].firstMatch.exists)
        let uploadLimit = app.buttons["Upload limit"]
        let simultaneousUploads = app.descendants(matching: .any)["backup.uploadLimit.stepper"].firstMatch
        XCTAssertFalse(simultaneousUploads.exists)
        takeScreenshot(named: "settings-backup-and-sync")
        uploadLimit.tap()
        XCTAssertTrue(simultaneousUploads.waitForExistence(timeout: 5))

        let activity = app.descendants(matching: .any)["backup.activity"].firstMatch
        XCTAssertTrue(activity.waitForExistence(timeout: 5))
        activity.tap()
        let activityBar = app.navigationBars["Backup activity"]
        XCTAssertTrue(activityBar.waitForExistence(timeout: 5))
        activityBar.buttons.firstMatch.tap()
        XCTAssertTrue(backupBar.waitForExistence(timeout: 5))
        backupBar.buttons.firstMatch.tap()

        let storage = app.descendants(matching: .any)["settings.storage"].firstMatch
        XCTAssertTrue(storage.waitForExistence(timeout: 5))
        storage.tap()
        let storageBar = app.navigationBars["Storage"]
        XCTAssertTrue(storageBar.waitForExistence(timeout: 5))

        let nas = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Home NAS")).firstMatch
        XCTAssertTrue(nas.waitForExistence(timeout: 8))
        let connection = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier == %@ AND label CONTAINS[c] %@", "storage.flickrConnection", "Connected"
        )).firstMatch
        XCTAssertTrue(connection.waitForExistence(timeout: 8))
        let automaticCopyChecks = app.switches["storage.automaticCopyChecks"].firstMatch
        XCTAssertTrue(automaticCopyChecks.exists)
        let deviceSpace = app.buttons["Device space"]
        let cleanup = app.buttons["Free up device space"]
        XCTAssertFalse(cleanup.exists)
        takeScreenshot(named: "settings-storage")
        deviceSpace.tap()
        XCTAssertTrue(cleanup.waitForExistence(timeout: 5))

        let originalValue = automaticCopyChecks.value as? String
        automaticCopyChecks.tap()
        XCTAssertNotEqual(automaticCopyChecks.value as? String, originalValue)
        storageBar.buttons.firstMatch.tap()
        storage.tap()
        XCTAssertTrue(automaticCopyChecks.waitForExistence(timeout: 5))
        XCTAssertEqual(automaticCopyChecks.value as? String, originalValue == "1" ? "0" : "1")
        automaticCopyChecks.tap()
    }

    @MainActor func testLibraryRetriesThenLoadsAfterRelaunch() throws {
        continueAfterFailure = false
        let fixture = try LibraryFixture()
        try signIn(to: fixture)

        let library = app.buttons["Library"]
        XCTAssertTrue(library.waitForExistence(timeout: 10))
        // Relaunch after saving the session, so keyboard dismissal does not
        // interfere with navigating to the first catalog request.
        app.terminate()
        app.launch()
        let libraryReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in library.isHittable }, object: nil)
        wait(for: [libraryReady], timeout: 12)
        library.tap()
        XCTAssertTrue(app.staticTexts["Couldn’t load your library."].waitForExistence(timeout: 8))
        let retry = app.buttons["library.retry"]
        let retryReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in retry.isHittable }, object: nil)
        wait(for: [retryReady], timeout: 8)
        XCTAssertFalse(app.staticTexts["Your library is empty."].exists)

        fixture.restoreLibrary()
        retry.tap()
        let photo = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Fixture photo")).firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 8))
        let thumbnailRequest = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in fixture.sawJPEG }, object: nil)
        wait(for: [thumbnailRequest], timeout: 5)
        takeScreenshot(named: "library-recovered")

        app.buttons["Settings"].tap()
        let storage = app.descendants(matching: .any)["settings.storage"].firstMatch
        XCTAssertTrue(storage.waitForExistence(timeout: 5))
        storage.tap()
        let flickrStatus = app.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS[c] %@ AND (label CONTAINS[c] %@ OR value == %@)",
            "Household Flickr", "Needs verification", "Needs verification"
        )).firstMatch
        XCTAssertTrue(flickrStatus.waitForExistence(timeout: 8))
        app.navigationBars["Storage"].buttons.firstMatch.tap()
        try signOutOfFixture(settingsAlreadyShown: true, captureConfirmation: true)
    }

    private func signIn(to fixture: LibraryFixture) throws {
        let ready = expectation(description: "Fixture server is listening")
        fixture.start { ready.fulfill() }
        wait(for: [ready], timeout: 5)
        let port = try XCTUnwrap(fixture.port)

        app.terminate()
        app.launchArguments = ["-kindred_server_url", "http://127.0.0.1:\(port)", "-hasSeenOnboarding", "YES"]
        app.launch()

        let signIn = app.buttons["Sign in"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 12))
        let username = app.textFields.firstMatch
        username.tap()
        username.typeText("fixture-user")
        let password = app.secureTextFields.firstMatch
        password.tap()
        password.typeText("fixture-password")
        signIn.tap()
    }

    private func signOutOfFixture(settingsAlreadyShown: Bool = false, captureConfirmation: Bool = false) throws {
        if !settingsAlreadyShown { app.buttons["Settings"].tap() }
        let account = app.descendants(matching: .any)["settings.account"].firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 5))
        account.tap()
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 5))
        let signOut = app.buttons["Sign out"].firstMatch
        for _ in 0..<4 where !signOut.isHittable {
            app.swipeUp()
        }
        signOut.tap()
        XCTAssertTrue(app.staticTexts["Sign out?"].waitForExistence(timeout: 5))
        if captureConfirmation { takeScreenshot(named: "sign-out-confirmation") }
        let confirmation = app.buttons.matching(identifier: "Sign out").allElementsBoundByIndex.first(where: \.isHittable)
        try XCTUnwrap(confirmation).tap()
        XCTAssertTrue(app.buttons["Sign in"].waitForExistence(timeout: 8))
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

private final class LibraryFixture {
    enum HomeRoute: Hashable { case favorites, albums }

    private let listener: NWListener
    private let queue = DispatchQueue(label: "com.kindlingsignal.kindred.library-fixture")
    private let token = UUID().uuidString
    private let thumbnail: Data
    private var available = false
    private var requestedJPEG = false
    private var favoriteRequestCount = 0
    private var pairingClaimCount = 0
    private var heldHomeRoutes: Set<HomeRoute> = []
    private var queuedHomeReplies: [HomeRoute: [(NWConnection, String)]] = [:]
    private let exerciseDateSearch: Bool
    private let exerciseExport: Bool
    private let isAdmin: Bool
    private var originalRequests: Set<String> = []
    private var sawNovemberPageTwo = false
    private var sawNovemberVideos = false

    var port: UInt16? { listener.port?.rawValue }
    var sawJPEG: Bool { queue.sync { requestedJPEG } }
    var favoriteRequests: Int { queue.sync { favoriteRequestCount } }
    var pairingClaims: Int { queue.sync { pairingClaimCount } }
    var requestedNovemberPageTwo: Bool { queue.sync { sawNovemberPageTwo } }
    var requestedNovemberVideos: Bool { queue.sync { sawNovemberVideos } }
    var originalsRequested: Set<String> { queue.sync { originalRequests } }

    @MainActor init(holdHomeRequests: Bool = false, exerciseDateSearch: Bool = false, exerciseExport: Bool = false, isAdmin: Bool = false) throws {
        self.exerciseDateSearch = exerciseDateSearch
        self.exerciseExport = exerciseExport
        self.isAdmin = isAdmin
        if holdHomeRequests {
            available = true
            heldHomeRoutes = [.favorites, .albums]
        }
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
        thumbnail = UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24)).jpegData(withCompressionQuality: 0.8) { context in
            context.cgContext.setFillColor(UIColor.systemTeal.cgColor)
            context.cgContext.fill(CGRect(x: 0, y: 0, width: 24, height: 24))
            context.cgContext.setFillColor(UIColor.systemYellow.cgColor)
            context.cgContext.fillEllipse(in: CGRect(x: 6, y: 6, width: 12, height: 12))
        }
    }

    deinit { listener.cancel() }

    func start(ready: @escaping () -> Void) {
        listener.stateUpdateHandler = { if case .ready = $0 { ready() } }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            connection.start(queue: self.queue)
            self.receiveRequest(connection)
        }
        listener.start(queue: queue)
    }

    func restoreLibrary() { queue.sync { available = true } }
    func failLibrary() { queue.sync { available = false } }

    func releaseHomeRequests(_ route: HomeRoute) {
        queue.sync {
            heldHomeRoutes.remove(route)
            for (connection, headers) in queuedHomeReplies.removeValue(forKey: route) ?? [] {
                sendResponse(to: connection, headers: headers)
            }
        }
    }

    private func receiveRequest(_ connection: NWConnection, prefix: Data = Data()) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, complete, error in
            guard let self, error == nil, let data else { connection.cancel(); return }
            let request = prefix + data
            guard let end = request.range(of: Data("\r\n\r\n".utf8)) else {
                if complete || request.count > 8192 { connection.cancel() }
                else { self.receiveRequest(connection, prefix: request) }
                return
            }
            let headers = String(decoding: request[..<end.lowerBound], as: UTF8.self)
            let target = self.requestTarget(in: headers)
            let route: HomeRoute?
            if target.hasPrefix("/favorites?") {
                route = .favorites
                self.favoriteRequestCount += 1
            } else {
                route = target == "/albums" ? .albums : nil
            }
            if let route, self.heldHomeRoutes.contains(route) {
                self.queuedHomeReplies[route, default: []].append((connection, headers))
            } else {
                self.sendResponse(to: connection, headers: headers)
            }
        }
    }

    private func sendResponse(to connection: NWConnection, headers: String) {
        let (status, type, body) = response(for: headers)
        let target = requestTarget(in: headers)
        let filename = target.hasPrefix("/photos/export-clip/local") ? "Clip.mov" : "IMG_0042.JPG"
        let disposition = exerciseExport && status == 200 && target.contains("variant=original")
            ? "Content-Disposition: attachment; filename=\"\(filename)\"\r\n" : ""
        var response = Data("HTTP/1.1 \(status) Fixture\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\n\(disposition)Cache-Control: no-store\r\nConnection: close\r\n\r\n".utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }

    private func requestTarget(in headers: String) -> String {
        let requestLine = headers.components(separatedBy: "\r\n").first ?? ""
        return requestLine.split(separator: " ").dropFirst().first.map(String.init) ?? ""
    }

    private func response(for headers: String) -> (Int, String, Data) {
        func json(_ body: String, status: Int = 200) -> (Int, String, Data) {
            (status, "application/json", Data(body.utf8))
        }

        let target = requestTarget(in: headers)
        let role = isAdmin ? "admin" : "member"
        let user = #"{"id":"fixture", "username":"fixture-user", "display_name":"Fixture User", "role":"\#(role)"}"#
        switch target {
        case "/public/pairing/claim":
            pairingClaimCount += 1
            return json(#"{"server_url":"http://127.0.0.1:\#(port ?? 0)","user":\#(user),"session":{"token":"\#(token)","expires_at":"2099-11-21T00:00:00Z"}}"#)
        case "/auth/login":
            return json(#"{"user":\#(user),"session":{"token":"\#(token)","expires_at":"2099-11-21T00:00:00Z"}}"#)
        case "/app-config", "/health":
            return json(#"{"status":"ok","db":"connected"}"#)
        default: break
        }

        let authenticated = headers.lowercased().contains("\r\nx-session-token: \(token.lowercased())")
        let mediaURL = target.hasPrefix("/photos/fixture-photo/image?")
            || (exerciseDateSearch && target.hasPrefix("/photos/november-"))
            || (exerciseExport && target.hasPrefix("/photos/export-"))
        guard authenticated || (mediaURL && target.contains("session_token=\(token)")) else {
            return json("{}", status: 401)
        }

        if target == "/admin/indexing-progress" {
            guard isAdmin else { return json("{}", status: 403) }
            return json("""
              {"pipelines":[
                {"key":"discovery","label":"File catalog","done":92000,"total":92000,"running":false,"complete":true,"stale":false},
                {"key":"previews","label":"Thumbnails","done":81240,"total":92000,"running":true,"complete":false,"stale":false},
                {"key":"index","label":"Recognition","done":12407,"total":78520,"running":false,"complete":false,"stale":false,"phase":"waiting_for_previews"}
              ]}
              """)
        }
        if target == "/auth/me" { return json(#"{"loggedIn":true,"userId":"fixture"}"#) }
        if target == "/clusters/people/summary" { return json(#"{"clusters":[]}"#) }
        if target == "/syncs" { return json("[]") }
        if target == "/integrations/flickr" { return json(#"{"configured":true,"connected":true,"verified":false}"#) }
        if target == "/albums" {
            return json(#"{"albums":[{"id":"12345678-1234-1234-1234-123456789abc","name":"Fixture album","photo_count":1}]}"#)
        }
        if exerciseExport, target.hasPrefix("/library/photos?") {
            return json(#"""
            {"photos":[
              {"photo_id":"export-still-1","photo_title":"First original","media_kind":"photo","date_taken":"2025-11-16T19:00:00Z"},
              {"photo_id":"export-still-2","photo_title":"IMG_0042.JPG","media_kind":"photo","date_taken":"2025-11-16T18:00:00Z"},
              {"photo_id":"export-clip","photo_title":"First video","media_kind":"video","date_taken":"2025-11-09T18:10:00Z","duration_seconds":12}
            ],"next_cursor":null}
            """#)
        }
        if exerciseExport, target.hasPrefix("/photos/export-") {
            let id = target.split(separator: "/")[1]
            if target.hasSuffix("/favorite") {
                return json(#"{"photo_id":"\#(id)","favorited":\#(id == "export-still-1")}"#)
            }
            if target.contains("variant=original") {
                if id == "export-still-2" { return json("{}", status: 404) }
                originalRequests.insert(String(id))
                if id == "export-clip" { return (200, "video/quicktime", Data("fixture video original".utf8)) }
            } else if target.contains("size=o") {
                originalRequests.insert(String(id))
            }
            return (200, "image/jpeg", thumbnail)
        }
        if exerciseDateSearch, target.hasPrefix("/library/photos?"),
           target.contains("date_from=2025-11-01"), target.contains("date_to=2025-11-30") {
            let still = #"{"photo_id":"november-still","photo_title":"November still","media_kind":"photo","date_taken":"2025-11-30T23:59:59Z"}"#
            let video = #"{"photo_id":"november-clip","photo_title":"November clip","media_kind":"video","date_taken":"2025-11-14T12:00:00Z","duration_seconds":12}"#
            let older = #"{"photo_id":"november-earlier","photo_title":"Earlier November still","media_kind":"photo","date_taken":"2025-11-01T00:00:00Z"}"#
            if target.contains("media=video") {
                sawNovemberVideos = true
                return json(#"{"photos":[\#(video)],"next_cursor":null}"#)
            }
            if target.contains("cursor=november-next") {
                sawNovemberPageTwo = true
                return json(#"{"photos":[\#(older)],"next_cursor":null}"#)
            }
            return json(#"{"photos":[\#(still),\#(video)],"next_cursor":"november-next"}"#)
        }
        if target.hasPrefix("/library/photos?") || target.hasPrefix("/favorites?") {
            if !available { return json("{}", status: 503) }
            return json(#"{"photos":[{"photo_id":"fixture-photo","photo_title":"Fixture photo","media_kind":"photo"}],"next_cursor":null}"#)
        }
        if mediaURL && (target.contains("format=jpeg") || target.contains("variant=thumb")) {
            requestedJPEG = true
            return (200, "image/jpeg", thumbnail)
        }
        return json("{}", status: 404)
    }
}
