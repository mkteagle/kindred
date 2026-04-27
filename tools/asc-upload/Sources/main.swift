import Foundation
import AppStoreConnect_Swift_SDK
import ArgumentParser
import CryptoKit

@main
struct ASCUpload: AsyncParsableCommand {
    static var configuration = CommandConfiguration(
        commandName: "asc-upload",
        abstract: "Upload App Store screenshots via App Store Connect API"
    )

    @Option(name: .long, help: "Path to .p8 private key file")
    var keyPath: String = "fastlane/ApiKey_YB9Y815TOBAQ.p8"

    @Option(name: .long, help: "API Key ID")
    var keyId: String = "YB9Y815TOBAQ"

    @Option(name: .long, help: "Issuer ID")
    var issuerId: String = "f180b8c2-2c8a-4167-b8c4-c8270ed3b0f8"

    @Option(name: .long, help: "App bundle ID")
    var bundleId: String = "com.kindlingsignal.kindred"

    @Option(name: .long, help: "Screenshots directory")
    var screenshotsDir: String = "screenshots/appstore"

    @Flag(name: .long, help: "Dry run — show what would be uploaded")
    var dryRun: Bool = false

    func run() async throws {
        print("\n  Kindred Photos — App Store Connect Screenshot Uploader\n")
        print("  Key ID:    \(keyId)")
        print("  Issuer ID: \(issuerId)")
        print("  Bundle ID: \(bundleId)")
        print("  Dry run:   \(dryRun)")

        // Load private key — strip PEM headers, SDK expects raw base64
        let keyURL = URL(fileURLWithPath: keyPath)
        let privateKey = try String(contentsOf: keyURL, encoding: .utf8)
            .replacingOccurrences(of: "-----BEGIN PRIVATE KEY-----", with: "")
            .replacingOccurrences(of: "-----END PRIVATE KEY-----", with: "")
            .replacingOccurrences(of: "\n", with: "")

        // Create API configuration
        let config = try APIConfiguration(
            issuerID: issuerId,
            privateKeyID: keyId,
            privateKey: privateKey
        )
        let provider = APIProvider(configuration: config)

        // Step 1: Find the app
        print("\n  Finding app...")
        let appsRequest = APIEndpoint.v1.apps.get(parameters: .init(
            filterBundleID: [bundleId]
        ))
        let appsResponse = try await provider.request(appsRequest)
        guard let app = appsResponse.data.first else {
            print("  Error: No app found with bundle ID '\(bundleId)'")
            return
        }
        let appId = app.id
        let appName = app.attributes?.name ?? "Unknown"
        print("  Found: \(appName) (\(appId))")

        // Step 2: Get the editable App Store version
        print("  Finding App Store version...")
        let versionsRequest = APIEndpoint.v1.apps.id(appId).appStoreVersions.get(parameters: .init(
            filterPlatform: [.ios]
        ))
        let versionsResponse = try await provider.request(versionsRequest)
        guard let version = versionsResponse.data.first(where: {
            let state = $0.attributes?.appStoreState
            return state == .prepareForSubmission || state == .developerRejected || state == .rejected
        }) ?? versionsResponse.data.first else {
            print("  Error: No App Store version found")
            return
        }
        let versionId = version.id
        let versionString = version.attributes?.versionString ?? "?"
        let state = version.attributes?.appStoreState?.rawValue ?? "?"
        print("  Version: \(versionString) (\(state))")

        // Step 3: Get en-US localization
        print("  Finding en-US localization...")
        let locsRequest = APIEndpoint.v1.appStoreVersions.id(versionId).appStoreVersionLocalizations.get()
        let locsResponse = try await provider.request(locsRequest)
        guard let enLoc = locsResponse.data.first(where: { $0.attributes?.locale == "en-US" }) else {
            print("  Error: No en-US localization found")
            return
        }
        let locId = enLoc.id
        print("  Localization: en-US (\(locId))")

        // Step 4: Upload screenshots for each device type
        let deviceTypes: [(String, ScreenshotDisplayType)] = [
            ("iphone", .appIphone65),       // 6.5" — 1284x2778
            ("iphone69", .appIphone67),     // 6.9" — 1320x2868
            ("ipad", .appIpadPro3gen129),   // 13" iPad Pro
        ]

        let baseDir = URL(fileURLWithPath: screenshotsDir)

        for (device, displayType) in deviceTypes {
            let deviceDir = baseDir.appendingPathComponent(device)
            let fm = FileManager.default
            guard fm.fileExists(atPath: deviceDir.path) else {
                print("\n  Skipping \(device) — no directory at \(deviceDir.path)")
                continue
            }

            let files = try fm.contentsOfDirectory(atPath: deviceDir.path)
                .filter { $0.hasSuffix(".png") }
                .sorted()

            guard !files.isEmpty else {
                print("\n  Skipping \(device) — no PNG files")
                continue
            }

            print("\n  === \(device.uppercased()) — \(files.count) screenshots ===\n")

            // Get or create screenshot set
            let setsRequest = APIEndpoint.v1.appStoreVersionLocalizations.id(locId).appScreenshotSets.get()
            let setsResponse = try await provider.request(setsRequest)

            var setId: String
            if let existingSet = setsResponse.data.first(where: {
                $0.attributes?.screenshotDisplayType == displayType
            }) {
                setId = existingSet.id

                // Delete existing screenshots
                let existingRequest = APIEndpoint.v1.appScreenshotSets.id(setId).appScreenshots.get()
                let existingResponse = try await provider.request(existingRequest)
                if !existingResponse.data.isEmpty {
                    print("  Deleting \(existingResponse.data.count) existing screenshots...")
                    for screenshot in existingResponse.data {
                        let deleteRequest = APIEndpoint.v1.appScreenshots.id(screenshot.id).delete
                        _ = try? await provider.request(deleteRequest)
                    }
                    // Wait a moment for deletions to propagate
                    try await Task.sleep(nanoseconds: 2_000_000_000)
                }
            } else {
                print("  Creating screenshot set for \(device)...")
                let createSetRequest = APIEndpoint.v1.appScreenshotSets.post(.init(
                    data: .init(
                        type: .appScreenshotSets,
                        attributes: .init(screenshotDisplayType: displayType),
                        relationships: .init(appStoreVersionLocalization: .init(data: .init(
                            type: .appStoreVersionLocalizations,
                            id: locId
                        )))
                    )
                ))
                let createSetResponse = try await provider.request(createSetRequest)
                setId = createSetResponse.data.id
            }

            // Upload each screenshot
            for (index, fileName) in files.enumerated() {
                let filePath = deviceDir.appendingPathComponent(fileName)
                let fileData = try Data(contentsOf: filePath)
                let fileSize = fileData.count

                if dryRun {
                    print("  [DRY RUN] Would upload: \(fileName) (\(fileSize / 1024) KB)")
                    continue
                }

                print("  Uploading \(fileName) (\(fileSize / 1024) KB)...", terminator: "")
                fflush(stdout)

                do {
                    // Reserve
                    let reserveRequest = APIEndpoint.v1.appScreenshots.post(.init(
                        data: .init(
                            type: .appScreenshots,
                            attributes: .init(
                                fileSize: fileSize,
                                fileName: fileName
                            ),
                            relationships: .init(appScreenshotSet: .init(data: .init(
                                type: .appScreenshotSets,
                                id: setId
                            )))
                        )
                    ))
                    let reserveResponse = try await provider.request(reserveRequest)
                    let screenshotId = reserveResponse.data.id
                    let uploadOps = reserveResponse.data.attributes?.uploadOperations ?? []

                    // Upload parts
                    for op in uploadOps {
                        guard let url = op.url, let urlObj = URL(string: url) else { continue }
                        let offset = op.offset ?? 0
                        let length = op.length ?? fileData.count
                        let chunk = fileData[offset..<min(offset + length, fileData.count)]

                        var req = URLRequest(url: urlObj)
                        req.httpMethod = "PUT"
                        for header in op.requestHeaders ?? [] {
                            if let name = header.name, let value = header.value {
                                req.setValue(value, forHTTPHeaderField: name)
                            }
                        }
                        req.httpBody = Data(chunk)
                        let (_, resp) = try await URLSession.shared.data(for: req)
                        guard let httpResp = resp as? HTTPURLResponse, httpResp.statusCode == 200 else {
                            print(" UPLOAD PART FAILED")
                            continue
                        }
                    }

                    // Commit
                    let md5 = Insecure.MD5.hash(data: fileData)
                    let checksum = md5.map { String(format: "%02x", $0) }.joined()

                    let commitRequest = APIEndpoint.v1.appScreenshots.id(screenshotId).patch(.init(
                        data: .init(
                            type: .appScreenshots,
                            id: screenshotId,
                            attributes: .init(
                                sourceFileChecksum: checksum,
                                isUploaded: true
                            )
                        )
                    ))
                    _ = try await provider.request(commitRequest)
                    print(" OK")

                } catch {
                    print(" FAILED: \(error)")
                }
            }
        }

        print("\n  Done!\n")
        if !dryRun {
            print("  Check screenshots at: https://appstoreconnect.apple.com")
        }
        print()
    }
}
