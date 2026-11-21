import Foundation

struct ChunkTask: Codable {
    let scope: String
    let recordID: String
    let resourceIndex: Int
    let chunkPath: String
    let expectedEnd: Int64
}

final class BackgroundTransfer: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    static let shared = BackgroundTransfer()
    static let identifier = "com.kindlingsignal.kindredbackup.transfers"
    private let lock = NSLock()
    private let work = DispatchGroup()
    private var buffers: [Int: Data] = [:]
    private var finishHandler: (() -> Void)?
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        config.sessionSendsLaunchEvents = true
        config.waitsForConnectivity = true
        config.httpMaximumConnectionsPerHost = 1
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }()
    override private init() { super.init(); _ = session }
    func setFinishHandler(_ handler: @escaping () -> Void) { lock.lock(); finishHandler = handler; lock.unlock() }
    func active() async -> Bool {
        await session.allTasks.contains { $0.state == .running || $0.state == .suspended }
    }
    func cancelAll() async { for task in await session.allTasks { task.cancel() } }
    func enqueue(_ request: URLRequest, file: URL, metadata: ChunkTask) throws {
        let description = String(data: try JSONEncoder().encode(metadata), encoding: .utf8)
        let task = session.uploadTask(with: request, fromFile: file)
        task.taskDescription = description
        task.resume()
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if (buffers[dataTask.taskIdentifier]?.count ?? 0) + data.count <= 1024 * 1024 {
            buffers[dataTask.taskIdentifier, default: Data()].append(data)
        } else { dataTask.cancel() }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let data = buffers.removeValue(forKey: task.taskIdentifier) ?? Data()
        guard let description = task.taskDescription?.data(using: .utf8),
              let metadata = try? JSONDecoder().decode(ChunkTask.self, from: description) else { return }
        let result: Result<ResourceOffset, Error>
        if let error { result = .failure(error) }
        else if let response = task.response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
                let receipt = try? JSONDecoder().decode(ResourceOffset.self, from: data) { result = .success(receipt) }
        else {
            let detail = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["detail"] as? String
            result = .failure(BackupFailure(detail ?? "The transfer paused. Retry to resume from the NAS's saved position."))
        }
        work.enter()
        Task { @MainActor in
            await BackupController.shared.completeChunk(metadata, result: result)
            self.work.leave()
        }
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        work.notify(queue: .main) {
            self.lock.lock(); let handler = self.finishHandler; self.finishHandler = nil; self.lock.unlock()
            handler?()
        }
    }
}
