import Foundation

/// Client for the Kindred backend API
actor APIClient {
    static let shared = APIClient()

    private var baseURL = "https://api.kindredphotos.app"
    /// Session token for authenticated requests
    private var sessionToken: String?
    private let session = URLSession.shared
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    private init() {
        Self.publicBaseURL = baseURL
        // Load session token from Keychain on init
        if let token = KeychainHelper.loadString(forKey: "kindred_session_token") {
            self.sessionToken = token
            Self.publicSessionToken = token
        }
    }

    func setSessionToken(_ token: String?) {
        self.sessionToken = token
        Self.publicSessionToken = token
    }

    func currentSessionToken() -> String? { sessionToken }
    func currentBaseURL() -> String { baseURL }

    /// Synchronously accessible base URL for constructing image proxy URLs
    nonisolated(unsafe) static var publicBaseURL: String = ""

    /// Synchronously accessible session token. AsyncImage and AVPlayer both
    /// fetch outside this actor and cannot set a header, so signed media URLs
    /// carry the token as a query item instead.
    nonisolated(unsafe) static var publicSessionToken: String?

    func setBaseURL(_ url: String) {
        self.baseURL = url
        Self.publicBaseURL = url
    }

    // MARK: - Generic Request (authenticated)

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIError.invalidURL
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 30

        if let token = sessionToken {
            req.setValue(token, forHTTPHeaderField: "X-Session-Token")
        }

        if let body = body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await session.data(for: req)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode == 401 {
            NotificationCenter.default.post(name: .kindredSessionUnauthorized, object: nil)
            throw APIError.unauthorized
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(httpResponse.statusCode)
        }

        return try decoder.decode(T.self, from: data)
    }

    // MARK: - Public request (no auth required, used for login/register)

    func postPublic<B: Encodable, R: Decodable>(_ path: String, body: B) async throws -> R {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.httpBody = try JSONEncoder().encode(body)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 30

        let (data, response) = try await session.data(for: req)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(httpResponse.statusCode)
        }
        return try decoder.decode(R.self, from: data)
    }

    func postJSON<B: Encodable, R: Decodable>(_ path: String, body: B) async throws -> R {
        let data = try JSONEncoder().encode(body)
        return try await request(path, method: "POST", body: data)
    }

    func postJSONNoResponse<B: Encodable>(_ path: String, body: B) async throws {
        let data = try JSONEncoder().encode(body)
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.httpBody = data
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 30

        if let token = sessionToken {
            req.setValue(token, forHTTPHeaderField: "X-Session-Token")
        }

        let (_, response) = try await session.data(for: req)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if httpResponse.statusCode == 401 {
            NotificationCenter.default.post(name: .kindredSessionUnauthorized, object: nil)
            throw APIError.unauthorized
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(httpResponse.statusCode)
        }
    }

    // MARK: - Generic GET

    func get<T: Decodable>(_ path: String) async throws -> T {
        try await request(path)
    }

    // MARK: - Health

    func healthCheck() async throws -> HealthResponse {
        try await request("/health")
    }

    // MARK: - Stats

    func getStats() async throws -> Stats {
        try await request("/stats")
    }

    // MARK: - Clusters

    func getClusterSummary(category: String) async throws -> ClustersSummaryResponse {
        try await request("/clusters/\(category)/summary")
    }

    func getClusterDetail(category: String, clusterId: String) async throws -> ClusterDetail {
        try await request("/clusters/\(category)/\(clusterId)")
    }

    func labelCluster(_ req: LabelRequest) async throws {
        try await postJSONNoResponse("/clusters/label", body: req)
    }

    func mergeClusters(_ req: MergeRequest) async throws {
        try await postJSONNoResponse("/clusters/merge", body: req)
    }

    func dismissCluster(_ req: DismissRequest) async throws {
        try await postJSONNoResponse("/clusters/dismiss", body: req)
    }

    func assignDetection(_ req: AssignRequest) async throws {
        try await postJSONNoResponse("/clusters/assign", body: req)
    }

    // MARK: - Search

    /// Legacy shape kept for the avatar picker. `/search` answers an envelope
    /// of catalog rows with no image URLs, so the media URLs are built here.
    func search(query: String, limit: Int = 50) async throws -> [SearchResult] {
        let response = try await searchLibrary(query: query, limit: limit)
        return response.results.map { hit in
            SearchResult(
                photo_id: hit.photo_id,
                distance: Float(hit.distance ?? 0),
                photo_url: Self.mediaURL(photoID: hit.photo_id, variant: .preview,
                                         baseURL: baseURL, token: sessionToken)?
                    .absoluteString ?? "",
                thumb_url: Self.mediaURL(photoID: hit.photo_id, variant: .thumb,
                                         baseURL: baseURL, token: sessionToken)?
                    .absoluteString,
                flickr_url: hit.flickr_url,
                photo_title: hit.photo_title,
                owner: nil,
                match_type: hit.match_type,
                match_name: hit.match_name,
                match_cluster_id: hit.match_cluster_id,
                match_category: hit.match_category
            )
        }
    }

    /// Signed media URL for the current session, from inside the actor.
    func mediaURL(photoID: String, variant: MediaVariant = .thumb) -> URL? {
        Self.mediaURL(photoID: photoID, variant: variant,
                      baseURL: baseURL, token: sessionToken)
    }

    /// A request with no body that still returns one — PUT/DELETE on favourites.
    func send<R: Decodable>(_ path: String, method: String) async throws -> R {
        try await request(path, method: method)
    }

    // MARK: - Explore

    func getScenes() async throws -> ScenesResponse {
        try await request("/scenes")
    }

    func getObjects() async throws -> ScenesResponse {
        try await request("/objects")
    }

    func getTimeline() async throws -> TimelineResponse {
        try await request("/timeline")
    }

    func getLocations() async throws -> LocationsResponse {
        try await request("/locations")
    }

    func getDuplicates(threshold: Float = 0.05) async throws -> DuplicatesResponse {
        try await request("/duplicates?threshold=\(threshold)")
    }

    // MARK: - Together (multi-person photo finder)

    func getPhotosTogether(clusterIds: [String], limit: Int = 100) async throws -> TogetherResponse {
        let ids = clusterIds.joined(separator: ",")
        let encoded = ids.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ids
        return try await request("/photos/together?people=\(encoded)&limit=\(limit)")
    }

    // MARK: - Photo Processing

    func processPhoto(photoId: String, url: String?) async throws {
        var body: [String: String] = ["photo_id": photoId]
        if let url = url { body["url"] = url }
        try await postJSONNoResponse("/process-photo", body: body)
    }

    // MARK: - Flickr Delete

    func flickrDelete(photoIds: [String]) async throws {
        try await postJSONNoResponse("/flickr/delete", body: FlickrDeleteRequest(photo_ids: photoIds))
    }

    // MARK: - Syncs / Jobs

    func getSyncs() async throws -> [SyncLog] {
        try await request("/syncs")
    }

    func getActiveJob() async throws -> ScanJob? {
        try await request("/jobs/active")
    }

    func triggerScan() async throws -> TriggerScanResponse {
        try await request("/scan/auto", method: "POST")
    }

    // MARK: - Avatar

    struct AvatarResponse: Codable {
        let ok: Bool
        let avatar_url: String?
    }

    func setAvatarFromPhoto(photoId: String) async throws -> AvatarResponse {
        let body = ["photo_id": photoId]
        let data = try JSONEncoder().encode(body)
        return try await request("/users/me/avatar", method: "PUT", body: data)
    }

    func uploadAvatar(imageData: Data) async throws -> AvatarResponse {
        guard let url = URL(string: "\(baseURL)/users/me/avatar") else {
            throw APIError.invalidURL
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 60

        if let token = sessionToken {
            req.setValue(token, forHTTPHeaderField: "X-Session-Token")
        }

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"avatar.jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body

        let (data, response) = try await session.data(for: req)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
        return try decoder.decode(AvatarResponse.self, from: data)
    }

    func deleteAvatar() async throws {
        guard let url = URL(string: "\(baseURL)/users/me/avatar") else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        req.timeoutInterval = 30
        if let token = sessionToken {
            req.setValue(token, forHTTPHeaderField: "X-Session-Token")
        }
        let (_, response) = try await session.data(for: req)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
    }

    /// Build a full authenticated URL for a user's avatar image
    func avatarImageURL(for avatarPath: String) -> URL? {
        guard var components = URLComponents(string: "\(baseURL)\(avatarPath)") else { return nil }
        if let token = sessionToken {
            var items = components.queryItems ?? []
            items.append(URLQueryItem(name: "session_token", value: token))
            components.queryItems = items
        }
        return components.url
    }

    // MARK: - Photo Upload (proxied through backend to Flickr)

    struct UploadResponse: Codable {
        let photo_id: String
        let status: String
        let kindred_photo_id: String?
        let nas_status: String?
        let flickr_status: String?
        let deduplicated: Bool?
    }

    struct BatchUploadResult: Codable {
        let filename: String?
        let photo_id: String?
        let status: String
        let error: String?
    }

    struct BatchUploadResponse: Codable {
        let results: [BatchUploadResult]
        let uploaded: Int
        let failed: Int
    }

    struct BackupStatus: Codable, Sendable {
        let flickr_photo_id: String
        let kindred_photo_id: String?
        let nas_status: String
        let flickr_status: String
        let cleanup_safe: Bool
    }

    struct BackupStatusResponse: Codable, Sendable {
        let items: [BackupStatus]
    }

    struct ResumableUploadRequest: Codable, Sendable {
        let client_upload_id: String
        let filename: String
        let content_type: String
        let byte_size: Int64
        let title: String
        let description: String
        let taken_at_unix: Int64?
        let latitude: Double?
        let longitude: Double?
    }

    struct ResumableUploadResponse: Codable, Sendable {
        let upload_id: String
        let status: String
        let next_offset: Int64
        let receipt: UploadReceipt?
    }

    func verifyBackupStatus(flickrPhotoIDs: [String]) async throws -> BackupStatusResponse {
        try await postJSON(
            "/photos/backup-status",
            body: ["flickr_photo_ids": flickrPhotoIDs]
        )
    }

    func startResumableUpload(
        _ upload: ResumableUploadRequest
    ) async throws -> ResumableUploadResponse {
        try await postJSON("/uploads/resumable", body: upload)
    }

    func uploadResumableChunk(
        uploadID: String,
        offset: Int64,
        data: Data
    ) async throws -> ResumableUploadResponse {
        guard var components = URLComponents(
            string: "\(baseURL)/uploads/resumable/\(uploadID)"
        ) else {
            throw APIError.invalidURL
        }
        components.queryItems = [URLQueryItem(name: "offset", value: String(offset))]
        guard let url = components.url else { throw APIError.invalidURL }

        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        req.httpBody = data
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 120
        if let token = sessionToken {
            req.setValue(token, forHTTPHeaderField: "X-Session-Token")
        }
        return try await performResumableRequest(req)
    }

    func completeResumableUpload(uploadID: String) async throws -> ResumableUploadResponse {
        guard let url = URL(
            string: "\(baseURL)/uploads/resumable/\(uploadID)/complete"
        ) else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 60
        if let token = sessionToken {
            req.setValue(token, forHTTPHeaderField: "X-Session-Token")
        }
        return try await performResumableRequest(req)
    }

    private func performResumableRequest(
        _ request: URLRequest
    ) async throws -> ResumableUploadResponse {
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if httpResponse.statusCode == 401 {
            NotificationCenter.default.post(name: .kindredSessionUnauthorized, object: nil)
            throw APIError.unauthorized
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(httpResponse.statusCode)
        }
        return try decoder.decode(ResumableUploadResponse.self, from: data)
    }

    /// Upload a single photo/video through the backend proxy to Flickr.
    /// Any authenticated household member can upload — the backend uses the admin's Flickr credentials.
    func uploadPhoto(data: Data, filename: String, title: String, description: String = "") async throws -> UploadResponse {
        guard let url = URL(string: "\(baseURL)/photos/upload") else {
            throw APIError.invalidURL
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 300  // 5 min for large files

        if let token = sessionToken {
            req.setValue(token, forHTTPHeaderField: "X-Session-Token")
        }

        var body = Data()

        // Title field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"title\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(title)\r\n".data(using: .utf8)!)

        // Description field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"description\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(description)\r\n".data(using: .utf8)!)

        // Photo file
        let contentType = mimeType(for: filename)
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"photo\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(contentType)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        req.httpBody = body

        let (responseData, response) = try await session.data(for: req)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if httpResponse.statusCode == 401 {
            NotificationCenter.default.post(name: .kindredSessionUnauthorized, object: nil)
            throw APIError.unauthorized
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(httpResponse.statusCode)
        }
        return try decoder.decode(UploadResponse.self, from: responseData)
    }

    private func mimeType(for filename: String) -> String {
        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        case "heic", "heif": return "image/heic"
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "mov": return "video/quicktime"
        case "mp4", "m4v": return "video/mp4"
        default: return "application/octet-stream"
        }
    }

    // MARK: - Errors

    enum APIError: LocalizedError {
        case invalidURL
        case invalidResponse
        case unauthorized
        case httpError(Int)

        var errorDescription: String? {
            switch self {
            case .invalidURL: return "Invalid URL"
            case .invalidResponse: return "Invalid response from server"
            case .unauthorized: return "Your session expired. Please sign in again."
            case .httpError(let code): return "HTTP error \(code)"
            }
        }

        var isRetryable: Bool {
            switch self {
            case .invalidResponse:
                return true
            case .httpError(let code):
                return code == 408 || code == 409 || code == 425
                    || code == 429 || code >= 500
            case .invalidURL, .unauthorized:
                return false
            }
        }
    }
}
