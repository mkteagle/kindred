import Foundation
import Photos
import UniformTypeIdentifiers

struct DeviceAlbum: Identifiable {
    let id: String
    let name: String
    let count: Int
}

@MainActor
final class PhotoAccess {
    static let libraryID = "__all_photos__"
    static func revision(_ asset: PHAsset) -> String {
        let resources = PHAssetResource.assetResources(for: asset)
        let components = resources.map { "\($0.type.rawValue):\($0.originalFilename):\($0.uniformTypeIdentifier)" }.joined(separator: "|")
        return digest(Data("\(asset.localIdentifier)|\(asset.modificationDate?.timeIntervalSince1970 ?? 0)|\(components)".utf8))
    }
    static func albums() -> [DeviceAlbum] {
        var result = [DeviceAlbum(id: libraryID, name: "All Photos", count: PHAsset.fetchAssets(with: nil).count)]
        let collections = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
        collections.enumerateObjects { collection, _, _ in
            result.append(DeviceAlbum(id: collection.localIdentifier, name: collection.localizedTitle ?? "Album", count: PHAsset.fetchAssets(in: collection, options: nil).count))
        }
        return result
    }
    static func selectedAssets(_ selection: Set<String>) -> [(PHAsset, [String])] {
        var assets: [String: (PHAsset, [String])] = [:]
        let options = PHFetchOptions(); options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        if selection.contains(libraryID) {
            PHAsset.fetchAssets(with: options).enumerateObjects { asset, _, _ in assets[asset.localIdentifier] = (asset, []) }
        }
        let collections = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: Array(selection.filter { $0 != libraryID }), options: nil)
        collections.enumerateObjects { collection, _, _ in
            PHAsset.fetchAssets(in: collection, options: options).enumerateObjects { asset, _, _ in
                let existing = assets[asset.localIdentifier]?.1 ?? []
                assets[asset.localIdentifier] = (asset, existing + [collection.localizedTitle ?? "Album"])
            }
        }
        return assets.values.sorted { ($0.0.creationDate ?? .distantPast) > ($1.0.creationDate ?? .distantPast) }
    }
    static func export(_ asset: PHAsset, record: BackupRecord) async throws -> [BackupResource] {
        let resources = PHAssetResource.assetResources(for: asset)
        guard !resources.isEmpty else { throw BackupFailure("Photos did not provide the original resources.") }
        let directory = try BackupStore.shared.directory(record.id)
        let preferred: PHAssetResourceType = asset.mediaType == .video ? .fullSizeVideo : .fullSizePhoto
        let fallback: PHAssetResourceType = asset.mediaType == .video ? .video : .photo
        let primary = resources.firstIndex { $0.type == preferred } ?? resources.firstIndex { $0.type == fallback } ?? 0
        var output: [BackupResource] = []
        for (index, resource) in resources.enumerated() {
            try Task.checkCancellation()
            let path = directory.appendingPathComponent("resource-\(index).original")
            try? FileManager.default.removeItem(at: path)
            let options = PHAssetResourceRequestOptions(); options.isNetworkAccessAllowed = true
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                PHAssetResourceManager.default().writeData(for: resource, toFile: path, options: options) { error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                }
            }
            let attributes = try FileManager.default.attributesOfItem(atPath: path.path)
            let bytes = (attributes[.size] as? NSNumber)?.int64Value ?? 0
            guard bytes > 0 else { throw BackupFailure("An original resource is empty. Nothing will be deleted.") }
            let hash = try await Task.detached(priority: .utility) { try fileDigest(path) }.value
            output.append(BackupResource(key: "\(index)-\(resource.type.rawValue)", filename: resource.originalFilename,
                media_type: UTType(resource.uniformTypeIdentifier)?.preferredMIMEType ?? "application/octet-stream",
                byte_size: bytes, sha256: hash, is_primary: index == primary, filePath: path.path))
        }
        guard revision(asset) == record.revision else { throw BackupFailure("This item changed while preparing its backup. Sync it again.") }
        return output
    }
}
