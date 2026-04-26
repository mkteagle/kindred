import SwiftUI
import Photos

struct SettingsView: View {
    @State private var viewModel = SettingsViewModel()
    @State private var syncManager = SyncManager.shared
    @State private var showLogoutConfirm = false
    @State private var showPrivacyInfo = false
    @State private var showBackendURL = false
    @State private var showAvatarPicker = false

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    // Page header
                    KindredPageHeader(eyebrow: "Settings", title: "Your household.")

                    // Household card
                    householdCard

                    // Members section
                    membersSection

                    // Library section
                    librarySection

                    // Privacy section
                    privacySection

                    // Sign out
                    KindredButton(
                        title: "Sign Out",
                        icon: "rectangle.portrait.and.arrow.right",
                        style: .danger,
                        isFullWidth: true
                    ) {
                        showLogoutConfirm = true
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 20)

                    // Footer
                    VStack(spacing: 6) {
                        HStack(spacing: 6) {
                            Image(systemName: "flame")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(KindredTheme.ember)
                            Text("Kindling Signal")
                                .font(.kindredMeta)
                                .foregroundStyle(KindredTheme.mist)
                        }
                        Text("Kindred Photos \u{00b7} v1.0")
                            .font(.kindredMicro)
                            .foregroundStyle(KindredTheme.muted)
                        Text("\u{00a9} \(String(Calendar.current.component(.year, from: Date()))) Kindling Signal")
                            .font(.kindredMicro)
                            .foregroundStyle(KindredTheme.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 24)
                    .padding(.bottom, 110)
                }
            }
            .kindredPaperBackground()
            .navigationBarHidden(true)
            .sheet(isPresented: $showLogoutConfirm) {
                SignOutSheet(
                    onConfirm: {
                        showLogoutConfirm = false
                        viewModel.logout()
                    },
                    onCancel: { showLogoutConfirm = false }
                )
                .presentationDetents([.height(320)])
                .presentationDragIndicator(.visible)
            }
            .task {
                async let health: () = viewModel.checkHealth()
                async let syncs: () = viewModel.loadSyncs()
                async let job: () = viewModel.checkActiveJob()
                _ = await (health, syncs, job)
            }
        }
    }

    // MARK: - Household Card

    private var householdCard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                if let user = viewModel.session.currentUser {
                    Button {
                        showAvatarPicker = true
                    } label: {
                        ZStack {
                            if let avatarPath = user.avatar_url {
                                AvatarAsyncImage(avatarPath: avatarPath, size: 44)
                                    .frame(width: 44, height: 44)
                                    .clipShape(Circle())
                            } else {
                                KindredInitialsAvatar(
                                    initials: String(user.display_name.prefix(2)).uppercased(),
                                    size: 44
                                )
                            }
                            // Camera overlay on hover/press
                            Circle()
                                .fill(.black.opacity(0.3))
                                .frame(width: 44, height: 44)
                                .overlay {
                                    Image(systemName: "camera.fill")
                                        .font(.system(size: 14))
                                        .foregroundStyle(.white)
                                }
                                .opacity(0.001) // Invisible but tappable hint; shows on press
                        }
                    }
                    .contentShape(Rectangle())
            .buttonStyle(.plain)
                    .sheet(isPresented: $showAvatarPicker) {
                        AvatarPickerView(
                            currentAvatarURL: user.avatar_url,
                            userName: user.display_name,
                            onSaved: { newURL in
                                // Update the stored user with new avatar URL
                                let updated = UserInfo(
                                    id: user.id,
                                    username: user.username,
                                    display_name: user.display_name,
                                    role: user.role,
                                    avatar_url: newURL
                                )
                                viewModel.session.restoreUser(updated)
                            }
                        )
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.display_name)
                            .font(.display(17, weight: .bold))
                            .foregroundStyle(KindredTheme.ash)
                        Text("@\(user.username) · \(user.role)")
                            .font(.kindredMeta)
                            .foregroundStyle(KindredTheme.mist)
                    }
                    Spacer()
                }
            }

            // Flickr storage — unlimited
            HStack(spacing: 6) {
                Image(systemName: "infinity")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(KindredTheme.forest)
                Text("Unlimited storage via Flickr")
                    .font(.kindredMeta)
                    .foregroundStyle(KindredTheme.mist)
            }
            .padding(.top, 12)
        }
        .padding(16)
        .background(KindredTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusMD))
        .overlay(
            RoundedRectangle(cornerRadius: KindredTheme.radiusMD)
                .stroke(KindredTheme.line, lineWidth: 1)
        )
        .shadow(color: Color(hex: 0x11161B).opacity(0.07), radius: 13, x: 0, y: 12)
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }

    // MARK: - Members Section

    private var membersSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredEyebrow(text: "Household")
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 6)

            VStack(spacing: 0) {
                if let user = viewModel.session.currentUser {
                    memberRow(name: user.display_name, role: user.role, avatarURL: user.avatar_url, isLast: true)
                }
            }
            .kindredGroupedCard()
            .padding(.horizontal, 16)
        }
    }

    private func memberRow(name: String, role: String, avatarURL: String? = nil, isLast: Bool = false) -> some View {
        HStack(spacing: 12) {
            if let avatarPath = avatarURL {
                AvatarAsyncImage(avatarPath: avatarPath, size: 32)
                    .frame(width: 32, height: 32)
                    .clipShape(Circle())
            } else {
                KindredInitialsAvatar(
                    initials: String(name.prefix(1)).uppercased(),
                    size: 32
                )
            }
            Text(name)
                .font(.kindredLabel)
                .foregroundStyle(KindredTheme.ash)
            Spacer()
            Text(role.uppercased())
                .font(.kindredMicro)
                .tracking(0.6)
                .foregroundStyle(KindredTheme.mist)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .if(!isLast) { view in
            view.overlay(alignment: .bottom) {
                Rectangle().fill(KindredTheme.line).frame(height: 1)
            }
        }
    }

    // MARK: - Library Section

    private var librarySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredEyebrow(text: "Library")
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 6)

            VStack(spacing: 0) {
                // Backup row — links to backup detail
                NavigationLink {
                    BackupDetailView()
                } label: {
                    settingsRow(title: "Backup & storage", detail: viewModel.isHealthy ? "Connected" : "Offline") {
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(KindredTheme.mist)
                    }
                }
                .contentShape(Rectangle())
            .buttonStyle(.plain)

                Divider().padding(.leading, 14)

                settingsRow(title: "Auto-backup", detail: nil) {
                    KindredToggle(isOn: Binding(
                        get: { syncManager.autoSyncEnabled },
                        set: { syncManager.setAutoSync($0) }
                    ))
                }

                Divider().padding(.leading, 14)

                NavigationLink {
                    IntelligenceView()
                } label: {
                    settingsRow(title: "Intelligence", detail: IntelligenceState.shared.enabled ? "On" : "Off") {
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(KindredTheme.mist)
                    }
                }
                .contentShape(Rectangle())
            .buttonStyle(.plain)

                Divider().padding(.leading, 14)

                NavigationLink {
                    NotificationsSettingsView()
                } label: {
                    settingsRow(title: "Notifications", detail: nil) {
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(KindredTheme.mist)
                    }
                }
                .contentShape(Rectangle())
            .buttonStyle(.plain)

                // Admin-only: Scan & maintenance
                if viewModel.session.currentUser?.role == "admin" {
                    Divider().padding(.leading, 14)

                    NavigationLink {
                        AdminScanView()
                    } label: {
                        settingsRow(title: "Scan & maintenance", detail: nil) {
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(KindredTheme.mist)
                        }
                    }
                    .contentShape(Rectangle())
            .buttonStyle(.plain)
                }
            }
            .kindredGroupedCard()
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Privacy Section

    private var privacySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredEyebrow(text: "Privacy")
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 6)

            VStack(spacing: 0) {
                Button {
                    showPrivacyInfo = true
                } label: {
                    settingsRow(title: "Library is private to household", detail: nil) {
                        HStack(spacing: 6) {
                            Text("Confirmed")
                                .font(.kindredMicro)
                                .tracking(0.6)
                                .foregroundStyle(KindredTheme.forest)
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(KindredTheme.mist)
                        }
                    }
                }
                .contentShape(Rectangle())
            .buttonStyle(.plain)

                Divider().padding(.leading, 14)

                Button {
                    showBackendURL = true
                } label: {
                    settingsRow(title: "Backend status", detail: nil) {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(viewModel.isHealthy ? KindredTheme.forest : KindredTheme.rosehip)
                                .frame(width: 8, height: 8)
                            Text(viewModel.isHealthy ? "Online" : "Offline")
                                .font(.kindredMicro)
                                .foregroundStyle(KindredTheme.mist)
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(KindredTheme.mist)
                        }
                    }
                }
                .contentShape(Rectangle())
            .buttonStyle(.plain)
            }
            .kindredGroupedCard()
            .padding(.horizontal, 16)
        }
        .sheet(isPresented: $showPrivacyInfo) {
            PrivacyInfoSheet {
                showPrivacyInfo = false
            }
            .presentationDetents([.height(340)])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showBackendURL) {
            BackendInfoSheet(
                isHealthy: viewModel.isHealthy,
                onDismiss: { showBackendURL = false }
            )
            .presentationDetents([.height(320)])
            .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Settings Row Helper

    private func settingsRow<Trailing: View>(
        title: String,
        detail: String?,
        @ViewBuilder trailing: () -> Trailing
    ) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.kindredLabel)
                    .foregroundStyle(KindredTheme.ash)
                if let detail {
                    Text(detail)
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.mist)
                }
            }
            Spacer()
            trailing()
        }
        .padding(.horizontal, 14)
        .contentShape(Rectangle())
        .padding(.vertical, 14)
    }
}

// MARK: - Backup Detail View (nested under Settings)

struct BackupDetailView: View {
    @State private var uploadVM = UploadViewModel()
    @State private var syncManager = SyncManager.shared
    @State private var uploader = FlickrUploader.shared
    @State private var showFreeSpaceConfirm = false
    @State private var showFreedAlert = false
    @State private var freedCount = 0

    var body: some View {
        Group {
            if uploadVM.photoManager.authorizationStatus == .denied || uploadVM.photoManager.authorizationStatus == .restricted {
                // Denied — take them directly to system Settings
                VStack(spacing: 20) {
                    Spacer()
                    Image(systemName: "lock.shield")
                        .font(.system(size: 48, weight: .light))
                        .foregroundStyle(KindredTheme.rosehip.opacity(0.5))
                    Text("Photo access is off")
                        .font(.kindredH3)
                        .foregroundStyle(KindredTheme.ash)
                    Text("Tap below to open Settings and enable photo access for Kindred Photos.")
                        .font(.kindredBody)
                        .foregroundStyle(KindredTheme.mist)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                    KindredButton(title: "Open Settings", icon: "gear", style: .primary) {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    }
                    .padding(.horizontal, 40)
                    Spacer()
                }
            } else {
                // Authorized or will auto-prompt — show backup UI
                backupContent
            }
        }
        .kindredPaperBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // Auto-trigger permission prompt if not determined — don't make them find a button
            await uploadVM.requestAccess()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            // Re-check auth when coming back from Settings
            Task { await uploadVM.requestAccess() }
        }
    }

    private var backupContent: some View {
        ScrollView {
            VStack(spacing: 0) {
                KindredPageHeader(
                    eyebrow: "Backup status",
                    title: backupTitle
                )

                // Progress ring
                progressRing
                    .padding(.top, 20)

                // Upload in progress
                if uploader.isUploading {
                    uploadProgressCard
                        .padding(.horizontal, 16)
                        .padding(.top, 16)
                }

                // Action buttons
                actionButtons
                    .padding(.horizontal, 16)
                    .padding(.top, 16)

                // Settings list
                settingsList
                    .padding(.top, 20)

                // Not backed up count
                if !uploadVM.photoManager.notUploadedPhotos.isEmpty && !uploader.isUploading {
                    notBackedUpSection
                        .padding(.top, 16)
                }

                Spacer().frame(height: 110)
            }
        }
    }

    private var backupTitle: String {
        if uploader.isUploading {
            return "Uploading..."
        }
        let remaining = uploadVM.photoManager.notUploadedPhotos.count
        if remaining == 0 { return "You're caught up." }
        return "\(remaining) remaining."
    }

    // MARK: - Upload Progress

    private var uploadProgressCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(uploader.currentAssetTitle)
                    .font(.kindredLabel)
                    .foregroundStyle(KindredTheme.ash)
                Spacer()
                Text("\(uploader.uploadedCount)/\(uploader.totalCount)")
                    .font(.kindredMeta)
                    .foregroundStyle(KindredTheme.mist)
            }
            ProgressView(value: uploader.totalProgress)
                .tint(KindredTheme.forest)
            if let error = uploader.lastError {
                Text(error)
                    .font(.kindredMicro)
                    .foregroundStyle(KindredTheme.rosehip)
            }
        }
        .padding(14)
        .kindredGroupedCard()
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        VStack(spacing: 10) {
            if !uploadVM.photoManager.notUploadedPhotos.isEmpty && !uploader.isUploading {
                KindredButton(
                    title: "Back up \(uploadVM.photoManager.notUploadedPhotos.count) photos now",
                    icon: "icloud.and.arrow.up",
                    style: .primary,
                    isFullWidth: true
                ) {
                    Task {
                        uploadVM.selectAll()
                        await uploadVM.uploadSelected()
                    }
                }
            }

            if uploadVM.photoManager.notUploadedPhotos.isEmpty && !uploader.isUploading {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(KindredTheme.forest)
                    Text("All photos are backed up")
                        .font(.kindredLabel)
                        .foregroundStyle(KindredTheme.forest)
                }
                .frame(maxWidth: .infinity)
                .padding(14)
                .background(KindredTheme.forest.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
            }
        }
    }

    // MARK: - Not Backed Up Section

    private let thumbColumns = [
        GridItem(.flexible(), spacing: 2),
        GridItem(.flexible(), spacing: 2),
        GridItem(.flexible(), spacing: 2),
        GridItem(.flexible(), spacing: 2),
    ]

    private var notBackedUpSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                KindredEyebrow(text: "Not backed up")
                Spacer()
                Text("\(uploadVM.photoManager.notUploadedPhotos.count)")
                    .font(.kindredMeta)
                    .foregroundStyle(KindredTheme.mist)
            }
            .padding(.horizontal, 20)

            LazyVGrid(columns: thumbColumns, spacing: 2) {
                ForEach(uploadVM.photoManager.notUploadedPhotos.prefix(20), id: \.localIdentifier) { asset in
                    PhotoAssetCell(asset: asset, isSelected: false)
                        .aspectRatio(1, contentMode: .fill)
                }
            }
            .padding(.horizontal, 16)

            if uploadVM.photoManager.notUploadedPhotos.count > 20 {
                Text("+ \(uploadVM.photoManager.notUploadedPhotos.count - 20) more")
                    .font(.kindredMeta)
                    .foregroundStyle(KindredTheme.mist)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
            }
        }
    }

    // MARK: - Progress Ring

    private var progressRing: some View {
        let progress = backupProgress

        return ZStack {
            // Track
            Circle()
                .stroke(Color(hex: 0x4A281A).opacity(0.08), lineWidth: 14)

            // Progress arc
            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    LinearGradient(
                        colors: [KindredTheme.forest, KindredTheme.lichen],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    style: StrokeStyle(lineWidth: 14, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: 1.2), value: progress)

            // Center text
            VStack(spacing: 6) {
                Text("\(Int(progress * 100))%")
                    .font(.display(42, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                Text("\(uploadVM.photoManager.uploadedCount) OF \(uploadVM.photoManager.uploadedCount + uploadVM.photoManager.notUploadedPhotos.count)")
                    .font(.kindredMicro)
                    .tracking(1.4)
                    .foregroundStyle(KindredTheme.mist)
            }
        }
        .frame(width: 200, height: 200)
    }

    private var backupProgress: CGFloat {
        let uploaded = uploadVM.photoManager.uploadedCount
        let notUploaded = uploadVM.photoManager.notUploadedPhotos.count
        let total = uploaded + notUploaded
        guard total > 0 else { return 0 }
        return min(1.0, CGFloat(uploaded) / CGFloat(total))
    }

    // MARK: - Settings List

    private var settingsList: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Auto-backup")
                        .font(.kindredLabel)
                        .foregroundStyle(KindredTheme.ash)
                    Text("On")
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.mist)
                }
                Spacer()
                KindredToggle(isOn: Binding(
                    get: { syncManager.autoSyncEnabled },
                    set: { syncManager.setAutoSync($0) }
                ))
            }
            .padding(14)

            Divider().padding(.leading, 14)

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Including videos")
                        .font(.kindredLabel)
                        .foregroundStyle(KindredTheme.ash)
                    Text("On")
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.mist)
                }
                Spacer()
                KindredToggle(isOn: .constant(true))
            }
            .padding(14)

            Divider().padding(.leading, 14)

            Button {
                showFreeSpaceConfirm = true
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Free up device space")
                            .font(.kindredLabel)
                            .foregroundStyle(KindredTheme.ash)
                        Text(uploadVM.photoManager.uploadedCount > 0
                            ? "Remove \(uploadVM.photoManager.uploadedCount) backed-up items · save \(uploadVM.formattedSavings)"
                            : "No backed-up photos to remove")
                            .font(.kindredMeta)
                            .foregroundStyle(KindredTheme.mist)
                    }
                    Spacer()
                    Image(systemName: "trash")
                        .font(.system(size: 14))
                        .foregroundStyle(uploadVM.photoManager.uploadedCount > 0 ? KindredTheme.ember : KindredTheme.mist)
                }
                .padding(14)
            }
            .contentShape(Rectangle())
            .buttonStyle(.plain)
            .disabled(uploadVM.photoManager.uploadedCount == 0)
        }
        .kindredGroupedCard()
        .padding(.horizontal, 16)
        .sheet(isPresented: $showFreeSpaceConfirm) {
            FreeSpaceConfirmSheet(
                count: uploadVM.photoManager.uploadedCount,
                savings: uploadVM.formattedSavings,
                onConfirm: {
                    showFreeSpaceConfirm = false
                    Task {
                        do {
                            let count = try await uploadVM.freeUpSpace()
                            freedCount = count
                            // Refresh photo library to update counts
                            await uploadVM.refreshPhotos()
                            showFreedAlert = true
                        } catch {}
                    }
                },
                onCancel: { showFreeSpaceConfirm = false }
            )
            .presentationDetents([.height(380)])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showFreedAlert) {
            SpaceFreedSheet(count: freedCount) {
                showFreedAlert = false
            }
            .presentationDetents([.height(300)])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Free Space Confirmation Sheet

struct FreeSpaceConfirmSheet: View {
    let count: Int
    let savings: String
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
            Text("Free up \(savings)?")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ash)
                .padding(.top, 16)

            // Body
            Text("**\(count) photos** on this device are already safely backed up to Flickr. Removing them frees up \(savings) of storage.")
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
                    title: "Remove \(count) local copies",
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
        .background(KindredTheme.paper)
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

            Text("Removed \(count) items from this device. They're still safe in your Kindred library on Flickr.")
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
        .background(KindredTheme.paper)
    }
}

// MARK: - Sign Out Sheet

struct SignOutSheet: View {
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "rectangle.portrait.and.arrow.right")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(KindredTheme.ember)
                .padding(.top, 32)

            Text("Sign out?")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ash)
                .padding(.top, 16)

            Text("Are you sure you want to sign out of your household?")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.pine)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            Spacer()

            VStack(spacing: 10) {
                KindredButton(
                    title: "Sign out",
                    icon: "rectangle.portrait.and.arrow.right",
                    style: .danger,
                    isFullWidth: true
                ) {
                    onConfirm()
                }

                KindredButton(
                    title: "Stay signed in",
                    style: .ghost,
                    isFullWidth: true
                ) {
                    onCancel()
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(KindredTheme.paper)
    }
}

// MARK: - Privacy Info Sheet

struct PrivacyInfoSheet: View {
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(KindredTheme.forest)
                .padding(.top, 32)

            Text("Privacy")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ash)
                .padding(.top, 16)

            Text("Your photo library is stored privately within your household. No data is shared outside your account. All intelligence processing runs on your server and never leaves your household.")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.pine)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            Spacer()

            KindredButton(title: "Got it", style: .dark, isFullWidth: true) {
                onDismiss()
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(KindredTheme.paper)
    }
}

// MARK: - Backend Info Sheet

struct BackendInfoSheet: View {
    let isHealthy: Bool
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "server.rack")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(KindredTheme.slateBlue)
                .padding(.top, 32)

            Text("Backend")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ash)
                .padding(.top, 16)

            VStack(spacing: 6) {
                Text("Server: https://api.kindredphotos.app")
                    .font(.kindredBody)
                    .foregroundStyle(KindredTheme.pine)

                HStack(spacing: 6) {
                    Circle()
                        .fill(isHealthy ? KindredTheme.forest : KindredTheme.rosehip)
                        .frame(width: 8, height: 8)
                    Text("Status: \(isHealthy ? "Online" : "Offline")")
                        .font(.kindredBody)
                        .foregroundStyle(KindredTheme.pine)
                }
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, 32)
            .padding(.top, 8)

            Spacer()

            KindredButton(title: "Got it", style: .dark, isFullWidth: true) {
                onDismiss()
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(KindredTheme.paper)
    }
}
