import Foundation

struct UploadReceipt: Codable, Sendable {
    let photo_id: String
    let status: String
    let kindred_photo_id: String?
    let nas_status: String?
    let flickr_status: String?
    let deduplicated: Bool?
}

enum BackgroundUploadError: LocalizedError, Sendable {
    case invalidResponse
    case http(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Kindred returned an unreadable upload response."
        case let .http(status, message):
            if status == 401 { return "Your session expired. Please sign in again." }
            if status == 413 { return "This item is larger than the server allows." }
            return message.isEmpty ? "Upload failed (HTTP \(status))." : message
        }
    }

    var isRetryable: Bool {
        switch self {
        case .invalidResponse:
            return true
        case let .http(status, _):
            return status == 408 || status == 429 || status >= 500
        }
    }
}

/// Owns the background URLSession used by every manual and automatic upload.
/// Request bodies live on disk, and task metadata survives process termination.
final class BackgroundUploadSession: NSObject, @unchecked Sendable {
    static let shared = BackgroundUploadSession()
    static let sessionIdentifier = "com.kindlingsignal.kindred.upload"

    private let metadataKey = "kindred_bg_upload_tasks_v2"
    private let lock = NSLock()
    private let completionWork = DispatchGroup()

    private var completionHandler: (() -> Void)?
    var backgroundCompletionHandler: (() -> Void)? {
        get { lock.withLock { completionHandler } }
        set { lock.withLock { completionHandler = newValue } }
    }

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.httpMaximumConnectionsPerHost = 1
        config.waitsForConnectivity = true

        let delegateQueue = OperationQueue()
        delegateQueue.name = "com.kindlingsignal.kindred.upload.delegate"
        delegateQueue.maxConcurrentOperationCount = 1
        return URLSession(configuration: config, delegate: self, delegateQueue: delegateQueue)
    }()

    private var continuations: [Int: CheckedContinuation<UploadReceipt, Error>] = [:]
    private var responseBuffers: [Int: Data] = [:]
    private var taskMeta: [String: TaskMeta] = [:]

    struct TaskMeta: Codable, Sendable {
        let localIdentifier: String
        let filename: String
        let bodyFilePath: String
        let accountID: String
    }

    override private init() {
        super.init()
        loadTaskMeta()
        _ = session
    }

    func upload(
        request: URLRequest,
        bodyFileURL: URL,
        localIdentifier: String,
        filename: String,
        accountID: String
    ) async throws -> UploadReceipt {
        let task = session.uploadTask(with: request, fromFile: bodyFileURL)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let meta = TaskMeta(
                    localIdentifier: localIdentifier,
                    filename: filename,
                    bodyFilePath: bodyFileURL.path,
                    accountID: accountID
                )
                lock.withLock {
                    continuations[task.taskIdentifier] = continuation
                    responseBuffers[task.taskIdentifier] = Data()
                    taskMeta[String(task.taskIdentifier)] = meta
                    saveTaskMetaLocked()
                }
                if Task.isCancelled {
                    task.cancel()
                } else {
                    task.resume()
                }
            }
        } onCancel: {
            task.cancel()
        }
    }

    func activeLocalIdentifiers() async -> Set<String> {
        let tasks = await session.allTasks
        let ids = Set(tasks.map { String($0.taskIdentifier) })
        return lock.withLock {
            Set(ids.compactMap { taskMeta[$0]?.localIdentifier })
        }
    }

    private func loadTaskMeta() {
        guard let data = UserDefaults.standard.data(forKey: metadataKey),
              let decoded = try? JSONDecoder().decode([String: TaskMeta].self, from: data) else {
            return
        }
        taskMeta = decoded
    }

    private func saveTaskMetaLocked() {
        guard let data = try? JSONEncoder().encode(taskMeta) else { return }
        UserDefaults.standard.set(data, forKey: metadataKey)
    }

    private static func serverMessage(from data: Data) -> String {
        guard !data.isEmpty else { return "" }
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let detail = json["detail"] as? String {
            return detail
        }
        return String(data: data.prefix(500), encoding: .utf8) ?? ""
    }

    private func persistFailure(_ meta: TaskMeta?, error: String) {
        guard let meta else { return }
        completionWork.enter()
        Task {
            await UploadQueueStore.shared.markFailed(
                meta.localIdentifier,
                accountID: meta.accountID,
                error: error
            )
            completionWork.leave()
        }
    }

    private func persistSuccess(_ meta: TaskMeta?, receipt: UploadReceipt) {
        guard let meta else { return }
        completionWork.enter()
        Task { @MainActor in
            PhotoLibraryManager.shared.markAsUploaded(
                localIdentifier: meta.localIdentifier,
                flickrPhotoId: receipt.photo_id,
                kindredPhotoId: receipt.kindred_photo_id,
                nasStatus: receipt.nas_status,
                flickrStatus: receipt.flickr_status,
                accountID: meta.accountID
            )
            await UploadQueueStore.shared.markSucceeded(
                meta.localIdentifier,
                accountID: meta.accountID,
                receipt: receipt
            )
            completionWork.leave()
        }
    }
}

extension BackgroundUploadSession: URLSessionDelegate {
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        completionWork.notify(queue: .main) {
            self.backgroundCompletionHandler?()
            self.backgroundCompletionHandler = nil
        }
    }
}

extension BackgroundUploadSession: URLSessionDataDelegate {
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.withLock {
            responseBuffers[dataTask.taskIdentifier, default: Data()].append(data)
        }
    }
}

extension BackgroundUploadSession: URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let id = task.taskIdentifier
        let result = lock.withLock { () -> (Data, TaskMeta?, CheckedContinuation<UploadReceipt, Error>?) in
            let data = responseBuffers.removeValue(forKey: id) ?? Data()
            let meta = taskMeta.removeValue(forKey: String(id))
            let continuation = continuations.removeValue(forKey: id)
            saveTaskMetaLocked()
            return (data, meta, continuation)
        }

        if let path = result.1?.bodyFilePath {
            try? FileManager.default.removeItem(at: URL(fileURLWithPath: path))
        }

        if let error {
            if result.2 == nil { persistFailure(result.1, error: error.localizedDescription) }
            result.2?.resume(throwing: error)
            return
        }

        guard let http = task.response as? HTTPURLResponse else {
            if result.2 == nil {
                persistFailure(result.1, error: BackgroundUploadError.invalidResponse.localizedDescription)
            }
            result.2?.resume(throwing: BackgroundUploadError.invalidResponse)
            return
        }

        guard (200...299).contains(http.statusCode) else {
            let uploadError = BackgroundUploadError.http(
                status: http.statusCode,
                message: Self.serverMessage(from: result.0)
            )
            if http.statusCode == 401 {
                NotificationCenter.default.post(name: .kindredSessionUnauthorized, object: nil)
            }
            if result.2 == nil { persistFailure(result.1, error: uploadError.localizedDescription) }
            result.2?.resume(throwing: uploadError)
            return
        }

        guard let receipt = try? JSONDecoder().decode(UploadReceipt.self, from: result.0) else {
            if result.2 == nil {
                persistFailure(result.1, error: BackgroundUploadError.invalidResponse.localizedDescription)
            }
            result.2?.resume(throwing: BackgroundUploadError.invalidResponse)
            return
        }

        if result.2 == nil { persistSuccess(result.1, receipt: receipt) }
        result.2?.resume(returning: receipt)
    }
}
