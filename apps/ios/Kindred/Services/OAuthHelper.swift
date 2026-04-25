import Foundation
import CommonCrypto

/// Manual OAuth 1.0a signing implementation using CommonCrypto HMAC-SHA1.
/// Flickr consumer key and secret are loaded from the backend /app-config endpoint.
enum OAuthHelper {
    /// Loaded from backend /app-config. Falls back to env defaults if backend
    /// hasn't been updated yet.
    static var consumerKey = ""
    static var consumerSecret = ""

    private static var configLoaded = false

    /// Fetch Flickr consumer credentials from the backend's /app-config endpoint.
    static func loadConfig(from baseURL: String) async {
        guard !configLoaded else { return }
        guard let url = URL(string: "\(baseURL)/app-config") else { return }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let flickr = json["flickr"] as? [String: Any] {
                consumerKey = flickr["consumer_key"] as? String ?? ""
                consumerSecret = flickr["consumer_secret"] as? String ?? ""
                configLoaded = true
            }
        } catch {
            print("[OAuthHelper] Failed to load config: \(error)")
        }
    }

    // MARK: - HMAC-SHA1

    static func hmacSHA1(key: String, message: String) -> String {
        let keyData = key.data(using: .utf8)!
        let messageData = message.data(using: .utf8)!
        var result = [UInt8](repeating: 0, count: Int(CC_SHA1_DIGEST_LENGTH))

        keyData.withUnsafeBytes { keyBytes in
            messageData.withUnsafeBytes { messageBytes in
                CCHmac(
                    CCHmacAlgorithm(kCCHmacAlgSHA1),
                    keyBytes.baseAddress, keyData.count,
                    messageBytes.baseAddress, messageData.count,
                    &result
                )
            }
        }
        return Data(result).base64EncodedString()
    }

    // MARK: - Percent Encoding (RFC 5849)

    static func percentEncode(_ string: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return string.addingPercentEncoding(withAllowedCharacters: allowed) ?? string
    }

    // MARK: - Nonce & Timestamp

    static func nonce() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "")
    }

    static func timestamp() -> String {
        String(Int(Date().timeIntervalSince1970))
    }

    // MARK: - Signature Base String

    static func signatureBaseString(
        httpMethod: String,
        url: String,
        params: [(String, String)]
    ) -> String {
        let sortedParams = params.sorted { $0.0 < $1.0 }
        let paramString = sortedParams
            .map { "\(percentEncode($0.0))=\(percentEncode($0.1))" }
            .joined(separator: "&")

        return [
            httpMethod.uppercased(),
            percentEncode(url),
            percentEncode(paramString),
        ].joined(separator: "&")
    }

    // MARK: - Signing Key

    static func signingKey(tokenSecret: String = "") -> String {
        "\(percentEncode(consumerSecret))&\(percentEncode(tokenSecret))"
    }

    // MARK: - Generate OAuth Parameters

    static func oauthParams(
        token: String? = nil,
        callback: String? = nil,
        verifier: String? = nil
    ) -> [(String, String)] {
        var params: [(String, String)] = [
            ("oauth_consumer_key", consumerKey),
            ("oauth_nonce", nonce()),
            ("oauth_signature_method", "HMAC-SHA1"),
            ("oauth_timestamp", timestamp()),
            ("oauth_version", "1.0"),
        ]
        if let token = token {
            params.append(("oauth_token", token))
        }
        if let callback = callback {
            params.append(("oauth_callback", callback))
        }
        if let verifier = verifier {
            params.append(("oauth_verifier", verifier))
        }
        return params
    }

    // MARK: - Build Authorization Header

    static func authorizationHeader(
        httpMethod: String,
        url: String,
        additionalParams: [(String, String)] = [],
        token: String? = nil,
        tokenSecret: String = "",
        callback: String? = nil,
        verifier: String? = nil
    ) -> String {
        var oauthParameters = oauthParams(token: token, callback: callback, verifier: verifier)

        let allParams = oauthParameters + additionalParams

        let baseString = signatureBaseString(
            httpMethod: httpMethod,
            url: url,
            params: allParams
        )

        let key = signingKey(tokenSecret: tokenSecret)
        let signature = hmacSHA1(key: key, message: baseString)

        oauthParameters.append(("oauth_signature", signature))

        let headerValue = oauthParameters
            .map { "\(percentEncode($0.0))=\"\(percentEncode($0.1))\"" }
            .joined(separator: ", ")

        return "OAuth \(headerValue)"
    }

    // MARK: - Parse OAuth Response

    static func parseQueryString(_ string: String) -> [String: String] {
        var result: [String: String] = [:]
        for pair in string.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1)
            if parts.count == 2 {
                let key = String(parts[0]).removingPercentEncoding ?? String(parts[0])
                let value = String(parts[1]).removingPercentEncoding ?? String(parts[1])
                result[key] = value
            }
        }
        return result
    }
}
