import SwiftUI
import Photos

struct SettingsView: View {
    @State private var viewModel = SettingsViewModel()
    @State private var syncManager = SyncManager.shared
    @State private var showLogoutConfirm = false
    @State private var showPrivacyInfo = false
    @State private var showBackendURL = false
    @State private var showAvatarPicker = false
    @State private var members: [HouseholdMember] = []
    @State private var invites: [InviteCode] = []
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isIPad: Bool { horizontalSizeClass == .regular }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    KindredPageHeader(title: "Settings")

                    profileCard
                        .padding(.horizontal, 16)
                        .padding(.bottom, 18)

                    group("Household") {
                        NavigationLink {
                            HouseholdMembersView()
                        } label: {
                            row(icon: "person.2", title: "Members", detail: memberCount)
                        }
                        .buttonStyle(.plain)

                        rowDivider

                        NavigationLink {
                            InviteCodesView()
                        } label: {
                            row(icon: "key", title: "Invite codes", detail: inviteDetail)
                        }
                        .buttonStyle(.plain)

                        rowDivider

                        NavigationLink {
                            NotificationsSettingsView()
                        } label: {
                            row(icon: "bell", title: "Notifications")
                        }
                        .buttonStyle(.plain)
                    }

                    group("This device") {
                        toggleRow(
                            "Back up my photos",
                            isOn: Binding(
                                get: { syncManager.autoSyncEnabled },
                                set: { syncManager.setAutoSync($0) }
                            )
                        )

                        rowDivider

                        toggleRow(
                            "Only on Wi-Fi",
                            isOn: Binding(
                                get: { syncManager.wifiOnly },
                                set: { syncManager.setWiFiOnly($0) }
                            )
                        )

                        rowDivider

                        Button {
                            showBackendURL = true
                        } label: {
                            row(title: "Server", subtitle: serverLine)
                        }
                        .buttonStyle(.plain)
                    }

                    group("Library") {
                        NavigationLink {
                            BackupDetailView()
                        } label: {
                            row(
                                title: "Backup & storage",
                                detail: viewModel.isHealthy ? "Connected" : "Offline"
                            )
                        }
                        .buttonStyle(.plain)

                        rowDivider

                        NavigationLink {
                            IntelligenceView()
                        } label: {
                            row(
                                title: "Intelligence",
                                detail: IntelligenceState.shared.enabled ? "On" : "Off"
                            )
                        }
                        .buttonStyle(.plain)

                        if viewModel.session.currentUser?.role == "admin" {
                            rowDivider

                            NavigationLink {
                                AdminScanView()
                            } label: {
                                row(title: "Scan & maintenance")
                            }
                            .buttonStyle(.plain)
                        }

                        rowDivider

                        Button {
                            showPrivacyInfo = true
                        } label: {
                            row(title: "Library is private to household", detail: "Confirmed")
                        }
                        .buttonStyle(.plain)
                    }

                    KindredButton(
                        title: "Sign out",
                        icon: "rectangle.portrait.and.arrow.right",
                        style: .danger,
                        isFullWidth: true
                    ) {
                        showLogoutConfirm = true
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 22)

                    footer
                }
                .frame(maxWidth: isIPad ? 640 : .infinity, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(KindredTheme.bg.ignoresSafeArea())
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
            .sheet(isPresented: $showPrivacyInfo) {
                PrivacyInfoSheet { showPrivacyInfo = false }
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
            .task {
                async let health: () = viewModel.checkHealth()
                async let syncs: () = viewModel.loadSyncs()
                async let job: () = viewModel.checkActiveJob()
                _ = await (health, syncs, job)
                // Admin-only endpoints; a member gets a 403 and the counts
                // simply stay off the rows.
                members = (try? await APIClient.shared.householdMembers()) ?? []
                invites = (try? await APIClient.shared.inviteCodes()) ?? []
            }
        }
    }

    // MARK: - Profile card

    private var profileCard: some View {
        Button {
            showAvatarPicker = true
        } label: {
            HStack(spacing: 13) {
                if let user = viewModel.session.currentUser {
                    if let avatarPath = user.avatar_url {
                        AvatarAsyncImage(avatarPath: avatarPath, size: 48)
                            .frame(width: 48, height: 48)
                            .clipShape(Circle())
                    } else {
                        KindredInitialsAvatar(
                            initials: String(user.display_name.prefix(1)).uppercased(),
                            size: 48
                        )
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(user.display_name)
                            .font(.display(17, weight: .semibold, relativeTo: .headline))
                            .foregroundStyle(KindredTheme.ink)
                        Text("@\(user.username) \u{00b7} \(user.role)")
                            .font(.kindredMeta)
                            .foregroundStyle(KindredTheme.inkMeta)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(KindredTheme.inkMeta)
                }
            }
            .padding(14)
            .kindredGroupedCard()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Your profile. Opens the avatar picker.")
        .sheet(isPresented: $showAvatarPicker) {
            if let user = viewModel.session.currentUser {
                AvatarPickerView(
                    currentAvatarURL: user.avatar_url,
                    userName: user.display_name,
                    onSaved: { newURL in
                        viewModel.session.restoreUser(
                            UserInfo(
                                id: user.id, username: user.username,
                                display_name: user.display_name, role: user.role,
                                avatar_url: newURL
                            )
                        )
                    }
                )
            }
        }
    }

    // MARK: - Grouped inset list

    private func group<Content: View>(
        _ title: String, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredEyebrow(text: title, color: KindredTheme.inkMeta)
                .padding(.horizontal, 20)
                .padding(.bottom, 8)

            VStack(spacing: 0) { content() }
                .kindredGroupedCard()
                .padding(.horizontal, 16)
        }
        .padding(.bottom, 18)
    }

    private var rowDivider: some View {
        Rectangle()
            .fill(KindredTheme.hairlineSoft)
            .frame(height: 1)
    }

    private func row(
        icon: String? = nil,
        title: String,
        subtitle: String? = nil,
        detail: String? = nil
    ) -> some View {
        HStack(spacing: 12) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .regular))
                    .foregroundStyle(KindredTheme.inkSecondary)
                    .frame(width: 20)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body(14, weight: .semibold, relativeTo: .subheadline))
                    .foregroundStyle(KindredTheme.ink)
                if let subtitle {
                    Text(subtitle)
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.inkMeta)
                }
            }
            Spacer()
            if let detail {
                Text(detail)
                    .font(.kindredMeta)
                    .foregroundStyle(KindredTheme.inkMeta)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(KindredTheme.inkMeta)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func toggleRow(_ title: String, isOn: Binding<Bool>) -> some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.body(14, weight: .semibold, relativeTo: .subheadline))
                .foregroundStyle(KindredTheme.ink)
            Spacer()
            Toggle(title, isOn: isOn)
                .labelsHidden()
                .tint(KindredTheme.accent)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Footer

    private var footer: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                Image("KindlingLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 18, height: 18)
                Text("Kindling Signal")
                    .font(.kindredMeta)
                    .foregroundStyle(KindredTheme.inkMeta)
            }
            Text("Kindred Photos \u{00b7} v1.0")
                .font(.kindredMicro)
                .foregroundStyle(KindredTheme.inkMeta)
            Text("\u{00a9} \(String(Calendar.current.component(.year, from: Date()))) Kindling Signal")
                .font(.kindredMicro)
                .foregroundStyle(KindredTheme.inkMeta)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 24)
        .padding(.bottom, isIPad ? 32 : 110)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Detail lines

    private var memberCount: String? {
        members.isEmpty ? nil : "\(members.count)"
    }

    private var inviteDetail: String? {
        guard !invites.isEmpty else { return nil }
        return invites.count == 1 ? "1 active" : "\(invites.count) active"
    }

    /// The host the app is actually talking to, plus whether it answered.
    private var serverLine: String {
        let host = URL(string: APIClient.publicBaseURL)?.host ?? "not set"
        return "\(host) \u{00b7} \(viewModel.isHealthy ? "connected" : "offline")"
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
                .stroke(KindredTheme.fillStrong, lineWidth: 14)

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

            Divider().overlay(KindredTheme.hairline).padding(.leading, 14)

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

            Divider().overlay(KindredTheme.hairline).padding(.leading, 14)

            Button {
                showFreeSpaceConfirm = true
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Free up device space")
                            .font(.kindredLabel)
                            .foregroundStyle(KindredTheme.ash)
                        Text(uploadVM.photoManager.cleanupEligibleCount > 0
                            ? "Remove \(uploadVM.photoManager.cleanupEligibleCount) verified items · save \(uploadVM.formattedSavings)"
                            : uploadVM.photoManager.uploadedCount > 0
                                ? "Verify \(uploadVM.photoManager.uploadedCount) backups before removal"
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

            if let cleanupError = uploadVM.cleanupError {
                Text(cleanupError)
                    .font(.kindredMicro)
                    .foregroundStyle(KindredTheme.rosehip)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 12)
            }
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
        .background(KindredTheme.sheet)
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
        .background(KindredTheme.sheet)
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
        .background(KindredTheme.sheet)
    }
}

// MARK: - Backend Info Sheet

struct BackendInfoSheet: View {
    let isHealthy: Bool
    let onDismiss: () -> Void
    private var isDemo: Bool { DemoDataProvider.shared.isActive }

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: isDemo ? "play.circle" : "server.rack")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(isDemo ? KindredTheme.forest : KindredTheme.slateBlue)
                .padding(.top, 32)

            Text(isDemo ? "Demo Mode" : "Backend")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ash)
                .padding(.top, 16)

            VStack(spacing: 6) {
                if isDemo {
                    Text("Exploring with sample data")
                        .font(.kindredBody)
                        .foregroundStyle(KindredTheme.pine)
                    Text("No server connection needed")
                        .font(.kindredCaption)
                        .foregroundStyle(KindredTheme.mist)
                } else {
                    Text("Server: Connected")
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
        .background(KindredTheme.sheet)
    }
}
