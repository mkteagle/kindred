import Foundation

struct UserInfo: Codable {
    let id: String
    let username: String
    let display_name: String
    let role: String
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

    // MARK: - Logout

    func logout() {
        sessionToken = nil
        currentUser = nil
        isAuthenticated = false
        KeychainHelper.delete(key: tokenKey)
        KeychainHelper.delete(key: userKey)
        Task {
            await APIClient.shared.setSessionToken(nil)
        }
    }
}
