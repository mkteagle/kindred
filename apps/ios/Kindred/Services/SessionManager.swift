import Foundation

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
}

struct SessionInfo: Codable {
    let token: String
    let expires_at: String
}

/// Manages household account sessions (username/password auth).
@Observable
final class SessionManager {
    static let shared = SessionManager()

    private(set) var isAuthenticated = false
    private(set) var currentUser: UserInfo?
    private(set) var sessionToken: String?

    private let tokenKey = "kindred_session_token"
    private let userKey = "kindred_session_user"

    private init() {
        loadStoredSession()
    }

    // MARK: - Session Persistence

    private func loadStoredSession() {
        if let token = KeychainHelper.loadString(forKey: tokenKey) {
            self.sessionToken = token
            self.isAuthenticated = true
            if let user: UserInfo = KeychainHelper.loadCodable(forKey: userKey) {
                self.currentUser = user
            }
        }
    }

    private func storeSession(token: String, user: UserInfo) {
        self.sessionToken = token
        self.currentUser = user
        self.isAuthenticated = true
        KeychainHelper.saveString(token, forKey: tokenKey)
        KeychainHelper.saveCodable(user, forKey: userKey)
    }

    // MARK: - Login

    func login(username: String, password: String) async throws {
        let body = ["username": username, "password": password]
        let response: AuthResponse = try await APIClient.shared.postPublic("/auth/login", body: body)
        await MainActor.run {
            storeSession(token: response.session.token, user: response.user)
        }
        await APIClient.shared.setSessionToken(response.session.token)
        Analytics.identify(userId: response.user.id, properties: [
            "username": response.user.username,
            "role": response.user.role,
        ])
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
        await MainActor.run {
            storeSession(token: response.session.token, user: response.user)
        }
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
            await MainActor.run {
                self.currentUser = updated
                KeychainHelper.saveCodable(updated, forKey: userKey)
            }
        } catch {
            // Silently fail — user data will be stale but functional
        }
    }

    // MARK: - Restore (used by Flickr OAuth login flow)

    func restoreSession(token: String, user: UserInfo) {
        storeSession(token: token, user: user)
    }

    /// Update stored user info without changing the session token (e.g. after avatar change)
    func restoreUser(_ user: UserInfo) {
        self.currentUser = user
        KeychainHelper.saveCodable(user, forKey: userKey)
    }

    // MARK: - Logout

    func logout() {
        sessionToken = nil
        currentUser = nil
        isAuthenticated = false
        KeychainHelper.delete(key: tokenKey)
        KeychainHelper.delete(key: userKey)
        Analytics.reset()
        Task {
            await APIClient.shared.setSessionToken(nil)
        }
    }
}
