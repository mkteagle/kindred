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
        // Load session token from Keychain on init
        if let token = KeychainHelper.loadString(forKey: "kindred_session_token") {
            self.sessionToken = token
        }
    }

    func setSessionToken(_ token: String?) {
        self.sessionToken = token
    }

    func setBaseURL(_ url: String) {
        self.baseURL = url
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
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
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

    func search(query: String, limit: Int = 50) async throws -> [SearchResult] {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        return try await request("/search?q=\(encoded)&limit=\(limit)")
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

    // MARK: - Errors

    enum APIError: LocalizedError {
        case invalidURL
        case invalidResponse
        case httpError(Int)

        var errorDescription: String? {
            switch self {
            case .invalidURL: return "Invalid URL"
            case .invalidResponse: return "Invalid response from server"
            case .httpError(let code): return "HTTP error \(code)"
            }
        }
    }
}
