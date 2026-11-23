import Photos
import SwiftUI

struct BackupActivityView: View {
    private enum ActivityFilter: String, CaseIterable, Identifiable {
        case all = "All"
        case waiting = "Waiting"
        case active = "Active"
        case backedUp = "Backed up"

        var id: Self { self }

        func includes(_ status: BackupActivityItem.Status) -> Bool {
            switch self {
            case .all: true
            case .waiting: status == .queued || status == .failed
            case .active: status.isActive
            case .backedUp: status == .backedUp
            }
        }
    }

    var waitingForFlickrOnly = false
    @State private var uploader = FlickrUploader.shared
    @State private var library = PhotoLibraryManager.shared
    @State private var uploadVM = UploadViewModel()
    @State private var filter: ActivityFilter = .all
    @State private var restoredQueue: [BackupActivityItem] = []
    @State private var earlierBackups: [BackupActivityItem] = []

    private var accountID: String? { SessionManager.shared.currentUser?.id }

    private var live: [BackupActivityItem] {
        guard uploader.activityAccountID == accountID else { return [] }
        let restored = Dictionary(uniqueKeysWithValues: restoredQueue.map { ($0.id, $0) })
        let completed = Set(earlierBackups.map(\.id))
        return uploader.activity.map { item in
            if completed.contains(item.id) {
                return BackupActivityItem(asset: item.asset, status: .backedUp, progress: 1)
            }
            return !uploader.isUploading ? restored[item.id] ?? item : item
        }
    }

    var body: some View {
        let liveItems = live
        let visibleIDs = Set(liveItems.map(\.id))
        let currentItems = filtered(liveItems + restoredQueue.filter { !visibleIDs.contains($0.id) })
        let current = filter == .all && !waitingForFlickrOnly
            ? currentItems.sorted { allOrder($0.status) < allOrder($1.status) }
            : currentItems
        let earlier = filtered(earlierBackups.filter { !visibleIDs.contains($0.id) })
        List {
            if !waitingForFlickrOnly {
                Picker("Backup status", selection: $filter) {
                    ForEach(ActivityFilter.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
            if current.isEmpty && earlier.isEmpty {
                ContentUnavailableView(
                    emptyTitle,
                    systemImage: "clock.arrow.circlepath",
                    description: !waitingForFlickrOnly && filter == .all ? Text("Your items appear here after you start a backup.") : nil
                )
                .listRowBackground(Color.clear)
            }
            if !current.isEmpty {
                Section("Current backup") {
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
        .task(id: "\(accountID ?? ""):\(library.totalDevicePhotos):\(uploader.isUploading)") { await loadActivity() }
        .refreshable { await loadActivity() }
        .onReceive(NotificationCenter.default.publisher(for: .backupBackgroundActivityChanged)) { _ in
            Task { await loadActivity() }
        }
        .task {
            if waitingForFlickrOnly { await uploadVM.refreshBackupStatuses() }
        }
    }

    private func allOrder(_ status: BackupActivityItem.Status) -> Int {
        switch status {
        case .preparing, .fetchingICloud, .uploading, .finishing: 0
        case .queued: 1
        case .failed: 2
        case .backedUp: 3
        }
    }

    private var emptyTitle: String {
        if waitingForFlickrOnly { return "No items waiting for Flickr" }
        switch filter {
        case .all: return "No backup activity"
        case .waiting: return "Nothing waiting"
        case .active: return "No active transfers"
        case .backedUp: return "No backed-up items"
        }
    }

    private func filtered(_ items: [BackupActivityItem]) -> [BackupActivityItem] {
        guard waitingForFlickrOnly else { return items.filter { filter.includes($0.status) } }
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
        let active = await BackgroundUploadSession.shared.activeLocalIdentifiers(accountID: accountID)
        guard self.accountID == accountID, !Task.isCancelled else { return }
        let manager = PhotoLibraryManager.shared
        let photos = Dictionary(uniqueKeysWithValues: manager.allPhotos.map { ($0.localIdentifier, $0) })
        restoredQueue = records.compactMap { record in
            guard let asset = photos[record.localIdentifier], !manager.isUploaded(localIdentifier: record.localIdentifier)
            else { return nil }
            let status: BackupActivityItem.Status = active.contains(record.localIdentifier)
                ? .uploading : record.state == .failed ? .failed : .queued
            return BackupActivityItem(asset: asset, status: status, error: record.lastError)
        }
        earlierBackups = manager.getTrackedAssets().map { asset in
            BackupActivityItem(asset: asset, status: .backedUp)
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
