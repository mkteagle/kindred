import Photos
import SwiftUI

struct BackupActivityView: View {
    var waitingForFlickrOnly = false
    @State private var uploader = FlickrUploader.shared
    @State private var uploadVM = UploadViewModel()
    @State private var restoredQueue: [BackupActivityItem] = []
    @State private var earlierBackups: [BackupActivityItem] = []

    private var accountID: String? { SessionManager.shared.currentUser?.id }

    private var current: [BackupActivityItem] {
        if uploader.activityAccountID == accountID, !uploader.activity.isEmpty {
            return filtered(uploader.activity)
        }
        return filtered(restoredQueue)
    }

    var body: some View {
        let earlier = filtered(earlierBackups)
        List {
            if current.isEmpty && earlier.isEmpty {
                ContentUnavailableView(
                    waitingForFlickrOnly ? "No items waiting for Flickr" : "No backup activity",
                    systemImage: "clock.arrow.circlepath",
                    description: waitingForFlickrOnly ? nil : Text("Your items appear here after you start a backup.")
                )
                .listRowBackground(Color.clear)
            }
            if !current.isEmpty {
                Section("Queue") {
                    ForEach(current) { item in activityRow(item) }
                }
            }
            if !earlier.isEmpty {
                Section("Earlier backups") {
                    ForEach(earlier) { item in activityRow(item) }
                }
            }
        }
        .navigationTitle(waitingForFlickrOnly ? "Waiting for Flickr" : "Backup activity")
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .kindredPaperBackground()
        .task(id: accountID) { await loadActivity() }
        .task {
            if waitingForFlickrOnly { await uploadVM.refreshBackupStatuses() }
        }
    }

    private func filtered(_ items: [BackupActivityItem]) -> [BackupActivityItem] {
        guard waitingForFlickrOnly else { return items }
        return items.filter { item in
            guard item.status == .backedUp,
                  let receipt = PhotoLibraryManager.shared.backupRecord(for: item.id) else { return false }
            return receipt.flickrStatus != "available"
        }
    }
    private func activityRow(_ item: BackupActivityItem) -> some View {
        NavigationLink {
            BackupActivityDetail(item: item, accountID: accountID)
        } label: {
            HStack(spacing: 12) {
                PhotoAssetCell(asset: item.asset, isSelected: false, allowsNetworkAccess: false)
                    .frame(width: 42, height: 42)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title)
                        .font(.kindredLabel)
                    if let date = item.asset.creationDate {
                        Text(date, format: .dateTime.month(.abbreviated).day().year())
                            .font(.kindredCaption)
                            .foregroundStyle(KindredTheme.inkSecondary)
                    }
                }
                Spacer()
                Text(waitingForFlickrOnly ? "Waiting" : item.status.rawValue)
                    .font(.kindredCaption)
                    .foregroundStyle(item.status == .failed ? KindredTheme.dangerText : KindredTheme.inkSecondary)
            }
            .foregroundStyle(KindredTheme.ink)
        }
    }

    private func loadActivity() async {
        guard let accountID else {
            restoredQueue = []
            earlierBackups = []
            return
        }
        let records = await UploadQueueStore.shared.activityRecords(accountID: accountID)
        guard self.accountID == accountID, !Task.isCancelled else { return }
        let manager = PhotoLibraryManager.shared
        let photos = Dictionary(uniqueKeysWithValues: manager.allPhotos.map { ($0.localIdentifier, $0) })
        restoredQueue = records.compactMap { record in
            guard let asset = photos[record.localIdentifier], !manager.isUploaded(localIdentifier: record.localIdentifier)
            else { return nil }
            let status: BackupActivityItem.Status = record.state == .failed ? .failed : .queued
            return BackupActivityItem(asset: asset, status: status, error: record.lastError)
        }
        let currentIdentifiers = Set(uploader.activityAccountID == accountID ? uploader.activity.map(\.id) : [])
        earlierBackups = manager.getTrackedAssets().compactMap { asset in
            guard !currentIdentifiers.contains(asset.localIdentifier) else { return nil }
            return BackupActivityItem(asset: asset, status: .backedUp)
        }
    }
}

private struct BackupActivityDetail: View {
    let item: BackupActivityItem
    let accountID: String?
    @State private var uploader = FlickrUploader.shared

    private var liveItem: BackupActivityItem {
        guard uploader.activityAccountID == accountID else { return item }
        return uploader.activity.first { $0.id == item.id } ?? item
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PhotoAssetCell(asset: item.asset, isSelected: false)
                    .frame(maxWidth: 340)
                    .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                Text(liveItem.status.rawValue)
                    .font(.kindredH3)
                if uploader.isUploading && (liveItem.status == .uploading || liveItem.status == .finishing) {
                    ProgressView(value: liveItem.progress)
                        .tint(KindredTheme.forest)
                }
                if let error = liveItem.error {
                    Text(error)
                        .font(.kindredBody)
                        .foregroundStyle(KindredTheme.dangerText)
                }
                if liveItem.status == .backedUp,
                   let receipt = PhotoLibraryManager.shared.backupRecord(for: item.id),
                   receipt.flickrStatus != "available" {
                    Text("Waiting for the Flickr copy.")
                        .font(.kindredBody)
                        .foregroundStyle(KindredTheme.inkSecondary)
                }
            }
            .frame(maxWidth: 340, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(20)
        }
        .navigationTitle(item.title)
        .navigationBarTitleDisplayMode(.inline)
        .kindredPaperBackground()
    }
}
