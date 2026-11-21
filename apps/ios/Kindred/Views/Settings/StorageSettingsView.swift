import Photos
import SwiftUI

struct StorageSettingsView: View {
    @State private var uploadVM = UploadViewModel()
    @State private var flickr = HouseholdFlickrConnection.checking
    @State private var showsDeviceSpace = false
    @State private var showsConnection = false
    @State private var showCleanup = false
    @State private var isCleaningUp = false
    @State private var showFreedSpace = false
    @State private var removedCount = 0
    @AppStorage(UploadViewModel.automaticCopyChecksKey) private var checksCopiesAutomatically = true
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    private var photos: PhotoLibraryManager { uploadVM.photoManager }
    private var canReadPhotos: Bool {
        photos.authorizationStatus == .authorized || photos.authorizationStatus == .limited
    }

    var body: some View {
        SettingsPage("Storage") {
            destinations
            copyChecks
            deviceSpace

            DisclosureGroup("Server connection", isExpanded: $showsConnection) {
                ServerConnectionDetails()
            }
            .disclosureGroupStyle(SettingsDisclosureStyle())
            .kindredGroupedCard()
        }
        .task { flickr = await HouseholdFlickrConnection.load() }
        .task(id: checksCopiesAutomatically) {
            await photos.refreshAuthorizedPhotos()
            guard checksCopiesAutomatically else { return }
            while !Task.isCancelled {
                await uploadVM.refreshBackupStatuses()
                do {
                    try await Task.sleep(for: .seconds(UploadViewModel.copyCheckInterval))
                } catch { return }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refreshStorage() } }
        }
        .refreshable { await refreshStorage() }
        .sheet(isPresented: $showCleanup) {
            FreeSpaceConfirmSheet(onConfirm: {
                showCleanup = false
                Task { await freeUpSpace() }
            }, onCancel: { showCleanup = false })
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showFreedSpace) {
            SpaceFreedSheet(count: removedCount) { showFreedSpace = false }
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
    }

    private var destinations: some View {
        VStack(spacing: 0) {
            KindredSettingsRow(title: "Home NAS", subtitle: savedCopyLabel(photos.nasSavedCount)) {
                Image(systemName: "externaldrive")
                    .foregroundStyle(KindredTheme.inkSecondary)
                    .accessibilityHidden(true)
            }
            .accessibilityElement(children: .combine)

            Divider()

            KindredSettingsRow(title: "Household Flickr", subtitle: savedCopyLabel(photos.flickrSavedCount)) {
                Text(flickr.rawValue)
                    .font(.kindredCaption)
                    .foregroundStyle(KindredTheme.inkSecondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("storage.flickrConnection")

            if canReadPhotos, photos.flickrPendingCount > 0 {
                Divider()

                NavigationLink {
                    BackupActivityView(waitingForFlickrOnly: true)
                } label: {
                    SettingsLinkLabel("\(photos.flickrPendingCount) waiting for Flickr", icon: "clock")
                }
            }

            if SessionManager.shared.currentUser?.role == "admin",
               HostedSocialSignIn.supports(server: APIClient.publicBaseURL) {
                Divider()

                Link(destination: HostedSocialSignIn.integrationsURL) {
                    SettingsLinkLabel("Manage Flickr", icon: "arrow.up.right.square")
                }
                .accessibilityHint("Opens Kindred settings in your browser")
            }
        }
        .buttonStyle(.plain)
        .kindredGroupedCard()
    }

    private func savedCopyLabel(_ count: Int) -> String? {
        guard canReadPhotos else { return nil }
        return "\(count) saved from this device"
    }

    private var copyChecks: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Check copies automatically", isOn: $checksCopiesAutomatically)
                .font(.kindredLabel)
                .tint(KindredTheme.accent)
                .accessibilityIdentifier("storage.automaticCopyChecks")

            Text("Checks pending copies every 15 minutes while Storage is open.")
                .font(.kindredCaption)
                .foregroundStyle(KindredTheme.inkSecondary)

            if canReadPhotos, photos.uploadedCount > 0 {
                Button {
                    Task { await uploadVM.refreshBackupStatuses(force: true) }
                } label: {
                    Label(uploadVM.isCheckingCopies ? "Checking copies…" : "Check copies now",
                          systemImage: "arrow.clockwise")
                        .font(.kindredLabel)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(KindredTheme.accent)
                .disabled(uploadVM.isCheckingCopies)
            }

            if let error = uploadVM.statusError {
                Text(error)
                    .font(.kindredCaption)
                    .foregroundStyle(KindredTheme.dangerText)
            }
        }
        .padding(14)
        .kindredGroupedCard()
    }

    private var deviceSpace: some View {
        DisclosureGroup("Device space", isExpanded: $showsDeviceSpace) {
            VStack(alignment: .leading, spacing: 8) {
                if canReadPhotos {
                    Text(photos.uploadedCount > 0
                         ? "Kindred verifies both the NAS and Flickr copies before removing an item."
                         : "No backed-up items from this device.")
                        .font(.kindredCaption)
                        .foregroundStyle(KindredTheme.inkSecondary)
                    if photos.estimatedSavingsBytes > 0 {
                        let savings = ByteCountFormatter.string(fromByteCount: photos.estimatedSavingsBytes, countStyle: .file)
                        Text("Estimated savings of \(savings)")
                            .font(.kindredCaption)
                            .foregroundStyle(KindredTheme.inkSecondary)
                    }
                    KindredButton(title: "Free up device space", icon: "trash", style: .ghost,
                                  isSmall: true, isLoading: isCleaningUp) {
                        showCleanup = true
                    }
                    .disabled(photos.uploadedCount == 0 || isCleaningUp)
                } else {
                    KindredButton(title: "Allow photo access", icon: "photo.on.rectangle", style: .ghost,
                                  isSmall: true) {
                        if photos.authorizationStatus == .denied || photos.authorizationStatus == .restricted {
                            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                        } else {
                            Task { await uploadVM.requestAccess() }
                        }
                    }
                }

                if let error = uploadVM.cleanupError {
                    Text(error)
                        .font(.kindredCaption)
                        .foregroundStyle(KindredTheme.dangerText)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .disclosureGroupStyle(SettingsDisclosureStyle())
        .kindredGroupedCard()
    }

    private func refreshStorage() async {
        async let status = HouseholdFlickrConnection.load()
        await photos.refreshAuthorizedPhotos()
        flickr = await status
    }

    private func freeUpSpace() async {
        isCleaningUp = true
        defer { isCleaningUp = false }
        do {
            removedCount = try await uploadVM.freeUpSpace()
            showFreedSpace = true
        } catch {
            // The view model exposes the verification or removal error in Device space.
        }
    }
}

private struct ServerConnectionDetails: View {
    @State private var viewModel = SettingsViewModel()
    @State private var checkedConnection = false

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if DemoDataProvider.shared.isActive {
                Text("Demo library")
            } else {
                if let host = URL(string: APIClient.publicBaseURL)?.host {
                    Text(host)
                        .textSelection(.enabled)
                }
                Text(checkedConnection ? (viewModel.isHealthy ? "Online" : "Offline") : "Checking…")
            }
        }
        .font(.kindredCaption)
        .foregroundStyle(KindredTheme.inkSecondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .task {
            await viewModel.checkHealth()
            checkedConnection = true
        }
    }
}

// MARK: - Free Space Confirmation Sheet

struct FreeSpaceConfirmSheet: View {
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Icon
            Image(systemName: "arrow.up.trash")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(KindredTheme.ember)
                .padding(.top, 32)

            // Title
            Text("Free up device space?")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ash)
                .padding(.top, 16)

            // Body
            Text("Kindred checks both your NAS and Flickr before removing local copies.")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.pine)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            Text("They'll move to Recently Deleted in Photos — recoverable for 30 days.")
                .font(.kindredCaption)
                .foregroundStyle(KindredTheme.mist)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            Spacer()

            // Buttons
            VStack(spacing: 10) {
                KindredButton(
                    title: "Check and remove copies",
                    icon: "trash",
                    style: .danger,
                    isFullWidth: true
                ) {
                    onConfirm()
                }

                KindredButton(
                    title: "Keep them on device",
                    style: .ghost,
                    isFullWidth: true
                ) {
                    onCancel()
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(KindredTheme.sheet)
    }
}

// MARK: - Space Freed Sheet

struct SpaceFreedSheet: View {
    let count: Int
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(KindredTheme.forest)
                .padding(.top, 32)

            Text("Space freed")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ash)
                .padding(.top, 16)

            Text("Removed \(count) items from this device. Copies remain on your NAS and Flickr.")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.pine)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            Spacer()

            KindredButton(title: "Done", style: .dark, isFullWidth: true) {
                onDismiss()
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(KindredTheme.sheet)
    }
}
