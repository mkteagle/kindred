import Foundation
import CryptoKit
import Security

struct BackupAccount: Codable {
    let server: String
    let userID: String
    let token: String
    var scope: String { digest(Data((server + "|" + userID).utf8)) }
}

func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func fileDigest(_ url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var value = SHA256()
    while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { value.update(data: data) }
    return value.finalize().map { String(format: "%02x", $0) }.joined()
}

struct BackupResource: Codable {
    let key: String
    let filename: String
    let media_type: String
    let byte_size: Int64
    let sha256: String
    let is_primary: Bool
    var id: String?
    var received_bytes: Int64?
    var filePath: String?
}
struct BackupManifest: Codable {
    let id: String
    let revision: String
    let resources: [BackupResource]
    let state: String
    let verified_at: Double?
    let verification_id: String?
}
struct VerificationJob: Decodable { let verification_id: String; let state: String }
struct ResourceOffset: Decodable { let received_bytes: Int64 }

enum BackupPhase: String, Codable { case pending, preparing, uploading, verifying, verified, failed, deleted }
struct BackupRecord: Codable, Identifiable {
    let id: String
    let scope: String
    let assetID: String
    let revision: String
    let albums: [String]
    let createdAt: Double?
    var phase: BackupPhase = .pending
    var resources: [BackupResource] = []
    var serverID: String?
    var error: String?
    var updatedAt = Date()
    var bytes: Int64 { resources.reduce(0) { $0 + $1.byte_size } }
    func validate(_ manifest: BackupManifest) throws {
        guard manifest.revision == revision, !resources.isEmpty, manifest.resources.count == resources.count else {
            throw BackupFailure("The NAS receipt does not include every original resource.")
        }
        for expected in resources {
            guard let received = manifest.resources.first(where: { $0.key == expected.key }),
                  received.sha256 == expected.sha256, received.byte_size == expected.byte_size,
                  received.is_primary == expected.is_primary, received.id != nil else {
                throw BackupFailure("The NAS receipt does not match the original files.")
            }
        }
    }
    func canReviewForCleanup(scope: String, revision: String) -> Bool {
        phase == .verified && self.scope == scope && self.revision == revision &&
        serverID != nil && !resources.isEmpty && resources.allSatisfy { $0.id != nil && $0.byte_size > 0 }
    }
}
struct BackupFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

@MainActor
final class BackupStore {
    static let shared = BackupStore()
    let root: URL
    var records: [String: BackupRecord] = [:]
    init(root: URL? = nil) {
        let base = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("KindredBackup")
        self.root = base
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var excluded = base; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? excluded.setResourceValues(values)
        let enumerator = FileManager.default.enumerator(at: base, includingPropertiesForKeys: nil)
        while let url = enumerator?.nextObject() as? URL {
            guard url.pathExtension == "json", let data = try? Data(contentsOf: url),
                  let record = try? JSONDecoder().decode(BackupRecord.self, from: data) else { continue }
            records[record.id] = record
        }
    }
    func save(_ record: BackupRecord) throws {
        let directory = root.appendingPathComponent(String(record.id.prefix(2)))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(record).write(to: directory.appendingPathComponent(record.id + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        records[record.id] = record
    }
    func directory(_ recordID: String) throws -> URL {
        let url = root.appendingPathComponent("staging").appendingPathComponent(recordID)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return url
    }
    func discardStaging(_ recordID: String) { try? FileManager.default.removeItem(at: root.appendingPathComponent("staging").appendingPathComponent(recordID)) }
}

enum BackupKeychain {
    static let service = "com.kindlingsignal.kindredbackup"
    static func load() -> BackupAccount? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                  kSecAttrAccount as String: "account", kSecReturnData as String: true]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(BackupAccount.self, from: data)
    }
    static func save(_ account: BackupAccount?) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "account"]
        SecItemDelete(query as CFDictionary)
        guard let account else { return }
        var value = query
        value[kSecValueData as String] = try JSONEncoder().encode(account)
        value[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(value as CFDictionary, nil) == errSecSuccess else { throw BackupFailure("Could not save your server sign-in securely.") }
    }
}

enum BackupAPI {
    static func request<T: Decodable>(_ account: BackupAccount, _ path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        guard let url = URL(string: account.server + path) else { throw BackupFailure("The server address is invalid.") }
        var request = URLRequest(url: url); request.httpMethod = method; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(account.token, forHTTPHeaderField: "X-Session-Token")
        request.timeoutInterval = 60
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            let detail = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["detail"] as? String
            throw BackupFailure(detail ?? "The server could not complete the request. Your Photos originals are unchanged.")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
