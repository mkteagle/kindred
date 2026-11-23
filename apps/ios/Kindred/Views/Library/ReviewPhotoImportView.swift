import ImageIO
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

@MainActor
@Observable
final class ReviewPhotoStore {
    struct Photo: Identifiable {
        let url: URL
        let expiresAt: Date
        var id: URL { url }
    }

    static let shared = ReviewPhotoStore()
    static let limit = 5
    static let lifetime: TimeInterval = 60 * 60

    private let directory: URL
    private var expiration: Task<Void, Never>?
    private(set) var photos: [Photo] = []

    init(directory: URL = URL.applicationSupportDirectory.appending(
        path: "KindredReviewPhotos", directoryHint: .isDirectory
    )) {
        self.directory = directory
    }

    func refresh(now: Date = .now) {
        expiration?.cancel()
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        photos = files.compactMap { url in
            guard url.pathExtension == "jpg",
                  let timestamp = url.lastPathComponent.split(separator: "-", maxSplits: 1).first,
                  let seconds = Double(timestamp) else { return nil }
            let deadline = Date(timeIntervalSince1970: seconds + Self.lifetime)
            if deadline <= now {
                try? FileManager.default.removeItem(at: url)
                return nil
            }
            return Photo(url: url, expiresAt: deadline)
        }
        .sorted { $0.expiresAt < $1.expiresAt }
        guard let deadline = photos.first?.expiresAt else { return }
        expiration = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(max(0, deadline.timeIntervalSinceNow))) }
            catch { return }
            self?.refresh()
        }
    }

    func add(_ data: Data, now: Date = .now) throws {
        refresh(now: now)
        guard photos.count < Self.limit else { throw ImportError.full }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 1600,
        ]
        guard let input = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(input, 0, options as CFDictionary)
        else { throw ImportError.invalidPhoto }

        var backupExcluded = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try backupExcluded.setResourceValues(values)

        let encoded = NSMutableData()
        guard let output = CGImageDestinationCreateWithData(encoded, UTType.jpeg.identifier as CFString, 1, nil)
        else { throw ImportError.invalidPhoto }
        CGImageDestinationAddImage(output, image, [kCGImageDestinationLossyCompressionQuality: 0.86] as CFDictionary)
        guard CGImageDestinationFinalize(output) else { throw ImportError.invalidPhoto }
        let name = "\(Int(now.timeIntervalSince1970))-\(UUID().uuidString)"
        let url = directory.appending(path: name).appendingPathExtension("jpg")
        try (encoded as Data).write(to: url, options: [.atomic, .completeFileProtection])
        refresh(now: now)
    }

    func removeAll() {
        expiration?.cancel()
        photos = []
        try? FileManager.default.removeItem(at: directory)
    }

    private enum ImportError: LocalizedError {
        case full, invalidPhoto

        var errorDescription: String? {
            switch self {
            case .full: "You can keep up to five review photos at a time."
            case .invalidPhoto: "This photo couldn’t be opened."
            }
        }
    }
}

struct ReviewPhotoImportView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var store = ReviewPhotoStore.shared
    @State private var selection: [PhotosPickerItem] = []
    @State private var opened: ReviewPhotoStore.Photo?
    @State private var importing = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            SettingsPage("On this iPhone") {
                Text("Try importing up to five photos. Copies stay on this iPhone and expire after one hour.")
                    .font(.kindredBody)
                    .foregroundStyle(KindredTheme.inkSecondary)

                let remaining = ReviewPhotoStore.limit - store.photos.count
                if remaining > 0 {
                    PhotosPicker(selection: $selection, maxSelectionCount: remaining, matching: .images) {
                        SettingsLinkLabel("Choose photos", icon: "photo.badge.plus")
                    }
                    .buttonStyle(.plain)
                    .kindredGroupedCard()
                    .disabled(importing)
                }
                if importing { ProgressView() }
                if let error { Text(error).foregroundStyle(.red).font(.kindredBody) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 124))], spacing: 8) {
                    ForEach(store.photos) { photo in
                        if let image = UIImage(contentsOfFile: photo.url.path) {
                            Button { opened = photo } label: {
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(height: 130)
                                    .frame(maxWidth: .infinity)
                                    .clipShape(.rect(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Open imported photo")
                        }
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { store.refresh() }
            .onChange(of: selection) { _, items in
                guard !items.isEmpty else { return }
                Task { await importPhotos(items) }
            }
            .sheet(item: $opened) { photo in
                if let image = UIImage(contentsOfFile: photo.url.path) {
                    Image(uiImage: image).resizable().scaledToFit().padding()
                        .task {
                            try? await Task.sleep(for: .seconds(max(0, photo.expiresAt.timeIntervalSinceNow)))
                            if !Task.isCancelled { opened = nil }
                        }
                }
            }
        }
    }

    private func importPhotos(_ items: [PhotosPickerItem]) async {
        guard !importing else { return }
        importing = true
        error = nil
        defer {
            selection = []
            importing = false
        }
        for item in items {
            guard SessionManager.shared.isReadOnlyReview else { break }
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    error = "A selected photo couldn’t be opened."
                    continue
                }
                guard SessionManager.shared.isReadOnlyReview else { break }
                try store.add(data)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
