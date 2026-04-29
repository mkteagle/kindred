import Foundation
import Photos
import UniformTypeIdentifiers
import UIKit

/// Handles uploading photos and videos via the Kindred backend proxy.
/// The backend uses the household admin's Flickr OAuth credentials, so any
/// authenticated member can upload without their own Flickr account.
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

    override private init() {
        super.init()
    }

    // MARK: - Upload a Single Asset (photo or video)

    /// Upload raw file data via the Kindred backend, which proxies to Flickr
    /// using the household admin's credentials. Any member can upload.
    func uploadData(_ data: Data, filename: String, contentType: String, title: String, description: String = "") async throws -> String {
        let response = try await APIClient.shared.uploadPhoto(
            data: data,
            filename: filename,
            title: title,
            description: description
        )
        return response.photo_id
    }

    // MARK: - Batch Upload from Photo Library

    func uploadAssets(_ assets: [PHAsset]) async {
        await MainActor.run {
            isUploading = true
            totalCount = assets.count
            uploadedCount = 0
            totalProgress = 0
            lastError = nil
        }

        print("[FlickrUploader] Starting upload of \(assets.count) assets")

        // Filter out already-uploaded assets
        let toUpload = assets.filter { !PhotoLibraryManager.shared.isUploaded(localIdentifier: $0.localIdentifier) }

        await MainActor.run {
            totalCount = toUpload.count
        }

        print("[FlickrUploader] After filtering: \(toUpload.count) to upload (\(assets.count - toUpload.count) already uploaded)")

        if toUpload.isEmpty {
            print("[FlickrUploader] Nothing to upload — all assets already backed up")
            await MainActor.run { isUploading = false }
            return
        }

        var bgTaskId: UIBackgroundTaskIdentifier = .invalid
        bgTaskId = UIApplication.shared.beginBackgroundTask(withName: "kindred.upload") {
            UIApplication.shared.endBackgroundTask(bgTaskId)
            bgTaskId = .invalid
        }
        defer {
            if bgTaskId != .invalid {
                UIApplication.shared.endBackgroundTask(bgTaskId)
            }
        }

        await withTaskGroup(of: Void.self) { group in
            var inFlight = 0
            var pending = toUpload.enumerated().makeIterator()

            func addNext() {
                guard let (index, asset) = pending.next() else { return }
                inFlight += 1
                let mediaLabel = asset.mediaType == .video ? "Video" : "Photo"
                group.addTask {
                    defer {
                        Task { @MainActor in
                            self.totalProgress = Float(index + 1) / Float(toUpload.count)
                        }
                    }

                    if PhotoLibraryManager.shared.isUploaded(localIdentifier: asset.localIdentifier) {
                        await MainActor.run { self.uploadedCount += 1 }
                        return
                    }

                    do {
                        print("[FlickrUploader] Loading \(index + 1)/\(toUpload.count)...")
                        let (data, filename, contentType) = try await self.getOriginalAssetData(asset)
                        let title = asset.creationDate.map { self.formatDate($0) } ?? "\(mediaLabel) \(index + 1)"
                        let photoId = try await self.uploadData(data, filename: filename, contentType: contentType, title: title)
                        print("[FlickrUploader] Done \(index + 1), photo_id: \(photoId)")
                        PhotoLibraryManager.shared.markAsUploaded(localIdentifier: asset.localIdentifier, flickrPhotoId: photoId)
                        await MainActor.run { self.uploadedCount += 1 }
                    } catch {
                        print("[FlickrUploader] ERROR \(index + 1): \(error)")
                        await MainActor.run {
                            self.lastError = "Failed to upload \(mediaLabel.lowercased()) \(index + 1): \(error.localizedDescription)"
                        }
                    }
                }
            }

            for _ in 0..<min(3, toUpload.count) { addNext() }

            for await _ in group {
                inFlight -= 1
                addNext()
            }
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

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter.string(from: date)
    }

    enum UploadError: LocalizedError {
        case notAuthenticated
        case uploadFailed
        case noAssetData

        var errorDescription: String? {
            switch self {
            case .notAuthenticated: return "Not signed in"
            case .uploadFailed: return "Upload failed"
            case .noAssetData: return "Could not load asset data"
            }
        }
    }
}
