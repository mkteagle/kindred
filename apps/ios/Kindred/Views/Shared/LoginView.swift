import SwiftUI

struct LoginView: View {
    @State private var session = SessionManager.shared
    @State private var username = ""
    @State private var password = ""
    @State private var authError: String?
    @State private var isLoggingIn = false
    @State private var showJoin = false

    var body: some View {
        ZStack {
            KindredTheme.warmGradient
                .ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                // Logo
                VStack(spacing: 16) {
                    Image(systemName: "heart.text.square.fill")
                        .font(.system(size: 72, weight: .light))
                        .foregroundStyle(KindredTheme.pine)
                        .padding(24)
                        .background(
                            Circle()
                                .fill(KindredTheme.pine.opacity(0.1))
                        )

                    Text("Kindred")
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        .foregroundStyle(KindredTheme.darkAccent)

                    Text("Family Photo Library")
                        .font(.system(.title3, design: .rounded, weight: .medium))
                        .foregroundStyle(KindredTheme.pine)
                }

                Spacer()

                // Login form
                VStack(spacing: 16) {
                    VStack(spacing: 12) {
                        TextField("Username", text: $username)
                            .font(.system(.body, design: .rounded))
                            .textFieldStyle(.plain)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(14)
                            .background(KindredTheme.warmCardBackground)
                            .clipShape(RoundedRectangle(cornerRadius: 10))

                        SecureField("Password", text: $password)
                            .font(.system(.body, design: .rounded))
                            .textFieldStyle(.plain)
                            .textContentType(.password)
                            .padding(14)
                            .background(KindredTheme.warmCardBackground)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .padding(.horizontal, 32)

                    Button {
                        login()
                    } label: {
                        HStack(spacing: 10) {
                            if isLoggingIn {
                                ProgressView()
                                    .tint(.white)
                            }
                            Text("Sign In")
                                .font(.system(.body, design: .rounded, weight: .semibold))
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(KindredTheme.pine)
                        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.buttonRadius))
                    }
                    .disabled(isLoggingIn || username.isEmpty || password.isEmpty)
                    .padding(.horizontal, 32)

                    if let error = authError {
                        Text(error)
                            .font(.system(.caption, design: .rounded))
                            .foregroundStyle(.red)
                            .padding(.horizontal, 32)
                    }

                    Button {
                        showJoin = true
                    } label: {
                        Text("Have an invite code? Join")
                            .font(.system(.subheadline, design: .rounded))
                            .foregroundStyle(KindredTheme.pine)
                    }
                }

                Spacer()
                    .frame(height: 40)

                Text("Built by Kindling Signal")
                    .font(.system(.caption2, design: .rounded))
                    .foregroundStyle(.quaternary)
                    .padding(.bottom, 16)
            }
        }
        .sheet(isPresented: $showJoin) {
            JoinView()
        }
    }

    private func login() {
        isLoggingIn = true
        authError = nil

        Task {
            do {
                try await session.login(username: username, password: password)
            } catch {
                authError = "Invalid username or password"
            }
            isLoggingIn = false
        }
    }
}

// MARK: - Join View (register with invite code)

struct JoinView: View {
    @State private var session = SessionManager.shared
    @Environment(\.dismiss) private var dismiss
    @State private var inviteCode = ""
    @State private var username = ""
    @State private var displayName = ""
    @State private var password = ""
    @State private var error: String?
    @State private var isRegistering = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Join your family's Kindred library with an invite code from the admin.")
                    .font(.system(.subheadline, design: .rounded))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.top, 16)

                VStack(spacing: 12) {
                    TextField("Invite Code", text: $inviteCode)
                        .font(.system(.body, design: .rounded))
                        .textFieldStyle(.plain)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .padding(14)
                        .background(KindredTheme.warmCardBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                    TextField("Display Name", text: $displayName)
                        .font(.system(.body, design: .rounded))
                        .textFieldStyle(.plain)
                        .textContentType(.name)
                        .padding(14)
                        .background(KindredTheme.warmCardBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                    TextField("Username", text: $username)
                        .font(.system(.body, design: .rounded))
                        .textFieldStyle(.plain)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(14)
                        .background(KindredTheme.warmCardBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                    SecureField("Password (6+ characters)", text: $password)
                        .font(.system(.body, design: .rounded))
                        .textFieldStyle(.plain)
                        .textContentType(.newPassword)
                        .padding(14)
                        .background(KindredTheme.warmCardBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .padding(.horizontal, 24)

                Button {
                    register()
                } label: {
                    HStack(spacing: 10) {
                        if isRegistering {
                            ProgressView()
                                .tint(.white)
                        }
                        Text("Join")
                            .font(.system(.body, design: .rounded, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(KindredTheme.pine)
                    .clipShape(RoundedRectangle(cornerRadius: KindredTheme.buttonRadius))
                }
                .disabled(isRegistering || inviteCode.isEmpty || username.isEmpty || displayName.isEmpty || password.count < 6)
                .padding(.horizontal, 24)

                if let error {
                    Text(error)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(.red)
                        .padding(.horizontal, 24)
                }

                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(KindredTheme.warmBackground.ignoresSafeArea())
            .navigationTitle("Join Kindred")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .font(.system(.body, design: .rounded))
                }
            }
        }
    }

    private func register() {
        isRegistering = true
        error = nil

        Task {
            do {
                try await session.register(
                    inviteCode: inviteCode,
                    username: username,
                    displayName: displayName,
                    password: password
                )
                dismiss()
            } catch {
                self.error = "Registration failed. Check your invite code and try again."
            }
            isRegistering = false
        }
    }
}
