import Foundation
import Photos

/// Handles uploading photos to Flickr with OAuth-signed multipart requests.
/// Uses background URLSession for upload resilience.
@Observable
final class FlickrUploader: NSObject {
    static let shared = FlickrUploader()

    private(set) var isUploading = false
    private(set) var currentProgress: Float = 0
    private(set) var totalProgress: Float = 0
    private(set) var uploadedCount = 0
    private(set) var totalCount = 0
    private(set) var currentPhotoTitle: String = ""
    private(set) var lastError: String?

    private let uploadURL = "https://up.flickr.com/services/upload/"
    private var backgroundSession: URLSession!
    private var uploadContinuations: [String: CheckedContinuation<String, Error>] = [:]

    override private init() {
        super.init()
        let config = URLSessionConfiguration.background(withIdentifier: "com.kindlingsignal.kindred.upload")
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        backgroundSession = URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }

    // MARK: - Upload a Single Photo

    /// Upload image data to Flickr, returns the Flickr photo ID.
    func uploadPhoto(imageData: Data, title: String, description: String = "") async throws -> String {
        let auth = FlickrAuth.shared
        guard auth.isAuthenticated else {
            throw UploadError.notAuthenticated
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        let params: [(String, String)] = [
            ("title", title),
            ("description", description),
            ("is_public", "0"),
            ("is_friend", "0"),
            ("is_family", "0"),
        ]

        // OAuth signature excludes the photo data
        let header = OAuthHelper.authorizationHeader(
            httpMethod: "POST",
            url: uploadURL,
            additionalParams: params,
            token: auth.oauthToken,
            tokenSecret: auth.oauthTokenSecret
        )

        var body = Data()
        // Add text params
        for (key, value) in params {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        // Add photo
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"photo\"; filename=\"\(title).jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var request = URLRequest(url: URL(string: uploadURL)!)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(header, forHTTPHeaderField: "Authorization")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw UploadError.uploadFailed
        }

        // Parse XML response for photo ID
        let responseString = String(data: data, encoding: .utf8) ?? ""
        guard let photoId = parsePhotoId(from: responseString) else {
            throw UploadError.parseError
        }

        return photoId
    }

    // MARK: - Batch Upload from Photo Library

    func uploadAssets(_ assets: [PHAsset]) async {
        isUploading = true
        totalCount = assets.count
        uploadedCount = 0
        totalProgress = 0
        lastError = nil

        let imageManager = PHImageManager.default()
        let options = PHImageRequestOptions()
        options.isSynchronous = false
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true

        for (index, asset) in assets.enumerated() {
            currentPhotoTitle = "Photo \(index + 1) of \(assets.count)"
            currentProgress = 0

            do {
                let imageData = try await requestImageData(for: asset, manager: imageManager, options: options)

                let title = asset.creationDate.map { formatDate($0) } ?? "Photo \(index + 1)"
                let photoId = try await uploadPhoto(imageData: imageData, title: title)

                // Process with backend
                try await APIClient.shared.processPhoto(photoId: photoId, url: nil)

                // Mark as uploaded in local tracking
                PhotoLibraryManager.shared.markAsUploaded(localIdentifier: asset.localIdentifier, flickrPhotoId: photoId)

                uploadedCount += 1
            } catch {
                lastError = "Failed to upload photo \(index + 1): \(error.localizedDescription)"
            }

            totalProgress = Float(index + 1) / Float(assets.count)
        }

        isUploading = false
    }

    // MARK: - Helpers

    private func requestImageData(for asset: PHAsset, manager: PHImageManager, options: PHImageRequestOptions) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            manager.requestImageDataAndOrientation(for: asset, options: options) { data, _, _, _ in
                if let data = data {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: UploadError.noImageData)
                }
            }
        }
    }

    private func parsePhotoId(from xml: String) -> String? {
        // Flickr upload response: <photoid>12345</photoid>
        guard let startRange = xml.range(of: "<photoid>"),
              let endRange = xml.range(of: "</photoid>") else { return nil }
        return String(xml[startRange.upperBound..<endRange.lowerBound])
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter.string(from: date)
    }

    enum UploadError: LocalizedError {
        case notAuthenticated
        case uploadFailed
        case parseError
        case noImageData

        var errorDescription: String? {
            switch self {
            case .notAuthenticated: return "Not authenticated with Flickr"
            case .uploadFailed: return "Upload to Flickr failed"
            case .parseError: return "Could not parse upload response"
            case .noImageData: return "Could not load image data"
            }
        }
    }
}

// MARK: - URLSessionDelegate for background uploads

extension FlickrUploader: URLSessionDataDelegate {
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        Task { @MainActor in
            self.currentProgress = Float(totalBytesSent) / Float(totalBytesExpectedToSend)
        }
    }
}
