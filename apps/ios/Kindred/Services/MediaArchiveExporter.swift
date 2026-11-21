import Foundation
import UniformTypeIdentifiers
import ZIPFoundation

/// Keeps the file alive while the native share controller uses it.
final class SharedMediaArchive: Identifiable, Sendable {
    let url: URL
    var id: URL { url }
    private let directory: URL

    init(directory: URL) {
        self.directory = directory
        url = directory.appendingPathComponent("Kindred Originals.zip")
    }

    deinit {
        try? FileManager.default.removeItem(at: directory)
    }
}

actor MediaArchiveExporter {
    struct Item: Sendable {
        let title: String
        let folder: String
        let original: URL?
        let fallback: URL?
    }

    enum ExportError: LocalizedError {
        case unavailable(String)
        case emptySelection

        var errorDescription: String? {
            switch self {
            case .unavailable(let title): return "Couldn’t download the original for “\(title)”."
            case .emptySelection: return "Select at least one item to download."
            }
        }
    }

    func create(
        items: [Item], onProgress: @MainActor @Sendable (Int) -> Void
    ) async throws -> SharedMediaArchive {
        guard !items.isEmpty else { throw ExportError.emptySelection }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        let output = SharedMediaArchive(directory: directory)

        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 60
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        let archive = try Archive(url: output.url, accessMode: .create)
        let progress = Progress(totalUnitCount: Int64(items.count))
        var nameKeys: Set<String> = []
        return try await withTaskCancellationHandler {
            for (index, item) in items.enumerated() {
                try Task.checkCancellation()
                try await add(item, to: archive, using: session, used: &nameKeys, progress: progress)
                try Task.checkCancellation()
                await onProgress(index + 1)
            }
            return output
        } onCancel: {
            progress.cancel()
        }
    }

    private func add(
        _ item: Item, to archive: Archive, using session: URLSession,
        used: inout Set<String>, progress: Progress
    ) async throws {
        guard let original = item.original else { throw ExportError.unavailable(item.title) }
        let source: URL
        let filename: String
        if original.isFileURL {
            source = original
            filename = original.lastPathComponent
        } else {
            var result = try await download(original, using: session)
            if let status = (result.1 as? HTTPURLResponse)?.statusCode,
               [404, 422].contains(status), let fallback = item.fallback {
                try? FileManager.default.removeItem(at: result.0)
                result = try await download(fallback, using: session)
            }
            guard Self.isOriginal(result) else {
                try? FileManager.default.removeItem(at: result.0)
                throw ExportError.unavailable(item.title)
            }
            source = result.0
            filename = Self.filename(for: result.1, title: item.title)
        }
        defer {
            if !original.isFileURL { try? FileManager.default.removeItem(at: source) }
        }
        try Task.checkCancellation()
        let path = Self.uniquePath(folder: item.folder, filename: filename, used: &used)
        // JPEG, HEIC and common video originals are already compressed.
        try archive.addEntry(with: path, fileURL: source, compressionMethod: .none, progress: progress)
    }

    private func download(_ url: URL, using session: URLSession) async throws -> (URL, URLResponse) {
        try await session.download(for: URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    private static func isOriginal(_ download: (URL, URLResponse)) -> Bool {
        guard let response = download.1 as? HTTPURLResponse, response.statusCode == 200,
              let size = try? download.0.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 0
        else { return false }
        let mime = response.mimeType?.lowercased() ?? ""
        return mime.isEmpty || mime.hasPrefix("image/") || mime.hasPrefix("video/")
            || mime == "application/octet-stream" || mime == "application/mp4"
    }

    private static func filename(for response: URLResponse, title: String) -> String {
        if let response = response as? HTTPURLResponse,
           response.value(forHTTPHeaderField: "Content-Disposition") != nil,
           let name = response.suggestedFilename {
            return name
        }
        guard let mime = response.mimeType, let type = UTType(mimeType: mime),
              let ext = type.preferredFilenameExtension else { return title }
        let titleType = UTType(filenameExtension: (title as NSString).pathExtension.lowercased())
        guard titleType != type else { return title }
        return "\(title).\(ext)"
    }

    private static func uniquePath(folder: String, filename: String, used: inout Set<String>) -> String {
        let invalid = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)
        let name = filename.components(separatedBy: invalid).joined(separator: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        let suffix = String((name as NSString).pathExtension.prefix(20))
        let stem = (name as NSString).deletingPathExtension
        var length = 0
        let trimmedStem = stem.prefix { character in
            length += character.utf8.count
            return length <= 240 - suffix.utf8.count
        }
        let safeStem = trimmedStem.isEmpty ? "Original" : String(trimmedStem)
        var counter = 1
        while true {
            let number = counter == 1 ? "" : " (\(counter))"
            let extensionPart = suffix.isEmpty ? "" : ".\(suffix)"
            let path = "\(folder)/\(safeStem)\(number)\(extensionPart)"
            if used.insert(path.lowercased().precomposedStringWithCanonicalMapping).inserted { return path }
            counter += 1
        }
    }
}
