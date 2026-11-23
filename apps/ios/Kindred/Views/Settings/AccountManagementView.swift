import SwiftUI

private struct AccountManagement: Decodable {
    let is_owner: Bool
    let has_password: Bool
    let recently_signed_in: Bool
    let other_members: Int
    let providers: [String]
    let web_url: String

    var webSettings: URL? {
        guard let url = URL(string: web_url), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil
        else { return nil }
        return url.appending(path: "settings/account")
    }
}

private struct AccountChange: Encodable {
    var confirmation: String?
    var member_id: String?
    var password: String?
}

private struct AccountChangeResult: Decodable {
    let manual_apple_revocation: Bool?
}

struct AccountManagementView: View {
    private enum Action: String, Identifiable {
        case account = "Delete Account"
        case transfer = "Transfer Ownership"
        case household = "Delete Household"

        var id: String { rawValue }
        var endpoint: String {
            switch self {
            case .account: "delete"
            case .transfer: "transfer-ownership"
            case .household: "delete-household"
            }
        }
        var confirmation: String? {
            switch self {
            case .account: "DELETE"
            case .transfer: nil
            case .household: "DELETE HOUSEHOLD"
            }
        }
    }

    @State private var session = SessionManager.shared
    @State private var management: AccountManagement?
    @State private var members: [HouseholdMember] = []
    @State private var selectedMember = ""
    @State private var action: Action?
    @State private var password = ""
    @State private var confirmation = ""
    @State private var error: String?
    @State private var message: String?
    @State private var loading = true
    @State private var sending = false
    @State private var showingAppleInstructions = false

    var body: some View {
        SettingsPage("Manage Account") {
            if loading {
                ProgressView()
            } else if let management {
                if management.is_owner {
                    Text("You own this household. Transfer ownership to another member before deleting your own account, or delete the household to close this installation.")
                        .font(.kindredBody)
                    if !members.isEmpty {
                        actionButton(.transfer, icon: "person.2.badge.gearshape")
                    }
                    actionButton(.household, icon: "house")
                } else {
                    Text("Delete your profile, sign-in methods, favorites, and share links from this Kindred server. Media in the household library stays in the household’s storage.")
                        .font(.kindredBody)
                    actionButton(.account, icon: "person.crop.circle.badge.minus")
                }
            }
            if let message {
                Text(message).font(.kindredBody)
            }
            if let error {
                Text(error).font(.kindredBody).foregroundStyle(.red)
            }
            if !loading && management == nil {
                Button("Try again") { Task { await load() } }
            }
        }
        .task { await load() }
        .sheet(item: $action, onDismiss: {
            password = ""
            confirmation = ""
            selectedMember = ""
            error = nil
        }) { current in
            NavigationStack {
                changeForm(current)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { action = nil }.disabled(sending)
                        }
                    }
            }
            .interactiveDismissDisabled(sending)
        }
        .alert("Apple sign-in", isPresented: $showingAppleInstructions) {
            Button("Done") { finishDeletion() }
        } message: {
            Text("Kindred deleted the account. In Apple Account settings, open Sign in with Apple and remove Kindred to finish disconnecting Apple sign-in.")
        }
    }

    private func actionButton(_ value: Action, icon: String) -> some View {
        Button {
            error = nil
            message = nil
            action = value
        } label: {
            SettingsLinkLabel(value.rawValue, icon: icon)
        }
        .buttonStyle(.plain)
        .kindredGroupedCard()
    }

    @ViewBuilder
    private func changeForm(_ current: Action) -> some View {
        SettingsPage(current.rawValue) {
            if current == .transfer {
                Text("The new owner can manage and delete the household. You will remain an admin until your account is changed or deleted.")
                Picker("New owner", selection: $selectedMember) {
                    Text("Choose a member").tag("")
                    ForEach(members) { Text($0.display_name).tag($0.id) }
                }
            } else if current == .household {
                Text("This permanently deletes the Kindred catalog, accounts, albums, favorites, invitations, and connections for everyone on this server. NAS originals, R2 thumbnails, and Flickr copies stay in their storage. Setting up Kindred again requires a new database.")
            } else {
                Text("This permanently deletes your account and signs you out on every device. The shared library stays available to other household members.")
            }

            if let required = current.confirmation {
                TextField("Type \(required)", text: $confirmation)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .padding(12)
                    .kindredGroupedCard()
            }

            if management?.has_password == true {
                SecureField("Current password", text: $password)
                    .textContentType(.password)
                    .padding(12)
                    .kindredGroupedCard()
            } else if management?.recently_signed_in != true {
                if let web = management?.webSettings {
                    Text("Sign in again on your household’s website to confirm this change.")
                    Link("Open Account Settings", destination: web)
                }
                if HostedSocialSignIn.supports(server: session.serverURL ?? "") {
                    ForEach(management?.providers ?? [], id: \.self) { provider in
                        if let method = HostedSocialSignIn.Provider(rawValue: provider) {
                            Button("Confirm with \(provider.capitalized)") {
                                Task { await reauthenticate(method) }
                            }.disabled(sending)
                        }
                    }
                }
            }

            if let error { Text(error).foregroundStyle(.red) }
            if sending { ProgressView() }

            Button(current.rawValue, role: current == .transfer ? nil : .destructive) {
                Task { await submit(current) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canSubmit(current))
        }
        .font(.kindredBody)
    }

    private func canSubmit(_ current: Action) -> Bool {
        guard !sending, let management,
              management.has_password ? !password.isEmpty : management.recently_signed_in else { return false }
        if let required = current.confirmation { return confirmation == required }
        return !selectedMember.isEmpty
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let state: AccountManagement = try await APIClient.shared.get("/auth/account/management")
            if state.is_owner && state.other_members > 0 {
                let ownID = session.currentUser?.id
                members = try await APIClient.shared.householdMembers().filter { $0.id != ownID }
            } else {
                members = []
            }
            management = state
            error = nil
        } catch {
            self.error = "Account management is unavailable on this server."
        }
    }

    private func reauthenticate(_ provider: HostedSocialSignIn.Provider) async {
        sending = true
        defer { sending = false }
        do {
            try await session.confirmIdentity(with: provider)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func submit(_ current: Action) async {
        sending = true
        error = nil
        defer { sending = false }
        do {
            let response: AccountChangeResult = try await APIClient.shared.accountChange(
                current.endpoint, body: AccountChange(
                    confirmation: current.confirmation == nil ? nil : confirmation,
                    member_id: current == .transfer ? selectedMember : nil,
                    password: management?.has_password == true ? password : nil
                )
            )
            if current == .transfer {
                await session.refreshUser()
                await load()
                message = "Ownership transferred."
                action = nil
            } else if response.manual_apple_revocation == true {
                // Display the provider cleanup instructions before navigating away.
                action = nil
                showingAppleInstructions = true
            } else {
                finishDeletion()
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func finishDeletion() {
        action = nil
        PhotoImageDelivery.shared.clear()
        URLCache.shared.removeAllCachedResponses()
        let account = session.currentUser?.id
        session.logout()
        if let account { Task { await UploadQueueStore.shared.removeAccount(account) } }
    }
}
