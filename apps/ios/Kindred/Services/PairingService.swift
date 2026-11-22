import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Joins this device to a self-hosted Kindred server using a pairing code.
///
/// The web app provides the household's address and a one-time code that
/// this device exchanges for a session on that server.
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
    static let sessionServerURLKey = "kindred_session_server_url"
    // Used only to migrate a session created before server selection existed.
    private static let legacyServerURL = "https://api.kindredphotos.app"

    static func serverForSavedSession() -> String? {
        if let bound = KeychainHelper.loadString(forKey: sessionServerURLKey) {
            return normaliseServer(bound)
        }
        return storedServerURL() ?? legacyServerURL
    }

    private final class NoAuthenticationRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(
            _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
            newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
        ) {
            completionHandler(nil)
        }
    }

    static let authenticationSession = URLSession(
        configuration: .ephemeral, delegate: NoAuthenticationRedirects(), delegateQueue: nil
    )

    struct Pairing: Equatable {
        let serverURL: String?
        let code: String
    }

    enum PairingError: LocalizedError {
        case invalidCode
        case noServer
        case serverMismatch
        case rejected(String)
        case network(String)

        var errorDescription: String? {
            switch self {
            case .invalidCode:
                return "That doesn't look like a pairing code."
            case .noServer:
                return "This code didn't include a server address. Enter it manually."
            case .serverMismatch:
                return "The pairing code and server address don’t match. Generate a new code on that server."
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

    /// Read a Kindred setup link or a code someone entered by hand.
    static func parse(_ scanned: String) -> Pairing? {
        let trimmed = scanned.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let components = URLComponents(string: trimmed), let scheme = components.scheme?.lowercased() {
            if scheme == "kindred", components.host?.lowercased() == "pair", components.path.isEmpty {
                return parseLinkItems(components.queryItems ?? [])
            }
            guard scheme == "https", components.host?.isEmpty == false,
                  components.user == nil, components.password == nil,
                  components.path == "/pair", components.query == nil,
                  let fragment = components.percentEncodedFragment,
                  let fields = URLComponents(string: "?" + fragment)?.queryItems
            else { return nil }
            return parseLinkItems(fields)
        }

        guard trimmed.uppercased().allSatisfy({ alphabet.contains($0) || $0 == "-" || $0.isWhitespace })
        else { return nil }
        let bare = normalise(trimmed)
        guard bare.count == codeLength else { return nil }
        return Pairing(serverURL: nil, code: bare)
    }

    private static func parseLinkItems(_ items: [URLQueryItem]) -> Pairing? {
        let codes = items.filter { $0.name == "code" }
        let servers = items.filter { $0.name == "server" }
        guard codes.count == 1, servers.count == 1,
              let code = codes.first?.value?.uppercased(),
              code.count == codeLength, code.allSatisfy(alphabet.contains),
              let server = normaliseServer(servers.first?.value)
        else { return nil }
        return Pairing(serverURL: server, code: code)
    }

    /// Accept what someone would actually type for a server: bare hostnames
    /// become https, trailing slashes go.
    static func normaliseServer(_ raw: String?) -> String? {
        guard var value = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return nil }
        if !value.contains("://") {
            value = "https://" + value
        }
        guard var parts = URLComponents(string: value), let scheme = parts.scheme?.lowercased(),
              let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil
        else { return nil }
        #if DEBUG
        let isLocalFixture = scheme == "http" && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host)
        #else
        let isLocalFixture = false
        #endif
        guard scheme == "https" || isLocalFixture else { return nil }
        parts.scheme = scheme
        parts.host = host
        if scheme == "https" && parts.port == 443 { parts.port = nil }
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        return parts.url?.absoluteString
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
        let session = SessionManager.shared
        try await session.authenticate {
            try await exchange(pairing, deviceName: deviceName, session: session)
        }
    }

    @MainActor
    private static func exchange(_ pairing: Pairing, deviceName: String, session: SessionManager) async throws {
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
            (data, response) = try await authenticationSession.data(for: request)
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
        guard normaliseServer(claim.server_url) == server else { throw PairingError.serverMismatch }

        await session.restoreSession(
            token: claim.session.token,
            user: UserInfo(
                id: claim.user.id,
                username: claim.user.username ?? "",
                display_name: claim.user.username ?? "",
                role: claim.user.role ?? "member"
            ),
            expiresAt: claim.session.expires_at,
            serverURL: server
        )
    }

    // MARK: - Remembering the server

    static func storedServerURL() -> String? {
        normaliseServer(UserDefaults.standard.string(forKey: serverURLKey))
    }

    static func rememberServerURL(_ url: String) {
        UserDefaults.standard.set(url, forKey: serverURLKey)
    }

    static func forgetServerURL() {
        UserDefaults.standard.removeObject(forKey: serverURLKey)
    }

    static func defaultDeviceName() -> String {
        #if canImport(UIKit)
        return UIDevice.current.name
        #else
        return "iPhone"
        #endif
    }
}
