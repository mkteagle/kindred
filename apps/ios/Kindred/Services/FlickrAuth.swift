import Foundation
import UIKit
import AuthenticationServices

/// Manages Flickr OAuth 1.0a authentication flow using ASWebAuthenticationSession.
/// Tokens are stored in the Keychain.
@Observable
final class FlickrAuth {
    static let shared = FlickrAuth()

    private(set) var isAuthenticated = false
    private(set) var user: FlickrUser?
    private(set) var oauthToken: String = ""
    private(set) var oauthTokenSecret: String = ""

    private let requestTokenURL = "https://www.flickr.com/services/oauth/request_token"
    private let authorizeURL = "https://www.flickr.com/services/oauth/authorize"
    private let accessTokenURL = "https://www.flickr.com/services/oauth/access_token"
    private let callbackScheme = "kindred"
    private let callbackURL = "kindred://oauth-callback"
    private var authSession: ASWebAuthenticationSession?

    private let tokenKey = "flickr_oauth_token"
    private let tokenSecretKey = "flickr_oauth_token_secret"
    private let userKey = "flickr_user"

    private init() {
        loadStoredTokens()
    }

    // MARK: - Token Persistence

    private func loadStoredTokens() {
        if let token = KeychainHelper.loadString(forKey: tokenKey),
           let secret = KeychainHelper.loadString(forKey: tokenSecretKey) {
            self.oauthToken = token
            self.oauthTokenSecret = secret
            self.isAuthenticated = true
            if let user: FlickrUser = KeychainHelper.loadCodable(forKey: userKey) {
                self.user = user
            }
        }
    }

    private func storeTokens() {
        KeychainHelper.saveString(oauthToken, forKey: tokenKey)
        KeychainHelper.saveString(oauthTokenSecret, forKey: tokenSecretKey)
        if let user = user {
            KeychainHelper.saveCodable(user, forKey: userKey)
        }
    }

    // MARK: - OAuth Flow

    /// Start the full OAuth 1.0a flow. Call from a view that can present ASWebAuthenticationSession.
    @MainActor
    func authenticate() async throws {
        // Ensure Flickr consumer credentials are loaded from backend
        if OAuthHelper.consumerKey.isEmpty {
            await OAuthHelper.loadConfig(from: "https://api.kindredphotos.app")
        }
        guard !OAuthHelper.consumerKey.isEmpty else {
            throw AuthError.requestTokenFailed
        }

        // Step 1: Get request token
        print("[FlickrAuth] Starting authentication...")
        let requestTokenResponse: [String: String]
        do {
            requestTokenResponse = try await getRequestToken()
            print("[FlickrAuth] Got request token: \(requestTokenResponse)")
        } catch {
            print("[FlickrAuth] Request token FAILED: \(error)")
            throw error
        }
        guard let tempToken = requestTokenResponse["oauth_token"],
              let tempSecret = requestTokenResponse["oauth_token_secret"] else {
            print("[FlickrAuth] Missing oauth_token in response: \(requestTokenResponse)")
            throw AuthError.missingRequestToken
        }

        // Step 2: Authorize in browser
        print("[FlickrAuth] Opening browser for authorization...")
        let verifier: String
        do {
            verifier = try await authorizeInBrowser(requestToken: tempToken)
            print("[FlickrAuth] Got verifier: \(verifier)")
        } catch {
            print("[FlickrAuth] Browser auth FAILED: \(error)")
            throw error
        }

        // Step 3: Exchange for access token
        let accessTokenResponse = try await getAccessToken(
            requestToken: tempToken,
            requestTokenSecret: tempSecret,
            verifier: verifier
        )

        guard let accessToken = accessTokenResponse["oauth_token"],
              let accessSecret = accessTokenResponse["oauth_token_secret"] else {
            throw AuthError.missingAccessToken
        }

        self.oauthToken = accessToken
        self.oauthTokenSecret = accessSecret
        self.user = FlickrUser(
            userId: accessTokenResponse["user_nsid"] ?? "",
            username: accessTokenResponse["username"] ?? "",
            fullname: accessTokenResponse["fullname"] ?? ""
        )
        self.isAuthenticated = true
        storeTokens()
    }

    // MARK: - Step 1: Request Token

    private func getRequestToken() async throws -> [String: String] {
        let header = OAuthHelper.authorizationHeader(
            httpMethod: "GET",
            url: requestTokenURL,
            callback: callbackURL
        )

        var request = URLRequest(url: URL(string: "\(requestTokenURL)?oauth_callback=\(OAuthHelper.percentEncode(callbackURL))")!)
        request.setValue(header, forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw AuthError.requestTokenFailed
        }

        let body = String(data: data, encoding: .utf8) ?? ""
        return OAuthHelper.parseQueryString(body)
    }

    // MARK: - Step 2: Authorize in Browser

    // Pending continuation for the OAuth callback
    private var authContinuation: CheckedContinuation<String, Error>?

    @MainActor
    private func authorizeInBrowser(requestToken: String) async throws -> String {
        let authURL = URL(string: "\(authorizeURL)?oauth_token=\(requestToken)&perms=delete")!

        return try await withCheckedThrowingContinuation { continuation in
            self.authContinuation = continuation
            // Open Safari directly — the URL scheme handler catches the redirect
            UIApplication.shared.open(authURL)
        }
    }

    /// Call this from the app's URL handler when kindred://oauth-callback comes in
    @MainActor
    func handleCallback(url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let verifier = components.queryItems?.first(where: { $0.name == "oauth_verifier" })?.value else {
            authContinuation?.resume(throwing: AuthError.missingVerifier)
            authContinuation = nil
            return
        }
        authContinuation?.resume(returning: verifier)
        authContinuation = nil
    }

    // MARK: - Step 3: Access Token

    private func getAccessToken(
        requestToken: String,
        requestTokenSecret: String,
        verifier: String
    ) async throws -> [String: String] {
        let header = OAuthHelper.authorizationHeader(
            httpMethod: "GET",
            url: accessTokenURL,
            token: requestToken,
            tokenSecret: requestTokenSecret,
            verifier: verifier
        )

        var request = URLRequest(url: URL(string: accessTokenURL)!)
        request.setValue(header, forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw AuthError.accessTokenFailed
        }

        let body = String(data: data, encoding: .utf8) ?? ""
        return OAuthHelper.parseQueryString(body)
    }

    // MARK: - Logout

    func logout() {
        oauthToken = ""
        oauthTokenSecret = ""
        user = nil
        isAuthenticated = false
        KeychainHelper.delete(key: tokenKey)
        KeychainHelper.delete(key: tokenSecretKey)
        KeychainHelper.delete(key: userKey)
    }

    // MARK: - Errors

    enum AuthError: LocalizedError {
        case missingRequestToken
        case requestTokenFailed
        case missingVerifier
        case missingAccessToken
        case accessTokenFailed
        case sessionStartFailed

        var errorDescription: String? {
            switch self {
            case .missingRequestToken: return "Failed to get request token from Flickr."
            case .requestTokenFailed: return "Request token request failed."
            case .missingVerifier: return "Authorization was cancelled or failed."
            case .missingAccessToken: return "Failed to get access token from Flickr."
            case .sessionStartFailed: return "Could not start authentication session."
            case .accessTokenFailed: return "Access token request failed."
            }
        }
    }
}

// MARK: - Presentation Anchor Provider

private final class AnchorProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    let anchor: ASPresentationAnchor

    init(anchor: ASPresentationAnchor) {
        self.anchor = anchor
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchor
    }
}
