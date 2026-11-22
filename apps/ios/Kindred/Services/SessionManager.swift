import Foundation
import CryptoKit
import AuthenticationServices
import Security
import UIKit

extension Notification.Name {
    static let kindredSessionUnauthorized = Notification.Name("kindred.session.unauthorized")
}

struct UserInfo: Codable {
    let id: String
    let username: String
    let display_name: String
    let role: String
    let avatar_url: String?

    enum CodingKeys: String, CodingKey {
        case id, username, display_name, role, avatar_url
    }

    init(id: String, username: String, display_name: String, role: String, avatar_url: String? = nil) {
        self.id = id
        self.username = username
        self.display_name = display_name
        self.role = role
        self.avatar_url = avatar_url
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        username = try container.decode(String.self, forKey: .username)
        display_name = try container.decode(String.self, forKey: .display_name)
        role = try container.decode(String.self, forKey: .role)
        avatar_url = try container.decodeIfPresent(String.self, forKey: .avatar_url)
    }
}

struct AuthResponse: Codable {
    let user: UserInfo
    let session: SessionInfo
    let review_demo: Bool?
}

struct SessionInfo: Codable {
    let token: String
    let expires_at: String
}

/// Manages household account sessions (username/password auth).
@Observable
@MainActor
final class SessionManager {
    static let shared = SessionManager()

    // App Review receives the matching plaintext through StoreShip. Only its
    // one-way digest is bundled, and a match opens isolated local demo data.
    private static let appReviewUsername = "appreview@kindredphotos.app"
    private static let appReviewPasswordSHA256 = "d72e53563cf2d3b64f97dcfea6de20293e07fd9c915ef15aaa1521cb9386ed50"

    private(set) var isAuthenticated = false
    private(set) var currentUser: UserInfo?
    private(set) var sessionToken: String?
    private(set) var serverURL = PairingService.storedServerURL()

    private let tokenKey = "kindred_session_token"
    private let userKey = "kindred_session_user"
    private let expiryKey = "kindred_session_expiry"
    private var unauthorizedObserver: NSObjectProtocol?
    private var authenticating = false

    private init() {
        loadStoredSession()
        unauthorizedObserver = NotificationCenter.default.addObserver(
            forName: .kindredSessionUnauthorized,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.invalidateSession()
            }
        }
    }

    // MARK: - Session Persistence

    private func loadStoredSession() {
        guard let token = KeychainHelper.loadString(forKey: tokenKey) else { return }

        guard token != "demo", let boundServer = PairingService.serverForSavedSession() else {
            clearStoredSession()
            return
        }

        if let expiryString = KeychainHelper.loadString(forKey: expiryKey),
           let expiry = Self.parseServerDate(expiryString),
           expiry <= Date() {
            clearStoredSession()
            Task { await APIClient.shared.setSessionToken(nil) }
            return
        }

        self.sessionToken = token
        self.serverURL = boundServer
        PairingService.rememberServerURL(boundServer)
        KeychainHelper.saveString(boundServer, forKey: PairingService.sessionServerURLKey)
        Analytics.configure(server: boundServer)
        self.isAuthenticated = true
        if let user: UserInfo = KeychainHelper.loadCodable(forKey: userKey) {
            self.currentUser = user
        }
    }

    private func storeSession(token: String, user: UserInfo, expiresAt: String?) {
        self.sessionToken = token
        self.currentUser = user
        self.isAuthenticated = true
        guard token != "demo", let serverURL else { return }
        KeychainHelper.saveString(serverURL, forKey: PairingService.sessionServerURLKey)
        KeychainHelper.saveString(token, forKey: tokenKey)
        KeychainHelper.saveCodable(user, forKey: userKey)
        if let expiresAt {
            KeychainHelper.saveString(expiresAt, forKey: expiryKey)
        } else {
            KeychainHelper.delete(key: expiryKey)
        }
    }

    private func clearStoredSession() {
        sessionToken = nil
        currentUser = nil
        isAuthenticated = false
        KeychainHelper.delete(key: tokenKey)
        KeychainHelper.delete(key: userKey)
        KeychainHelper.delete(key: expiryKey)
        KeychainHelper.delete(key: PairingService.sessionServerURLKey)
    }

    private static func parseServerDate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }

    // MARK: - Login

    enum ConnectionError: LocalizedError {
        case invalidServer, serverRequired, signOutRequired, busy

        var errorDescription: String? {
            switch self {
            case .invalidServer: "Enter your Kindred server’s HTTPS address."
            case .serverRequired: "Choose your household server first."
            case .signOutRequired: "Sign out before connecting to another household."
            case .busy: "Another sign-in is in progress."
            }
        }
    }

    func authenticate<T>(_ operation: () async throws -> T) async throws -> T {
        guard !isAuthenticated else { throw ConnectionError.signOutRequired }
        guard !authenticating else { throw ConnectionError.busy }
        authenticating = true
        defer { authenticating = false }
        return try await operation()
    }

    func selectServer(_ address: String) async throws {
        try await authenticate {
            guard let resolved = PairingService.normaliseServer(address) else {
                throw ConnectionError.invalidServer
            }
            await APIClient.shared.setSessionToken(nil, serverURL: resolved)
            PairingService.rememberServerURL(resolved)
            serverURL = resolved
        }
    }

    func login(username: String, password: String) async throws {
        try await authenticate {
            try await passwordLogin(username: username, password: password)
        }
    }

    private func passwordLogin(username: String, password: String) async throws {
        if Self.matchesAppReviewCredentials(username: username, password: password) {
            DemoDataProvider.shared.isActive = true
            let reviewUser = UserInfo(
                id: "app_review_demo",
                username: username,
                display_name: "App Review",
                role: "member"
            )
            await restoreSession(token: "demo", user: reviewUser)
            return
        }

        guard let serverURL else { throw ConnectionError.serverRequired }
        let body = ["username": username, "password": password]
        let response: AuthResponse = try await APIClient.shared.postPublic("/auth/login", body: body)

        if response.review_demo == true {
            DemoDataProvider.shared.isActive = true
            await restoreSession(token: "demo", user: response.user)
            return
        }

        DemoDataProvider.shared.deactivate()
        await restoreSession(
            token: response.session.token,
            user: response.user,
            expiresAt: response.session.expires_at,
            serverURL: serverURL
        )
    }

    private static func matchesAppReviewCredentials(username: String, password: String) -> Bool {
        guard username == appReviewUsername else { return false }
        let digest = SHA256.hash(data: Data(password.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return digest == appReviewPasswordSHA256
    }

    // MARK: - Register (join via invite code)

    func register(inviteCode: String, username: String, displayName: String, password: String) async throws {
        try await authenticate {
            guard let serverURL else { throw ConnectionError.serverRequired }
            let body = [
                "invite_code": inviteCode,
                "username": username,
                "display_name": displayName,
                "password": password,
            ]
            let response: AuthResponse = try await APIClient.shared.postPublic("/auth/register", body: body)
            await restoreSession(
                token: response.session.token,
                user: response.user,
                expiresAt: response.session.expires_at,
                serverURL: serverURL
            )
        }
    }

    // MARK: - Refresh (sync latest user data from server)

    func refreshUser() async {
        guard isAuthenticated, let token = sessionToken else { return }
        do {
            let me: MeResponse = try await APIClient.shared.get("/auth/me")
            guard me.loggedIn, token == sessionToken else { return }
            let updated = UserInfo(
                id: me.userId ?? currentUser?.id ?? "",
                username: me.username ?? currentUser?.username ?? "",
                display_name: me.display_name ?? currentUser?.display_name ?? "",
                role: me.role ?? currentUser?.role ?? "member",
                avatar_url: me.avatar_url
            )
            self.currentUser = updated
            KeychainHelper.saveCodable(updated, forKey: userKey)
        } catch {
            // Offline/server failures leave the last known user available.
        }
    }

    // MARK: - Apply a signed-in session

    func restoreSession(token: String, user: UserInfo, expiresAt: String? = nil, serverURL: String? = nil) async {
        // Mounting the signed-in UI immediately starts authenticated requests.
        await APIClient.shared.setSessionToken(token == "demo" ? nil : token, serverURL: serverURL)
        if let serverURL {
            self.serverURL = serverURL
            PairingService.rememberServerURL(serverURL)
            if token != "demo" { Analytics.configure(server: serverURL) }
        }
        storeSession(token: token, user: user, expiresAt: expiresAt)
    }

    func login(with provider: HostedSocialSignIn.Provider) async throws {
        try await authenticate {
            guard let serverURL else { throw ConnectionError.serverRequired }
            let account = try await HostedSocialSignIn.shared.signIn(with: provider)
            DemoDataProvider.shared.deactivate()
            await restoreSession(token: account.session.token, user: account.user,
                                 expiresAt: account.session.expires_at, serverURL: serverURL)
        }
    }

    /// Update stored user info without changing the session token (e.g. after avatar change)
    func restoreUser(_ user: UserInfo) {
        self.currentUser = user
        KeychainHelper.saveCodable(user, forKey: userKey)
    }

    // MARK: - Logout

    func logout() {
        FlickrUploader.shared.pauseBackup()
        Analytics.stop()
        clearStoredSession()
        Task {
            await APIClient.shared.setSessionToken(nil)
        }
    }

    /// Clears a locally cached session after any API request receives HTTP 401.
    /// This prevents the app from looking signed in while every sync is rejected.
    func invalidateSession() {
        guard isAuthenticated else { return }
        logout()
    }
}

/// The hosted OAuth flow verifies Google's or Apple's identity on the web server.
@MainActor
final class HostedSocialSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Provider: String {
        case google, apple
    }

    static let shared = HostedSocialSignIn()
    private static let origin = URL(string: "https://www.kindredphotos.app")!
    static let integrationsURL = origin.appendingPathComponent("settings/integrations")
    private var session: ASWebAuthenticationSession?

    static func supports(server: String) -> Bool {
        guard let url = URL(string: server), url.scheme == "https", url.port == nil,
              let host = url.host else { return false }
        return ["api.kindredphotos.app", "nas-api.kindredphotos.app"].contains(host)
    }

    func signIn(with provider: Provider) async throws -> AuthResponse {
        guard session == nil, Self.supports(server: await APIClient.shared.currentBaseURL()) else {
            throw SignInError.unavailable
        }
        let verifier = try Self.makeCode()
        let state = try Self.makeCode()
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        guard var start = URLComponents(
            url: Self.origin.appending(path: "api/auth/\(provider.rawValue)"),
            resolvingAgainstBaseURL: false
        ) else { throw SignInError.invalidCallback }
        start.queryItems = [
            URLQueryItem(name: "mobile_state", value: state),
            URLQueryItem(name: "mobile_challenge", value: challenge)
        ]
        guard let url = start.url else { throw SignInError.invalidCallback }

        let callback = try await authorize(url)
        guard let result = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              result.scheme == "kindred", result.host == "social-auth", result.path == "/complete",
              let values = result.queryItems,
              values.filter({ $0.name == "state" }).map(\.value) == [state] else {
            throw SignInError.invalidCallback
        }
        if let code = values.first(where: { $0.name == "error" })?.value {
            throw SignInError.provider(code)
        }
        guard let proof = values.first(where: { $0.name == "proof" })?.value,
              proof.hasPrefix("v2:"), proof.count <= 12_000 else { throw SignInError.invalidCallback }

        var request = URLRequest(url: Self.origin.appending(path: "api/auth/mobile"))
        request.httpMethod = "POST"
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["proof": proof, "verifier": verifier])
        let (body, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SignInError.invalidCallback }
        guard http.statusCode == 200 else {
            struct Failure: Decodable { let detail: String }
            let code = (try? JSONDecoder().decode(Failure.self, from: body))?.detail ?? "oauth_backend"
            throw SignInError.provider(code)
        }
        return try JSONDecoder().decode(AuthResponse.self, from: body)
    }

    private func authorize(_ url: URL) async throws -> URL {
        defer { session = nil }
        return try await withCheckedThrowingContinuation { continuation in
            let browser = ASWebAuthenticationSession(url: url, callbackURLScheme: "kindred") { callback, error in
                if let callback {
                    continuation.resume(returning: callback)
                } else {
                    continuation.resume(throwing: error ?? SignInError.invalidCallback)
                }
            }
            browser.presentationContextProvider = self
            session = browser
            if !browser.start() {
                continuation.resume(throwing: SignInError.unavailable)
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive })?
            .keyWindow ?? ASPresentationAnchor()
    }

    private static func makeCode() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw SignInError.unavailable
        }
        return base64URL(Data(bytes))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    enum SignInError: LocalizedError {
        case unavailable, invalidCallback, provider(String)

        var errorDescription: String? {
            switch self {
            case .unavailable:
                return "Sign-in is unavailable for this server."
            case .invalidCallback:
                return "Kindred could not verify this sign-in. Please try again."
            case .provider("account_not_linked"):
                return "Link this sign-in to your household account in Kindred on the web, then try again."
            case .provider("provider_unavailable"):
                return "This sign-in provider is unavailable. Try another option or scan a pairing code."
            case .provider("oauth_backend"):
                return "Kindred could not reach your household account. Please try again."
            case .provider:
                return "Sign-in could not be completed. Please try again."
            }
        }
    }
}
