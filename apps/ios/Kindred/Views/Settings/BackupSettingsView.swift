import Photos
import SwiftUI

struct BackupSettingsView: View {
    @State private var uploadVM = UploadViewModel()
    @State private var sync = SyncManager.shared
    @State private var uploader = FlickrUploader.shared
    @State private var showsUploadLimit = false
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    private var photos: PhotoLibraryManager { uploadVM.photoManager }

    var body: some View {
        SettingsPage("Backup & Sync") {
            if photos.authorizationStatus == .denied || photos.authorizationStatus == .restricted {
                permissionNotice
            } else {
                backupStatus
            }

            NavigationLink {
                BackupActivityView()
            } label: {
                SettingsLinkLabel("Activity", icon: "list.bullet.rectangle")
                    .kindredGroupedCard()
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("backup.activity")

            VStack(spacing: 0) {
                Toggle("Auto-backup", isOn: Binding(get: { sync.autoSyncEnabled }, set: sync.setAutoSync))
                    .accessibilityIdentifier("backup.autoBackup")
                    .padding(14)

                Divider()

                Toggle("Only on Wi-Fi", isOn: Binding(get: { sync.wifiOnly }, set: sync.setWiFiOnly))
                    .accessibilityIdentifier("backup.wifiOnly")
                    .padding(14)
            }
            .font(.kindredLabel)
            .tint(KindredTheme.accent)
            .kindredGroupedCard()

            DisclosureGroup("Upload limit", isExpanded: $showsUploadLimit) {
                Stepper(
                    value: Binding(get: { sync.uploadLimit }, set: sync.setUploadLimit),
                    in: 1...4
                ) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Simultaneous uploads")
                        Text(uploader.isUploading
                             ? "Limit \(sync.uploadLimit) · using up to \(uploader.activeUploadLimit)"
                             : "Up to \(sync.uploadLimit) · slows down when the NAS is busy")
                            .font(.kindredCaption)
                            .foregroundStyle(KindredTheme.inkSecondary)
                    }
                }
                .accessibilityIdentifier("backup.uploadLimit.stepper")
            }
            .disclosureGroupStyle(SettingsDisclosureStyle())
            .kindredGroupedCard()
        }
        .task { await uploadVM.requestAccess() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await photos.refreshAuthorizedPhotos() } }
        }
        .refreshable { await photos.refreshAuthorizedPhotos() }
    }

    private var backupStatus: some View {
        VStack(alignment: .leading, spacing: 10) {
            if photos.isLoading && photos.totalDevicePhotos == 0 {
                ProgressView()
                    .accessibilityLabel("Loading photos")
            } else if photos.totalDevicePhotos > 0 {
                Text("\(photos.uploadedCount) of \(photos.totalDevicePhotos) backed up")
                    .font(.kindredLabel)
                    .foregroundStyle(KindredTheme.ink)
            } else if photos.authorizationStatus != .notDetermined {
                Text("No photos to back up")
                    .font(.kindredLabel)
                    .foregroundStyle(KindredTheme.ink)
            }

            if uploader.isUploading {
                Text(uploader.currentAssetTitle)
                    .font(.kindredCaption)
                    .foregroundStyle(KindredTheme.inkSecondary)
                ProgressView(value: uploader.currentProgress)
                    .tint(KindredTheme.accent)
                KindredButton(title: "Pause backup", style: .ghost, isSmall: true) {
                    uploader.pauseBackup()
                }
            } else if !photos.notUploadedPhotos.isEmpty {
                KindredButton(title: uploader.isPaused ? "Resume backup" : "Back up now",
                              icon: "icloud.and.arrow.up", isFullWidth: true) {
                    Task {
                        uploadVM.selectAll()
                        await uploadVM.uploadSelected()
                    }
                }
            }

            if let error = uploader.lastError, !uploader.isPaused {
                Text(error)
                    .font(.kindredCaption)
                    .foregroundStyle(KindredTheme.dangerText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var permissionNotice: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Photo access is off")
                .font(.kindredLabel)
            Text("Allow photo access in iPhone Settings to start a backup.")
                .font(.kindredCaption)
                .foregroundStyle(KindredTheme.inkSecondary)
            KindredButton(title: "Open iPhone Settings", icon: "gear", style: .ghost, isSmall: true) {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
