import SwiftUI

struct SettingsView: View {
    @State private var session = SessionManager.shared
    @State private var showsAdvanced = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    KindredPageHeader(title: "Settings")
                        .padding(.horizontal, -KindredTheme.gutter)
                    account

                    if session.isReadOnlyReview {
                        Text("This sample library is read-only. You can try an on-device import from Library.")
                            .font(.kindredBody)
                            .foregroundStyle(KindredTheme.inkSecondary)
                    } else {
                        VStack(spacing: 0) {
                            NavigationLink {
                                BackupSettingsView()
                            } label: {
                                SettingsLinkLabel("Backup & Sync", icon: "arrow.triangle.2.circlepath")
                            }
                            .accessibilityIdentifier("settings.backup")

                            Divider()

                            NavigationLink {
                                StorageSettingsView()
                            } label: {
                                SettingsLinkLabel("Storage", icon: "externaldrive")
                            }
                            .accessibilityIdentifier("settings.storage")
                        }
                        .buttonStyle(.plain)
                        .kindredGroupedCard()
                    }

                    VStack(spacing: 0) {
                        NavigationLink {
                            NotificationsSettingsView()
                        } label: {
                            SettingsLinkLabel("Notifications", icon: "bell")
                        }

                        if session.currentUser?.role == "admin" {
                            Divider()

                            if !session.isReadOnlyReview {
                                NavigationLink {
                                    HouseholdSettingsView()
                                } label: {
                                    SettingsLinkLabel("Household", icon: "person.2")
                                }

                                Divider()
                            }

                            NavigationLink {
                                IndexingProgressView()
                            } label: {
                                SettingsLinkLabel("Indexing progress", icon: "waveform.path")
                            }
                            .accessibilityIdentifier("settings.indexingProgress")
                        }
                    }
                    .buttonStyle(.plain)
                    .kindredGroupedCard()

                    DisclosureGroup("Advanced", isExpanded: $showsAdvanced) {
                        VStack(spacing: 0) {
                            NavigationLink {
                                IntelligenceView()
                            } label: {
                                SettingsLinkLabel("Intelligence", icon: "sparkle")
                            }

                            if session.currentUser?.role == "admin" && !session.isReadOnlyReview {
                                Divider()

                                NavigationLink {
                                    AdminScanView()
                                } label: {
                                    SettingsLinkLabel("Scan & maintenance", icon: "wrench.and.screwdriver")
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, -14)
                    }
                    .disclosureGroupStyle(SettingsDisclosureStyle())
                    .kindredGroupedCard()
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .kindredPaperBackground()
            .navigationTitle("Settings")
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var account: some View {
        NavigationLink {
            AccountSettingsView()
        } label: {
            HStack(spacing: 12) {
                if let user = session.currentUser {
                    AccountAvatar(user: user)
                } else {
                    Image(systemName: "person.crop.circle")
                        .font(.system(size: 38))
                        .foregroundStyle(KindredTheme.inkSecondary)
                        .accessibilityHidden(true)
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(session.currentUser?.display_name ?? "Account")
                        .font(.kindredLabel)
                        .foregroundStyle(KindredTheme.ink)
                    if session.currentUser != nil {
                        Text("Account")
                            .font(.kindredCaption)
                            .foregroundStyle(KindredTheme.inkSecondary)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(KindredTheme.inkMeta)
                    .accessibilityHidden(true)
            }
            .padding(14)
            .contentShape(Rectangle())
            .kindredGroupedCard()
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("settings.account")
    }
}

private struct AccountSettingsView: View {
    @State private var viewModel = SettingsViewModel()
    @State private var showAvatarPicker = false
    @State private var showPrivacy = false
    @State private var showSignOut = false

    var body: some View {
        SettingsPage("Account") {
            VStack(spacing: 0) {
                if let user = viewModel.session.currentUser {
                    Button {
                        showAvatarPicker = true
                    } label: {
                        HStack(spacing: 12) {
                            AccountAvatar(user: user)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(user.display_name)
                                    .font(.kindredLabel)
                                    .foregroundStyle(KindredTheme.ink)
                                Text("@\(user.username)")
                                    .font(.kindredCaption)
                                    .foregroundStyle(KindredTheme.inkSecondary)
                            }
                            Spacer()
                            Image(systemName: "pencil")
                                .foregroundStyle(KindredTheme.accent)
                        }
                        .padding(14)
                        .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Edit profile photo")
                    .disabled(viewModel.session.isReadOnlyReview)

                    Divider()
                }

                if HostedSocialSignIn.supports(server: APIClient.publicBaseURL) {
                    Link(destination: HostedSocialSignIn.integrationsURL) {
                        SettingsLinkLabel("Sign-in methods", icon: "person.badge.key")
                    }
                    .accessibilityHint("Opens Kindred settings in your browser")

                    Divider()
                }

                if !DemoDataProvider.shared.isActive && !viewModel.session.isReadOnlyReview {
                    NavigationLink {
                        AccountManagementView()
                    } label: {
                        SettingsLinkLabel("Manage account", icon: "person.crop.circle.badge.minus")
                    }

                    Divider()
                }

                Button {
                    showPrivacy = true
                } label: {
                    SettingsLinkLabel("Privacy", icon: "lock.shield")
                }

                Divider()

                Link(destination: URL(string: "https://kindredphotos.app/privacy")!) {
                    SettingsLinkLabel("Privacy policy", icon: "doc.text")
                }
            }
            .buttonStyle(.plain)
            .kindredGroupedCard()

            KindredButton(title: "Sign out", icon: "rectangle.portrait.and.arrow.right",
                          style: .danger, isFullWidth: true) {
                showSignOut = true
            }
        }
        .sheet(isPresented: $showAvatarPicker) {
            if let user = viewModel.session.currentUser {
                AvatarPickerView(currentAvatarURL: user.avatar_url, userName: user.display_name) { url in
                    viewModel.session.restoreUser(UserInfo(
                        id: user.id, username: user.username, display_name: user.display_name,
                        role: user.role, avatar_url: url
                    ))
                }
            }
        }
        .sheet(isPresented: $showPrivacy) {
            PrivacyInfoSheet { showPrivacy = false }
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showSignOut) {
            SignOutSheet(onConfirm: {
                showSignOut = false
                viewModel.logout()
            }, onCancel: { showSignOut = false })
            .presentationDetents([.height(320)])
            .presentationDragIndicator(.visible)
        }
    }
}

private struct AccountAvatar: View {
    let user: UserInfo

    var body: some View {
        if let path = user.avatar_url {
            AvatarAsyncImage(avatarPath: path, size: 44)
                .frame(width: 44, height: 44)
                .clipShape(Circle())
                .accessibilityHidden(true)
        } else {
            KindredInitialsAvatar(initials: String(user.display_name.prefix(1)).uppercased(), size: 44)
                .accessibilityHidden(true)
        }
    }
}

private struct HouseholdSettingsView: View {
    var body: some View {
        SettingsPage("Household") {
            VStack(spacing: 0) {
                NavigationLink {
                    HouseholdMembersView()
                } label: {
                    SettingsLinkLabel("Members", icon: "person.2")
                }

                Divider()

                NavigationLink {
                    InviteCodesView()
                } label: {
                    SettingsLinkLabel("Invite codes", icon: "key")
                }
            }
            .buttonStyle(.plain)
            .kindredGroupedCard()
        }
    }
}

struct SettingsPage<Content: View>: View {
    let title: String
    let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) { content }
                .padding(16)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
        }
        .kindredPaperBackground()
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
    }
}

struct SettingsLinkLabel: View {
    let title: String
    let icon: String

    init(_ title: String, icon: String) {
        self.title = title
        self.icon = icon
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.kindredLabel)
                .foregroundStyle(KindredTheme.inkSecondary)
                .frame(width: 20)
                .accessibilityHidden(true)
            Text(title)
                .font(.kindredLabel)
                .foregroundStyle(KindredTheme.ink)
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(KindredTheme.inkMeta)
                .accessibilityHidden(true)
        }
        .padding(14)
        .frame(minHeight: 48)
        .contentShape(Rectangle())
    }
}

struct SettingsDisclosureStyle: DisclosureGroupStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                configuration.isExpanded.toggle()
            } label: {
                HStack(spacing: 12) {
                    configuration.label
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(KindredTheme.inkMeta)
                        .rotationEffect(.degrees(configuration.isExpanded ? 90 : 0))
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 48)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(configuration.isExpanded ? "Expanded" : "Collapsed")

            if configuration.isExpanded {
                configuration.content
                    .padding(.bottom, 14)
            }
        }
        .font(.kindredLabel)
        .foregroundStyle(KindredTheme.ink)
        .padding(.horizontal, 14)
    }
}

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

            Text("Library access is limited to your household. If Flickr is connected, it stores an additional copy of your backups.")
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
