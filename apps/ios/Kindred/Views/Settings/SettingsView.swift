import SwiftUI

enum KindredLinks {
    static let hostedLibrary = URL(string: "https://www.kindredphotos.app")!
    static let documentation = hostedLibrary.appending(path: "docs")
    static let privacy = hostedLibrary.appending(path: "privacy")

    static func webLibrary(_ value: String) -> URL? {
        let input = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let normalized = PairingService.normaliseServer(input),
              let components = URLComponents(string: normalized),
              let scheme = components.scheme?.lowercased(), ["https", "http"].contains(scheme),
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil else { return nil }
        return components.url
    }
}

struct SettingsView: View {
    @State private var viewModel = SettingsViewModel()
    @State private var confirmingSignOut = false
    @State private var findingWebLibrary = false
    @State private var editingWebLibrary = false
    @State private var webLibraryAddress = ""
    @Environment(\.horizontalSizeClass) private var widthClass
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    private var expanded: Bool { KindredTabletLayout.isExpanded(widthClass) }
    private var isDemo: Bool { DemoDataProvider.shared.isActive }
    private var signOutTitle: String { isDemo ? "Leave demo" : "Sign out" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: expanded ? 22 : 16) {
                    KindredPageHeader(title: "Settings")
                        .padding(.horizontal, -KindredTheme.gutter)
                    accountSummary

                    VStack(alignment: .leading, spacing: 8) {
                        Text("This device")
                            .font(.kindredLabel)
                            .foregroundStyle(KindredTheme.inkSecondary)
                            .accessibilityAddTraits(.isHeader)
                        deviceSettings
                    }

                    VStack(spacing: 0) {
                        Button(action: openWebSettings) {
                            SettingsLinkLabel("Manage on the web", icon: "globe",
                                              detail: findingWebLibrary ? "Finding your web library…" : "Profile, household, and library settings",
                                              isExternal: true)
                        }
                        .disabled(findingWebLibrary)
                        .accessibilityIdentifier("settings.manageOnWeb")
                        .accessibilityHint("Opens your Kindred library in a browser")

                        Divider()

                        Link(destination: KindredLinks.documentation) {
                            SettingsLinkLabel("Help & Docs", icon: "book", isExternal: true)
                        }
                        .accessibilityIdentifier("Help & Docs")
                    }
                    .buttonStyle(.plain)
                    .kindredGroupedCard()

                    if !isDemo && !viewModel.session.isReadOnlyReview {
                        NavigationLink {
                            AccountManagementView()
                        } label: {
                            SettingsLinkLabel("Manage account", icon: "person.crop.circle", detail: "Account deletion and household ownership")
                        }
                        .buttonStyle(.plain)
                        .kindredGroupedCard()
                    }

                    HStack(spacing: 20) {
                        Button {
                            confirmingSignOut = true
                        } label: {
                            Text(signOutTitle)
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                        }
                        .foregroundStyle(KindredTheme.dangerText)
                        .accessibilityIdentifier("settings.signOut")

                        Spacer(minLength: 4)

                        Link(destination: KindredLinks.privacy) {
                            Text("Privacy policy")
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                        }
                        .foregroundStyle(KindredTheme.inkSecondary)
                    }
                    .font(.kindredLabel)
                    .buttonStyle(.plain)
                    .padding(.horizontal, 14)
                }
                .padding(.horizontal, expanded ? KindredTabletLayout.gutter : 16)
                .padding(.top, expanded ? 15 : 0)
                .padding(.bottom, 32)
                .frame(maxWidth: expanded ? 760 : 640)
                .frame(maxWidth: .infinity)
            }
            .kindredPaperBackground()
            .navigationTitle("Settings")
            .toolbar(.hidden, for: .navigationBar)
            .onChange(of: scenePhase) { _, phase in
                if phase == .active, viewModel.session.isAuthenticated, !isDemo {
                    Task { await viewModel.session.refreshUser() }
                }
            }
            .sheet(isPresented: $confirmingSignOut) {
                SignOutSheet(onConfirm: {
                    confirmingSignOut = false
                    viewModel.logout()
                }, onCancel: { confirmingSignOut = false }, isDemo: isDemo)
                .presentationDetents([.height(320)])
                .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $editingWebLibrary) { webLibrarySheet }
        }
    }

    private var accountSummary: some View {
        HStack(spacing: 12) {
            if let user = viewModel.session.currentUser, !isDemo {
                AccountAvatar(user: user)
                VStack(alignment: .leading, spacing: 4) {
                    Text(user.display_name).font(.kindredLabel)
                    Text("@\(user.username)")
                        .font(.kindredCaption)
                        .foregroundStyle(KindredTheme.inkSecondary)
                }
            } else {
                Image(systemName: "person.crop.circle")
                    .font(.system(size: 36))
                    .accessibilityHidden(true)
                Text(isDemo ? "Demo library" : "Account").font(.kindredLabel)
            }
        }
        .foregroundStyle(KindredTheme.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .accessibilityElement(children: .combine)
    }

    private var deviceSettings: some View {
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
                SettingsLinkLabel("Device storage", icon: "externaldrive")
            }
            .accessibilityIdentifier("settings.storage")

            Divider()

            NavigationLink {
                NotificationsSettingsView()
            } label: {
                SettingsLinkLabel("Notifications", icon: "bell")
            }
        }
        .buttonStyle(.plain)
        .kindredGroupedCard()
    }

    private var webLibrarySheet: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://photos.example.com", text: $webLibraryAddress)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("settings.webLibraryAddress")
                } footer: {
                    Text("Enter the address you use to open your Kindred library in a browser.")
                }
                Button("Open settings") {
                    guard let url = KindredLinks.webLibrary(webLibraryAddress) else { return }
                    editingWebLibrary = false
                    openURL(url.appending(path: "settings"))
                }
                .disabled(KindredLinks.webLibrary(webLibraryAddress) == nil)
            }
            .navigationTitle("Web library address")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editingWebLibrary = false }
                }
            }
        }
    }

    private func openWebSettings() {
        if isDemo {
            openURL(KindredLinks.hostedLibrary.appending(path: "demo/settings"))
            return
        }
        findingWebLibrary = true
        Task {
            defer { findingWebLibrary = false }
            let server = await APIClient.shared.currentBaseURL()
            if HostedSocialSignIn.supports(server: server) {
                openURL(KindredLinks.hostedLibrary.appending(path: "settings"))
            } else if let configured = await APIClient.shared.configuredWebLibrary(),
                      let origin = KindredLinks.webLibrary(configured) {
                openURL(origin.appending(path: "settings"))
            } else {
                editingWebLibrary = true
            }
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
    var detail: String?
    var isExternal: Bool
    @Environment(\.horizontalSizeClass) private var widthClass

    init(_ title: String, icon: String, detail: String? = nil, isExternal: Bool = false) {
        self.title = title
        self.icon = icon
        self.detail = detail
        self.isExternal = isExternal
    }

    private var expanded: Bool { KindredTabletLayout.isExpanded(widthClass) }

    var body: some View {
        HStack(spacing: expanded ? 17 : 12) {
            Image(systemName: icon)
                .font(.kindredLabel)
                .foregroundStyle(KindredTheme.inkSecondary)
                .frame(width: 20)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.kindredLabel)
                    .foregroundStyle(KindredTheme.ink)
                if let detail {
                    Text(detail)
                        .font(.kindredCaption)
                        .foregroundStyle(KindredTheme.inkSecondary)
                }
            }
            Spacer(minLength: 8)
            Image(systemName: isExternal ? "arrow.up.right" : "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(KindredTheme.inkMeta)
                .accessibilityHidden(true)
        }
        .padding(14)
        .frame(minHeight: expanded ? 58 : 48)
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
    var isDemo = false

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "rectangle.portrait.and.arrow.right")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(KindredTheme.ember)
                .padding(.top, 32)

            Text(isDemo ? "Leave demo?" : "Sign out?")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ash)
                .padding(.top, 16)

            Text(isDemo ? "You can return to the demo anytime." : "Are you sure you want to sign out of your household?")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.pine)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            Spacer()

            VStack(spacing: 10) {
                KindredButton(
                    title: isDemo ? "Leave demo" : "Sign out",
                    icon: "rectangle.portrait.and.arrow.right",
                    style: .danger,
                    isFullWidth: true
                ) {
                    onConfirm()
                }

                KindredButton(
                    title: isDemo ? "Stay in demo" : "Stay signed in",
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
