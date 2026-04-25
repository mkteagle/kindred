import Foundation
import Photos
import UniformTypeIdentifiers

/// Handles uploading photos and videos to Flickr with OAuth-signed multipart requests.
@Observable
final class FlickrUploader: NSObject {
    static let shared = FlickrUploader()

    private(set) var isUploading = false
    private(set) var currentProgress: Float = 0
    private(set) var totalProgress: Float = 0
    private(set) var uploadedCount = 0
    private(set) var totalCount = 0
    private(set) var currentAssetTitle: String = ""
    private(set) var lastError: String?

    private let uploadURL = "https://up.flickr.com/services/upload/"

    override private init() {
        super.init()
    }

    // MARK: - Upload a Single Asset (photo or video)

    /// Upload raw file data to Flickr. Returns the Flickr photo/video ID.
    func uploadData(_ data: Data, filename: String, contentType: String, title: String, description: String = "") async throws -> String {
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
            ("is_family", "1"),
        ]

        // OAuth signature excludes the file data
        let header = OAuthHelper.authorizationHeader(
            httpMethod: "POST",
            url: uploadURL,
            additionalParams: params,
            token: auth.oauthToken,
            tokenSecret: auth.oauthTokenSecret
        )

        var body = Data()
        for (key, value) in params {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"photo\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(contentType)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var request = URLRequest(url: URL(string: uploadURL)!)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(header, forHTTPHeaderField: "Authorization")
        request.httpBody = body
        // Videos can be large — extend timeout
        request.timeoutInterval = 300

        let (responseData, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let body = String(data: responseData, encoding: .utf8) ?? ""
            print("[FlickrUploader] Upload failed: \(body)")
            throw UploadError.uploadFailed
        }

        let responseString = String(data: responseData, encoding: .utf8) ?? ""
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

        for (index, asset) in assets.enumerated() {
            let mediaLabel = asset.mediaType == .video ? "Video" : "Photo"
            currentAssetTitle = "\(mediaLabel) \(index + 1) of \(assets.count)"
            currentProgress = 0

            do {
                let (data, filename, contentType) = try await getOriginalAssetData(asset)

                let title = asset.creationDate.map { formatDate($0) } ?? "\(mediaLabel) \(index + 1)"
                let photoId = try await uploadData(data, filename: filename, contentType: contentType, title: title)

                // Process with backend (face/object detection + clustering)
                if asset.mediaType == .image {
                    try await APIClient.shared.processPhoto(photoId: photoId, url: nil)
                }

                PhotoLibraryManager.shared.markAsUploaded(localIdentifier: asset.localIdentifier, flickrPhotoId: photoId)
                uploadedCount += 1
            } catch {
                lastError = "Failed to upload \(mediaLabel.lowercased()) \(index + 1): \(error.localizedDescription)"
            }

            totalProgress = Float(index + 1) / Float(assets.count)
        }

        isUploading = false
    }

    // MARK: - Get Original Asset Data

    /// Fetches the original, unmodified file data from the photo library.
    /// Returns (data, filename, mimeType).
    private func getOriginalAssetData(_ asset: PHAsset) async throws -> (Data, String, String) {
        let resources = PHAssetResource.assetResources(for: asset)

        // Pick the best resource: prefer original, then current
        let resource: PHAssetResource
        if asset.mediaType == .video {
            resource = resources.first(where: { $0.type == .video })
                ?? resources.first(where: { $0.type == .fullSizeVideo })
                ?? resources.first!
        } else {
            resource = resources.first(where: { $0.type == .photo })
                ?? resources.first(where: { $0.type == .fullSizePhoto })
                ?? resources.first!
        }

        let filename = resource.originalFilename
        let uti = resource.uniformTypeIdentifier
        let contentType = UTType(uti)?.preferredMIMEType ?? mimeTypeFromFilename(filename)

        let data = try await loadResourceData(resource)
        return (data, filename, contentType)
    }

    private func loadResourceData(_ resource: PHAssetResource) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            var buffer = Data()
            let options = PHAssetResourceRequestOptions()
            options.isNetworkAccessAllowed = true

            PHAssetResourceManager.default().requestData(for: resource, options: options) { chunk in
                buffer.append(chunk)
            } completionHandler: { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: buffer)
                }
            }
        }
    }

    private func mimeTypeFromFilename(_ filename: String) -> String {
        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        case "heic", "heif": return "image/heic"
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "mov": return "video/quicktime"
        case "mp4", "m4v": return "video/mp4"
        case "avi": return "video/avi"
        default: return "application/octet-stream"
        }
    }

    // MARK: - Helpers

    private func parsePhotoId(from xml: String) -> String? {
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
        case noAssetData

        var errorDescription: String? {
            switch self {
            case .notAuthenticated: return "Not authenticated with Flickr"
            case .uploadFailed: return "Upload to Flickr failed"
            case .parseError: return "Could not parse upload response"
            case .noAssetData: return "Could not load asset data"
            }
        }
    }
}
