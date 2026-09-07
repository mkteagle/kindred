import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Joins this device to a self-hosted Kindred server using a pairing code.
///
/// A household's server lives at an address only its owner knows, behind their
/// own tunnel. Rather than typing that address and a password on a phone, the
/// web app shows a code carrying both; this exchanges it for a real session.
///
/// The parsing is deliberately separate from the network call so the awkward
/// part — what a scanned string might actually contain — can be reasoned about
/// on its own.
enum PairingService {

    /// Characters a code can contain. Excludes 0/O/1/I/L, which are misread off
    /// a screen; the server uses the same alphabet.
    static let alphabet = Set("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
    static let codeLength = 8

    /// Where the server address is remembered between launches. Not a secret —
    /// the session token is what is sensitive, and that lives in the Keychain.
    static let serverURLKey = "kindred_server_url"

    struct Pairing: Equatable {
        let serverURL: String?
        let code: String
    }

    enum PairingError: LocalizedError {
        case invalidCode
        case noServer
        case rejected(String)
        case network(String)

        var errorDescription: String? {
            switch self {
            case .invalidCode:
                return "That doesn't look like a pairing code."
            case .noServer:
                return "This code didn't include a server address. Enter it manually."
            case .rejected(let reason):
                return reason
            case .network(let reason):
                return reason
            }
        }
    }

    // MARK: - Parsing

    /// Reduce anything a person might type or a camera might read to a bare code.
    ///
    /// Look-alikes are deliberately not remapped: `O` is not in the alphabet, so
    /// an `O` means a genuine mistype and should fail rather than quietly
    /// resolving to somebody else's code.
    static func normalise(_ raw: String) -> String {
        String(raw.uppercased().filter { alphabet.contains($0) })
    }

    static func isCompleteCode(_ raw: String) -> Bool {
        normalise(raw).count == codeLength
    }

    /// Read a scanned string. Accepts the `kindred://pair?server=…&code=…` URL
    /// the QR encodes, and also a bare code, so a person can type one by hand.
    static func parse(_ scanned: String) -> Pairing? {
        let trimmed = scanned.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let components = URLComponents(string: trimmed),
           components.scheme?.lowercased() == "kindred" {
            let items = components.queryItems ?? []
            let code = normalise(items.first { $0.name == "code" }?.value ?? "")
            guard code.count == codeLength else { return nil }
            let server = items.first { $0.name == "server" }?.value?
                .trimmingCharacters(in: .whitespaces)
            return Pairing(serverURL: normaliseServer(server), code: code)
        }

        let bare = normalise(trimmed)
        guard bare.count == codeLength else { return nil }
        return Pairing(serverURL: nil, code: bare)
    }

    /// Accept what someone would actually type for a server: bare hostnames
    /// become https, trailing slashes go.
    static func normaliseServer(_ raw: String?) -> String? {
        guard var value = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return nil }
        if !value.lowercased().hasPrefix("http://") && !value.lowercased().hasPrefix("https://") {
            value = "https://" + value
        }
        while value.hasSuffix("/") { value.removeLast() }
        guard let url = URL(string: value), url.host != nil else { return nil }
        return value
    }

    // MARK: - Claiming

    private struct ClaimRequest: Encodable {
        let code: String
        let device_name: String
    }

    private struct ClaimResponse: Decodable {
        let server_url: String
        let session: SessionInfo
        let user: PairedUser
    }

    private struct PairedUser: Decodable {
        let id: String
        let username: String?
        let role: String?
    }

    private struct ErrorBody: Decodable { let detail: String? }

    /// Exchange a pairing code for a session, and remember where the server is.
    ///
    /// On success the device holds an ordinary session — the same thing it
    /// would have got from typing a password, without anyone having typed one.
    @MainActor
    static func claim(_ pairing: Pairing, deviceName: String = defaultDeviceName()) async throws {
        guard let server = pairing.serverURL ?? storedServerURL() else {
            throw PairingError.noServer
        }
        guard let url = URL(string: "\(server)/public/pairing/claim") else {
            throw PairingError.noServer
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30
        request.httpBody = try JSONEncoder().encode(
            ClaimRequest(code: pairing.code, device_name: deviceName)
        )

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw PairingError.network("Couldn't reach \(server). Check the address and your network.")
        }

        guard let http = response as? HTTPURLResponse else {
            throw PairingError.network("The server gave an unexpected response.")
        }
        guard (200...299).contains(http.statusCode) else {
            let detail = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.detail
            // 404 covers unknown, expired and already-used alike, by design:
            // the server will not say which, so neither can this.
            throw PairingError.rejected(detail ?? (http.statusCode == 429
                ? "Too many attempts. Wait a few minutes."
                : "That code is no longer valid. Generate a new one."))
        }

        let claim = try JSONDecoder().decode(ClaimResponse.self, from: data)
        let resolved = normaliseServer(claim.server_url) ?? server

        // Point the client at this household before storing the session, so no
        // request can be made against the old server with the new token.
        await APIClient.shared.setBaseURL(resolved)
        rememberServerURL(resolved)

        SessionManager.shared.restoreSession(
            token: claim.session.token,
            user: UserInfo(
                id: claim.user.id,
                username: claim.user.username ?? "",
                display_name: claim.user.username ?? "",
                role: claim.user.role ?? "member"
            ),
            expiresAt: claim.session.expires_at
        )
    }

    // MARK: - Remembering the server

    static func storedServerURL() -> String? {
        UserDefaults.standard.string(forKey: serverURLKey)
    }

    static func rememberServerURL(_ url: String) {
        UserDefaults.standard.set(url, forKey: serverURLKey)
    }

    static func forgetServerURL() {
        UserDefaults.standard.removeObject(forKey: serverURLKey)
    }

    /// Restore the paired server on launch. Without this the app would pair
    /// once and then talk to the default host on next start.
    static func restoreServerURL() async {
        if let stored = storedServerURL() {
            await APIClient.shared.setBaseURL(stored)
        }
    }

    static func defaultDeviceName() -> String {
        #if canImport(UIKit)
        return UIDevice.current.name
        #else
        return "iPhone"
        #endif
    }
}
