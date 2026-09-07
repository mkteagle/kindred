import SwiftUI

// MARK: - Models

struct HouseholdMember: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let username: String
    let display_name: String
    let role: String
    let avatar_url: String?
}

struct HouseholdMembersResponse: Codable, Sendable {
    let users: [HouseholdMember]
}

struct InviteCode: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let code: String
    let role: String?
    let expires_at: String?
}

struct InviteCodesResponse: Codable, Sendable {
    let invites: [InviteCode]
}

struct CreatedInvite: Codable, Sendable {
    let code: String
    let expires_at: String?
}

extension APIClient {
    /// Both of these are admin-only on the server; a member gets a 403, which
    /// is why the Settings rows that lead here are admin-gated too.
    func householdMembers() async throws -> [HouseholdMember] {
        let response: HouseholdMembersResponse = try await get("/users")
        return response.users
    }

    func inviteCodes() async throws -> [InviteCode] {
        let response: InviteCodesResponse = try await get("/invites")
        return response.invites
    }

    func createInvite() async throws -> CreatedInvite {
        try await send("/invites", method: "POST")
    }

    func revokeInvite(id: String) async throws {
        let _: EmptyResponse = try await send("/invites/\(id)", method: "DELETE")
    }
}

struct EmptyResponse: Codable, Sendable {
    let ok: Bool?
}

// MARK: - Members

struct HouseholdMembersView: View {
    @State private var members: [HouseholdMember] = []
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if isLoading {
                    ProgressView().tint(KindredTheme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                } else if let error {
                    Text(error)
                        .font(.kindredBody)
                        .foregroundStyle(KindredTheme.inkBody)
                        .padding(.horizontal, KindredTheme.gutter)
                        .padding(.top, 24)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(members.enumerated()), id: \.element.id) { position, member in
                            HStack(spacing: 12) {
                                if let path = member.avatar_url {
                                    AvatarAsyncImage(avatarPath: path, size: 32)
                                        .frame(width: 32, height: 32)
                                        .clipShape(Circle())
                                } else {
                                    KindredInitialsAvatar(
                                        initials: String(member.display_name.prefix(1)).uppercased(),
                                        size: 32
                                    )
                                }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(member.display_name)
                                        .font(.kindredLabel)
                                        .foregroundStyle(KindredTheme.ink)
                                    Text("@\(member.username) · \(member.role)")
                                        .font(.kindredMeta)
                                        .foregroundStyle(KindredTheme.inkMeta)
                                }
                                Spacer()
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .accessibilityElement(children: .combine)

                            if position < members.count - 1 {
                                Rectangle().fill(KindredTheme.hairlineSoft).frame(height: 1)
                                    .padding(.leading, 14)
                            }
                        }
                    }
                    .kindredGroupedCard()
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                }
            }
        }
        .background(KindredTheme.bg.ignoresSafeArea())
        .navigationTitle("Members")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            members = try await APIClient.shared.householdMembers()
        } catch {
            self.error = "Only an admin can see the household's members."
        }
    }
}

// MARK: - Invites

struct InviteCodesView: View {
    @State private var invites: [InviteCode] = []
    @State private var isLoading = true
    @State private var isCreating = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("An invite code lets one person join this household. Codes expire after seven days.")
                    .font(.kindredBody)
                    .foregroundStyle(KindredTheme.inkBody)
                    .padding(.horizontal, KindredTheme.gutter)
                    .padding(.top, 16)
                    .padding(.bottom, 14)

                KindredButton(title: "New invite code", isFullWidth: true, isLoading: isCreating) {
                    Task { await create() }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 18)

                if isLoading {
                    ProgressView().tint(KindredTheme.accent)
                        .frame(maxWidth: .infinity)
                } else if invites.isEmpty {
                    Text(error ?? "No active codes.")
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.inkMeta)
                        .padding(.horizontal, KindredTheme.gutter)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(invites.enumerated()), id: \.element.id) { position, invite in
                            HStack {
                                Text(invite.code)
                                    .font(.mono(15, weight: .semibold))
                                    .tracking(2)
                                    .foregroundStyle(KindredTheme.ink)
                                    .textSelection(.enabled)
                                Spacer()
                                Button {
                                    UIPasteboard.general.string = invite.code
                                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                                } label: {
                                    Image(systemName: "doc.on.doc")
                                        .font(.system(size: 15))
                                        .foregroundStyle(KindredTheme.accent)
                                }
                                .accessibilityLabel("Copy code \(invite.code)")

                                Button {
                                    Task { await revoke(invite) }
                                } label: {
                                    Image(systemName: "trash")
                                        .font(.system(size: 15))
                                        .foregroundStyle(KindredTheme.dangerText)
                                }
                                .accessibilityLabel("Revoke code \(invite.code)")
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 13)

                            if position < invites.count - 1 {
                                Rectangle().fill(KindredTheme.hairlineSoft).frame(height: 1)
                                    .padding(.leading, 14)
                            }
                        }
                    }
                    .kindredGroupedCard()
                    .padding(.horizontal, 16)
                }
            }
            .padding(.bottom, 40)
        }
        .background(KindredTheme.bg.ignoresSafeArea())
        .navigationTitle("Invite codes")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            invites = try await APIClient.shared.inviteCodes()
        } catch {
            self.error = "Only an admin can manage invite codes."
        }
    }

    private func create() async {
        isCreating = true
        defer { isCreating = false }
        _ = try? await APIClient.shared.createInvite()
        await load()
    }

    private func revoke(_ invite: InviteCode) async {
        try? await APIClient.shared.revokeInvite(id: invite.id)
        await load()
    }
}
