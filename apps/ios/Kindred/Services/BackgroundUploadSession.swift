import Foundation

/// Manages a background URLSession for photo uploads to the Kindred backend.
/// Uploads survive the app being suspended — iOS transfers them in the background
/// and wakes the app via AppDelegate.handleEventsForBackgroundURLSession when done.
final class BackgroundUploadSession: NSObject {
    static let shared = BackgroundUploadSession()
    static let sessionIdentifier = "com.kindlingsignal.kindred.upload"

    private let metadataKey = "kindred_bg_upload_tasks"

    /// Called by AppDelegate after all background events are delivered.
    var backgroundCompletionHandler: (() -> Void)?

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.httpMaximumConnectionsPerHost = 3
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    // Continuations for tasks started in the current process lifetime
    private var continuations: [Int: CheckedContinuation<String, Error>] = [:]
    // Accumulated response body per task
    private var responseBuffers: [Int: Data] = [:]
    // Persisted metadata so we can mark uploads done after a kill+relaunch
    // [taskIdentifier (as String): TaskMeta]
    private var taskMeta: [String: TaskMeta] = [:]

    struct TaskMeta: Codable {
        let localIdentifier: String  // PHAsset.localIdentifier
        let filename: String
    }

    override private init() {
        super.init()
        loadTaskMeta()
        // Touch the session to register the delegate — this drains any pending
        // background events from a previous process run.
        _ = session
    }

    // MARK: - Public API

    /// Enqueue a background upload. Returns the Flickr photo_id on success.
    /// If the app is suspended mid-upload, iOS finishes the transfer and the
    /// result is delivered via the delegate when the app next runs.
    func upload(
        request: URLRequest,
        body: Data,
        localIdentifier: String,
        filename: String
    ) async throws -> String {
        let fileURL = try writeTempFile(body, filename: filename)

        return try await withCheckedThrowingContinuation { continuation in
            let task = session.uploadTask(with: request, fromFile: fileURL)
            let key = String(task.taskIdentifier)
            continuations[task.taskIdentifier] = continuation
            responseBuffers[task.taskIdentifier] = Data()
            taskMeta[key] = TaskMeta(localIdentifier: localIdentifier, filename: filename)
            saveTaskMeta()
            task.resume()
        }
    }

    // MARK: - Temp file

    private func writeTempFile(_ data: Data, filename: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("kindred_uploads", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(UUID().uuidString + "_" + filename)
        try data.write(to: url)
        return url
    }

    // MARK: - Task metadata persistence

    private func loadTaskMeta() {
        guard let data = UserDefaults.standard.data(forKey: metadataKey),
              let decoded = try? JSONDecoder().decode([String: TaskMeta].self, from: data) else { return }
        taskMeta = decoded
    }

    private func saveTaskMeta() {
        guard let data = try? JSONEncoder().encode(taskMeta) else { return }
        UserDefaults.standard.set(data, forKey: metadataKey)
    }
}

// MARK: - URLSessionDelegate

extension BackgroundUploadSession: URLSessionDelegate {
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.backgroundCompletionHandler?()
            self.backgroundCompletionHandler = nil
        }
    }
}

// MARK: - URLSessionDataDelegate

extension BackgroundUploadSession: URLSessionDataDelegate {
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        responseBuffers[dataTask.taskIdentifier, default: Data()].append(data)
    }
}

// MARK: - URLSessionTaskDelegate

extension BackgroundUploadSession: URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let id = task.taskIdentifier
        let key = String(id)
        let data = responseBuffers.removeValue(forKey: id) ?? Data()
        let meta = taskMeta.removeValue(forKey: key)
        saveTaskMeta()

        // Clean up temp file
        if let upload = task as? URLSessionUploadTask,
           let originalRequest = task.originalRequest,
           let fileURL = originalRequest.url {
            // The file URL is stored in the task; best-effort delete
            _ = try? FileManager.default.removeItem(at: fileURL)
        }

        let continuation = continuations.removeValue(forKey: id)

        if let error {
            continuation?.resume(throwing: error)
            return
        }

        guard let http = task.response as? HTTPURLResponse,
              (200...299).contains(http.statusCode) else {
            let code = (task.response as? HTTPURLResponse)?.statusCode ?? 0
            continuation?.resume(throwing: URLError(.badServerResponse))
            return
        }

        struct UploadResponse: Decodable { let photo_id: String }
        guard let response = try? JSONDecoder().decode(UploadResponse.self, from: data) else {
            continuation?.resume(throwing: URLError(.cannotParseResponse))
            return
        }

        if let continuation {
            continuation.resume(returning: response.photo_id)
        } else if let meta {
            // App was killed while upload was in flight — mark it done now
            PhotoLibraryManager.shared.markAsUploaded(
                localIdentifier: meta.localIdentifier,
                flickrPhotoId: response.photo_id
            )
        }
    }
}
