import SwiftUI
import AuthenticationServices

struct LoginView: View {
    @State private var session = SessionManager.shared
    @State private var username = ""
    @State private var password = ""
    @State private var authError: String?
    @State private var isLoggingIn = false
    @State private var showServerSetup = false
    @State private var signingInWith: HostedSocialSignIn.Provider?
    @State private var showJoin = false

    private var hostedSocialAvailable: Bool {
        session.serverURL.map(HostedSocialSignIn.supports) ?? false
    }

    private var authenticating: Bool { isLoggingIn || signingInWith != nil }

    var body: some View {
        ZStack {
            KindredTheme.paper.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: 36)

                    // App icon
                    Image("KindredLogo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 62, height: 62)
                        .padding(10)
                        .background(KindredTheme.sheet, in: RoundedRectangle(cornerRadius: 19))
                        .overlay(RoundedRectangle(cornerRadius: 19).strokeBorder(KindredTheme.line))
                        .accessibilityHidden(true)

                    // Welcome text
                    Text(session.serverURL == nil ? "Connect your library" : "Welcome back")
                        .font(.display(26, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                        .padding(.top, 18)

                    Text(session.serverURL ?? "Scan a pairing code or enter the address of your Kindred server.")
                        .accessibilityIdentifier("login.serverAddress")
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                        .font(.kindredBody)
                        .foregroundStyle(KindredTheme.pine)
                        .padding(.top, 6)

                    if session.serverURL != nil {
                        if hostedSocialAvailable {
                            VStack(spacing: 10) {
                                providerButton(.google, title: "Continue with Google", icon: "g.circle.fill")
                                providerButton(.apple, title: "Sign in with Apple", icon: "apple.logo")
                            }
                            .padding(.horizontal, 24)
                            .padding(.top, 25)
                            Text("Or sign in with a password")
                                .font(.kindredCaption)
                                .foregroundStyle(KindredTheme.mist)
                                .padding(.top, 20)
                        }

                        // Form
                        VStack(spacing: 12) {
                            // Email / Username
                            kindredInput(label: "EMAIL", placeholder: "username", text: $username)
                                .textContentType(.username)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()

                            // Password
                            kindredSecureInput(label: "PASSWORD", text: $password)
                        }
                        .padding(.horizontal, 24)
                        .padding(.top, hostedSocialAvailable ? 14 : 28)

                        // Sign in button
                        KindredButton(
                            title: "Sign in",
                            style: .primary,
                            isFullWidth: true,
                            isLoading: isLoggingIn
                        ) {
                            login()
                        }
                        .disabled(authenticating || username.isEmpty || password.isEmpty)
                        .padding(.horizontal, 24)
                        .padding(.top, 20)

                    }

                    if let error = authError {
                        Text(error)
                            .font(.kindredCaption)
                            .foregroundStyle(KindredTheme.rosehip)
                            .padding(.horizontal, 24)
                            .padding(.top, 8)
                    }

                    KindredButton(
                        title: "Scan a pairing code",
                        style: session.serverURL == nil ? .primary : .ghost,
                        isFullWidth: true
                    ) {
                        PairingCoordinator.shared.isPresenting = true
                    }
                    .disabled(authenticating)
                    .padding(.horizontal, 24)
                    .padding(.top, 18)

                    Button(session.serverURL == nil ? "Enter server address" : "Change server") {
                        showServerSetup = true
                    }
                    .font(.kindredBody)
                    .foregroundStyle(KindredTheme.pine)
                    .disabled(authenticating)
                    .padding(.top, 16)

                    if session.serverURL != nil {
                        Button("Join with an invite code") { showJoin = true }
                            .font(.kindredCaption)
                            .foregroundStyle(KindredTheme.pine)
                            .disabled(authenticating)
                            .padding(.top, 16)
                    } else {
                        Link("Set up a Kindred server", destination: URL(string: "https://github.com/mkteagle/kindred#self-hosting-guide")!)
                            .font(.kindredCaption)
                            .foregroundStyle(KindredTheme.pine)
                            .padding(.top, 16)
                    }

                    // Demo mode
                    Button {
                        tryDemo()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "play.circle.fill")
                                .font(.system(size: 16))
                            Text("Try the demo")
                                .font(.kindredLabel)
                        }
                        .foregroundStyle(KindredTheme.forest)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(KindredTheme.forest.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                    }
                    .disabled(authenticating)
                    .padding(.horizontal, 24)
                    .padding(.top, 12)

                    Spacer().frame(height: 40)
                }
                .frame(maxWidth: 460)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .sheet(isPresented: $showJoin) {
            JoinView()
        }
        .sheet(isPresented: $showServerSetup) {
            ServerAddressView(currentAddress: session.serverURL)
        }
        .onChange(of: session.serverURL) {
            username = ""
            password = ""
            authError = nil
        }
    }

    private func providerButton(_ provider: HostedSocialSignIn.Provider, title: String, icon: String) -> some View {
        Button {
            signIn(with: provider)
        } label: {
            HStack(spacing: 10) {
                if signingInWith == provider {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: icon)
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(provider == .google ? KindredTheme.accent : KindredTheme.ink)
                        .accessibilityHidden(true)
                }
                Text(title).font(.kindredButton)
            }
            .foregroundStyle(KindredTheme.ink)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(KindredTheme.sheet, in: RoundedRectangle(cornerRadius: KindredTheme.buttonRadius))
            .overlay(RoundedRectangle(cornerRadius: KindredTheme.buttonRadius).strokeBorder(KindredTheme.lineDark))
        }
        .buttonStyle(.plain)
        .disabled(authenticating)
    }

    private func signIn(with provider: HostedSocialSignIn.Provider) {
        signingInWith = provider
        authError = nil
        Task {
            defer { signingInWith = nil }
            do {
                try await session.login(with: provider)
            } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
                // The user dismissed the provider sheet.
            } catch {
                authError = error.localizedDescription
            }
        }
    }

    // MARK: - Input Fields

    private func kindredInput(label: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.kindredInputLabel)
                .tracking(1.4)
                .foregroundStyle(KindredTheme.mist)

            TextField(placeholder, text: text)
                .font(.kindredBody)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14)
                .frame(height: 48)
                .background(KindredTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                .overlay(
                    RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                        .stroke(KindredTheme.lineDark, lineWidth: 1)
                )
        }
    }

    private func kindredSecureInput(label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.kindredInputLabel)
                .tracking(1.4)
                .foregroundStyle(KindredTheme.mist)

            SecureField("••••••••", text: text)
                .font(.kindredBody)
                .textFieldStyle(.plain)
                .textContentType(.password)
                .padding(.horizontal, 14)
                .frame(height: 48)
                .background(KindredTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                .overlay(
                    RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                        .stroke(KindredTheme.lineDark, lineWidth: 1)
                )
        }
    }

    // MARK: - Auth

    private func login() {
        isLoggingIn = true
        authError = nil
        Task {
            do {
                try await session.login(username: username, password: password)
            } catch APIClient.APIError.httpError(401) {
                authError = "Invalid username or password."
            } catch {
                authError = error.localizedDescription
            }
            isLoggingIn = false
        }
    }

    private func tryDemo() {
        Task {
            do {
                try await session.authenticate {
                    let demo = DemoDataProvider.shared
                    demo.isActive = true
                    await session.restoreSession(token: "demo", user: demo.getMe())
                }
            } catch {
                authError = error.localizedDescription
            }
        }
    }

}

private struct ServerAddressView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var address: String
    @State private var error: String?
    @State private var saving = false

    init(currentAddress: String?) {
        _address = State(initialValue: currentAddress ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://photos.example.com", text: $address)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Server address")
                } footer: {
                    Text("Use the HTTPS API address shown in Mobile setup on your Kindred server.")
                }
                if let error {
                    Text(error).foregroundStyle(KindredTheme.rosehip)
                }
            }
            .navigationTitle("Connect to a server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Continue") {
                        saving = true
                        Task {
                            defer { saving = false }
                            do {
                                try await SessionManager.shared.selectServer(address)
                                dismiss()
                            } catch {
                                self.error = error.localizedDescription
                            }
                        }
                    }
                    .disabled(saving || address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}

// MARK: - Join View (redesigned)

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
            ScrollView {
                VStack(spacing: 0) {
                    Text("Join your family's Kindred library\nwith an invite code.")
                        .font(.kindredBody)
                        .foregroundStyle(KindredTheme.pine)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                        .padding(.top, 16)

                    VStack(spacing: 12) {
                        inputField(label: "INVITE CODE", placeholder: "ABC123", text: $inviteCode)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()

                        inputField(label: "DISPLAY NAME", placeholder: "Your name", text: $displayName)
                            .textContentType(.name)

                        inputField(label: "USERNAME", placeholder: "username", text: $username)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()

                        VStack(alignment: .leading, spacing: 6) {
                            Text("PASSWORD")
                                .font(.kindredInputLabel)
                                .tracking(1.4)
                                .foregroundStyle(KindredTheme.mist)
                            SecureField("6+ characters", text: $password)
                                .font(.kindredBody)
                                .textFieldStyle(.plain)
                                .textContentType(.newPassword)
                                .padding(.horizontal, 14)
                                .frame(height: 48)
                                .background(KindredTheme.card)
                                .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                                .overlay(
                                    RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                                        .stroke(KindredTheme.lineDark, lineWidth: 1)
                                )
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 24)

                    KindredButton(
                        title: "Join",
                        style: .primary,
                        isFullWidth: true,
                        isLoading: isRegistering
                    ) {
                        register()
                    }
                    .disabled(isRegistering || inviteCode.isEmpty || username.isEmpty || displayName.isEmpty || password.count < 6)
                    .padding(.horizontal, 24)
                    .padding(.top, 20)

                    if let error {
                        Text(error)
                            .font(.kindredCaption)
                            .foregroundStyle(KindredTheme.rosehip)
                            .padding(.top, 8)
                    }
                }
            }
            .kindredPaperBackground()
            .navigationTitle("Join Kindred")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .font(.kindredLabel)
                        .foregroundStyle(KindredTheme.pine)
                }
            }
        }
    }

    private func inputField(label: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.kindredInputLabel)
                .tracking(1.4)
                .foregroundStyle(KindredTheme.mist)
            TextField(placeholder, text: text)
                .font(.kindredBody)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14)
                .frame(height: 48)
                .background(KindredTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                .overlay(
                    RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                        .stroke(KindredTheme.lineDark, lineWidth: 1)
                )
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
