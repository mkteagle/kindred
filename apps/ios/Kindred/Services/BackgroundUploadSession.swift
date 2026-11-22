import Foundation

extension Notification.Name {
    static let backupBackgroundActivityChanged = Notification.Name("kindred.backupBackgroundActivityChanged")
}

struct UploadReceipt: Codable, Sendable {
    let photo_id: String?
    let status: String
    let kindred_photo_id: String?
    let nas_status: String?
    let flickr_status: String?
    let deduplicated: Bool?

    var hasNASOriginal: Bool { status == "ok" && nas_status == "available" && kindred_photo_id != nil }
}

enum BackgroundUploadError: LocalizedError, Sendable {
    case invalidResponse
    case nasOriginalUnconfirmed
    case http(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Kindred returned an unreadable upload response."
        case .nasOriginalUnconfirmed:
            return "The NAS did not confirm a saved original."
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
        case .nasOriginalUnconfirmed:
            return false
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
        config.httpMaximumConnectionsPerHost = 4
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 600

        let delegateQueue = OperationQueue()
        delegateQueue.name = "com.kindlingsignal.kindred.upload.delegate"
        delegateQueue.maxConcurrentOperationCount = 1
        return URLSession(configuration: config, delegate: self, delegateQueue: delegateQueue)
    }()

    private var continuations: [Int: CheckedContinuation<Data, Error>] = [:]
    private var progressObservers: [Int: ProgressObserver] = [:]
    private var responseBuffers: [Int: Data] = [:]
    private var taskMeta: [String: TaskMeta] = [:]

    private struct ProgressObserver {
        let update: @Sendable (Float) -> Void
        var lastBucket = 0
    }

    struct TaskMeta: Codable, Sendable {
        let localIdentifier: String
        let filename: String
        let bodyFilePath: String
        let accountID: String
        let attemptID: UUID?
        let isChunk: Bool?
        let submittedAt: Date?
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
        accountID: String,
        attemptID: UUID,
        onProgress: @escaping @Sendable (Float) -> Void
    ) async throws -> UploadReceipt {
        let data = try await transfer(
            request: request, bodyFileURL: bodyFileURL, localIdentifier: localIdentifier,
            filename: filename, accountID: accountID, attemptID: attemptID, isChunk: false,
            onProgress: onProgress
        )
        return try Self.receipt(from: data)
    }

    func uploadChunk(
        request: URLRequest,
        bodyFileURL: URL,
        localIdentifier: String,
        filename: String,
        accountID: String,
        attemptID: UUID
    ) async throws -> Data {
        try await transfer(
            request: request, bodyFileURL: bodyFileURL, localIdentifier: localIdentifier,
            filename: filename, accountID: accountID, attemptID: attemptID, isChunk: true
        )
    }

    private func transfer(
        request: URLRequest,
        bodyFileURL: URL,
        localIdentifier: String,
        filename: String,
        accountID: String,
        attemptID: UUID,
        isChunk: Bool,
        onProgress: (@Sendable (Float) -> Void)? = nil
    ) async throws -> Data {
        let task = session.uploadTask(with: request, fromFile: bodyFileURL)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let meta = TaskMeta(
                    localIdentifier: localIdentifier,
                    filename: filename,
                    bodyFilePath: bodyFileURL.path,
                    accountID: accountID,
                    attemptID: attemptID,
                    isChunk: isChunk,
                    submittedAt: Date()
                )
                lock.withLock {
                    continuations[task.taskIdentifier] = continuation
                    if let onProgress {
                        progressObservers[task.taskIdentifier] = ProgressObserver(update: onProgress)
                    }
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
            // iOS can end the app's execution window while the system transfer is active.
            // Leave the task and its metadata attached to the background session.
            let continuation = self.lock.withLock {
                self.continuations.removeValue(forKey: task.taskIdentifier)
            }
            continuation?.resume(throwing: CancellationError())
        }
    }

    func activeLocalIdentifiers(accountID: String) async -> Set<String> {
        let tasks = await session.allTasks
        let ids = Set(tasks.map { String($0.taskIdentifier) })
        return lock.withLock {
            Set(ids.compactMap { id in
                guard let meta = taskMeta[id], meta.accountID == accountID else { return nil }
                return meta.localIdentifier
            })
        }
    }

    func cancelUploads(accountID: String) {
        let ids = lock.withLock { Set(taskMeta.keys.filter { taskMeta[$0]?.accountID == accountID }) }
        Task {
            for task in await session.allTasks where ids.contains(String(task.taskIdentifier)) {
                task.cancel()
            }
        }
    }

    func activeBodyPaths() async -> Set<String> {
        let ids = await session.allTasks.map { String($0.taskIdentifier) }
        return lock.withLock { Set(ids.compactMap { taskMeta[$0]?.bodyFilePath }) }
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

    private static func receipt(from data: Data) throws -> UploadReceipt {
        guard let receipt = try? JSONDecoder().decode(UploadReceipt.self, from: data) else {
            throw BackgroundUploadError.invalidResponse
        }
        guard receipt.hasNASOriginal else { throw BackgroundUploadError.nasOriginalUnconfirmed }
        return receipt
    }

    private func persistFailure(_ meta: TaskMeta?, error: Error) {
        guard let meta else { return }
        Analytics.backupDiagnostic(meta.isChunk == true ? .resumableChunk : .multipart,
                                   failure: .init(error), attemptID: meta.attemptID ?? UUID())
        completionWork.enter()
        Task {
            await UploadQueueStore.shared.markFailed(
                meta.localIdentifier,
                accountID: meta.accountID,
                error: error.localizedDescription
            )
            await MainActor.run {
                NotificationCenter.default.post(name: .backupBackgroundActivityChanged, object: nil)
            }
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
            NotificationCenter.default.post(name: .backupBackgroundActivityChanged, object: nil)
            SyncManager.shared.continueQueuedBackup()
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
    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        let fraction = min(1, Float(totalBytesSent) / Float(totalBytesExpectedToSend))
        let bucket = Int(fraction * 10)
        let observer = lock.withLock { () -> ProgressObserver? in
            guard var observer = progressObservers[task.taskIdentifier], bucket > observer.lastBucket else { return nil }
            observer.lastBucket = bucket
            progressObservers[task.taskIdentifier] = observer
            return observer
        }
        observer?.update(fraction)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        guard let meta = lock.withLock({ taskMeta[String(task.taskIdentifier)] }),
              let attemptID = meta.attemptID,
              let transaction = metrics.transactionMetrics.last else { return }
        Analytics.backupTransportTiming(
            meta.isChunk == true ? .resumableChunk : .multipart,
            attemptID: attemptID, submittedAt: meta.submittedAt,
            transaction: transaction, callbackAt: Date()
        )
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let id = task.taskIdentifier
        let result = lock.withLock { () -> (Data, TaskMeta?, CheckedContinuation<Data, Error>?) in
            let data = responseBuffers.removeValue(forKey: id) ?? Data()
            let meta = taskMeta.removeValue(forKey: String(id))
            let continuation = continuations.removeValue(forKey: id)
            progressObservers.removeValue(forKey: id)
            saveTaskMetaLocked()
            return (data, meta, continuation)
        }

        if let path = result.1?.bodyFilePath {
            try? FileManager.default.removeItem(at: URL(fileURLWithPath: path))
        }

        if let error {
            if result.2 == nil, (error as? URLError)?.code != .cancelled {
                persistFailure(result.1, error: error)
            }
            result.2?.resume(throwing: error)
            return
        }

        guard let http = task.response as? HTTPURLResponse else {
            if result.2 == nil {
                persistFailure(result.1, error: BackgroundUploadError.invalidResponse)
            }
            result.2?.resume(throwing: BackgroundUploadError.invalidResponse)
            return
        }

        guard (200...299).contains(http.statusCode) else {
            let uploadError = BackgroundUploadError.http(
                status: http.statusCode,
                message: Self.serverMessage(from: result.0)
            )
            if http.statusCode == 401, let request = task.originalRequest {
                Task { await APIClient.shared.invalidateSession(for: request) }
            }
            if result.2 == nil { persistFailure(result.1, error: uploadError) }
            result.2?.resume(throwing: uploadError)
            return
        }

        if let continuation = result.2 {
            continuation.resume(returning: result.0)
            return
        }
        if result.1?.isChunk == true {
            // The NAS checkpoint owns the offset. Recover it on the next run.
            completionWork.enter()
            Task { @MainActor in
                NotificationCenter.default.post(name: .backupBackgroundActivityChanged, object: nil)
                SyncManager.shared.continueQueuedBackup()
                completionWork.leave()
            }
            return
        }

        do {
            persistSuccess(result.1, receipt: try Self.receipt(from: result.0))
        } catch {
            persistFailure(result.1, error: error)
        }
    }
}
