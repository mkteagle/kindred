import Foundation
import CryptoKit

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

    private let tokenKey = "kindred_session_token"
    private let userKey = "kindred_session_user"
    private let expiryKey = "kindred_session_expiry"
    private var unauthorizedObserver: NSObjectProtocol?

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

        if let expiryString = KeychainHelper.loadString(forKey: expiryKey),
           let expiry = Self.parseServerDate(expiryString),
           expiry <= Date() {
            clearStoredSession()
            Task { await APIClient.shared.setSessionToken(nil) }
            return
        }

        self.sessionToken = token
        self.isAuthenticated = true
        if let user: UserInfo = KeychainHelper.loadCodable(forKey: userKey) {
            self.currentUser = user
        }
    }

    private func storeSession(token: String, user: UserInfo, expiresAt: String?) {
        self.sessionToken = token
        self.currentUser = user
        self.isAuthenticated = true
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
    }

    private static func parseServerDate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }

    // MARK: - Login

    func login(username: String, password: String) async throws {
        if Self.matchesAppReviewCredentials(username: username, password: password) {
            DemoDataProvider.shared.isActive = true
            let reviewUser = UserInfo(
                id: "app_review_demo",
                username: username,
                display_name: "App Review",
                role: "member"
            )
            storeSession(token: "demo", user: reviewUser, expiresAt: nil)
            await APIClient.shared.setSessionToken(nil)
            return
        }

        let body = ["username": username, "password": password]
        let response: AuthResponse = try await APIClient.shared.postPublic("/auth/login", body: body)

        if response.review_demo == true {
            DemoDataProvider.shared.isActive = true
            storeSession(token: "demo", user: response.user, expiresAt: nil)
            await APIClient.shared.setSessionToken(nil)
            return
        }

        DemoDataProvider.shared.deactivate()
        storeSession(
            token: response.session.token,
            user: response.user,
            expiresAt: response.session.expires_at
        )
        await APIClient.shared.setSessionToken(response.session.token)
        Analytics.identify(userId: response.user.id, properties: [
            "username": response.user.username,
            "role": response.user.role,
        ])
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
        let body: [String: String] = [
            "invite_code": inviteCode,
            "username": username,
            "display_name": displayName,
            "password": password,
        ]
        let response: AuthResponse = try await APIClient.shared.postPublic("/auth/register", body: body)
        storeSession(
            token: response.session.token,
            user: response.user,
            expiresAt: response.session.expires_at
        )
        await APIClient.shared.setSessionToken(response.session.token)
    }

    // MARK: - Refresh (sync latest user data from server)

    func refreshUser() async {
        guard isAuthenticated, sessionToken != nil else { return }
        do {
            let me: MeResponse = try await APIClient.shared.get("/auth/me")
            guard me.loggedIn else { return }
            let updated = UserInfo(
                id: me.userId ?? currentUser?.id ?? "",
                username: me.username ?? currentUser?.username ?? "",
                display_name: me.display_name ?? currentUser?.display_name ?? "",
                role: me.role ?? currentUser?.role ?? "member",
                avatar_url: me.avatar_url
            )
            self.currentUser = updated
            KeychainHelper.saveCodable(updated, forKey: userKey)
        } catch APIClient.APIError.unauthorized {
            invalidateSession()
        } catch {
            // Offline/server failures leave the last known user available.
        }
    }

    // MARK: - Restore (used by Flickr OAuth login flow)

    func restoreSession(token: String, user: UserInfo, expiresAt: String? = nil) {
        storeSession(token: token, user: user, expiresAt: expiresAt)
    }

    /// Update stored user info without changing the session token (e.g. after avatar change)
    func restoreUser(_ user: UserInfo) {
        self.currentUser = user
        KeychainHelper.saveCodable(user, forKey: userKey)
    }

    // MARK: - Logout

    func logout() {
        clearStoredSession()
        Analytics.reset()
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
