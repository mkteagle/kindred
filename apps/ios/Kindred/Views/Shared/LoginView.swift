import SwiftUI
import AuthenticationServices

struct LoginView: View {
    @State private var session = SessionManager.shared
    @State private var flickrAuth = FlickrAuth.shared
    @State private var username = ""
    @State private var password = ""
    @State private var authError: String?
    @State private var isLoggingIn = false
    @State private var isFlickrLoggingIn = false
    @State private var hostedSocialAvailable = false
    @State private var signingInWith: HostedSocialSignIn.Provider?
    @State private var showJoin = false
    @State private var isDemoLoading = false
    @State private var demoError: String?

    // Demo mode (offline — no network)

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
                    Text("Welcome back.")
                        .font(.display(26, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                        .padding(.top, 18)

                    Text("Sign in to your household.")
                        .font(.kindredBody)
                        .foregroundStyle(KindredTheme.pine)
                        .padding(.top, 6)

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
                    .disabled(isLoggingIn || signingInWith != nil || username.isEmpty || password.isEmpty)
                    .padding(.horizontal, 24)
                    .padding(.top, 20)

                    if let error = authError {
                        Text(error)
                            .font(.kindredCaption)
                            .foregroundStyle(KindredTheme.rosehip)
                            .padding(.top, 8)
                    }

                    // Pairing: a self-hosted household's server is not at the
                    // default address, and its members should not have to know
                    // the URL. Offered before the Flickr path because for a
                    // self-hoster it is the only one that works.
                    Button {
                        PairingCoordinator.shared.isPresenting = true
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "qrcode.viewfinder")
                            Text("Scan a pairing code")
                        }
                        .font(.kindredBody)
                        .foregroundStyle(KindredTheme.pine)
                    }
                    .padding(.top, 16)

                    // Divider
                    HStack(spacing: 10) {
                        Rectangle().fill(KindredTheme.line).frame(height: 1)
                        Text("OR")
                            .font(.kindredMicro)
                            .tracking(1.4)
                            .foregroundStyle(KindredTheme.mist)
                        Rectangle().fill(KindredTheme.line).frame(height: 1)
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 22)

                    // Flickr button
                    Button {
                        flickrLogin()
                    } label: {
                        HStack(spacing: 8) {
                            if isFlickrLoggingIn {
                                ProgressView().tint(KindredTheme.ash)
                            } else {
                                // Flickr brand swatch
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(LinearGradient(
                                        colors: [Color(hex: 0x0063DC), Color(hex: 0xFF0084)],
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    ))
                                    .frame(width: 14, height: 14)
                            }
                            Text("Continue with Flickr")
                                .font(.kindredButtonSM)
                                .foregroundStyle(KindredTheme.ash)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .background(KindredTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                        .overlay(
                            RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                                .stroke(KindredTheme.lineDark, lineWidth: 1)
                        )
                    }
                    .disabled(isFlickrLoggingIn || signingInWith != nil)
                    .padding(.horizontal, 24)

                    // Join link
                    Button {
                        showJoin = true
                    } label: {
                        HStack(spacing: 4) {
                            Text("New to Kindred?")
                                .foregroundStyle(KindredTheme.pine)
                            Text("Join with code")
                                .fontWeight(.bold)
                                .foregroundStyle(KindredTheme.ember)
                        }
                        .font(.kindredCaption)
                    }
                    .padding(.top, 18)

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
                    .disabled(isDemoLoading)
                    .padding(.horizontal, 24)
                    .padding(.top, 12)

                    if let demoError {
                        Text(demoError)
                            .font(.kindredCaption)
                            .foregroundStyle(KindredTheme.rosehip)
                            .padding(.top, 4)
                    }

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
        .task {
            hostedSocialAvailable = HostedSocialSignIn.supports(server: await APIClient.shared.currentBaseURL())
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
        .disabled(signingInWith != nil || isLoggingIn || isFlickrLoggingIn)
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
            } catch {
                authError = "Invalid username or password"
            }
            isLoggingIn = false
        }
    }

    private func tryDemo() {
        // Activate offline demo mode — no network calls at all
        let demo = DemoDataProvider.shared
        demo.isActive = true
        let fakeUser = demo.getMe()
        Task { await session.restoreSession(token: "demo", user: fakeUser) }
    }

    private func flickrLogin() {
        isFlickrLoggingIn = true
        authError = nil
        Task {
            do {
                try await flickrAuth.authenticate()
                let body: [String: String] = [
                    "flickr_user_id": flickrAuth.user?.userId ?? "",
                    "flickr_oauth_token": flickrAuth.oauthToken,
                    "flickr_oauth_secret": flickrAuth.oauthTokenSecret,
                ]
                let response: AuthResponse = try await APIClient.shared.postPublic("/auth/flickr-login", body: body)
                await session.restoreSession(
                    token: response.session.token,
                    user: response.user,
                    expiresAt: response.session.expires_at
                )
            } catch {
                authError = "Flickr login failed: \(error.localizedDescription)"
            }
            isFlickrLoggingIn = false
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
