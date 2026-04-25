import SwiftUI
import AuthenticationServices

struct LoginView: View {
    @State private var flickrAuth = FlickrAuth.shared
    @State private var authError: String?
    @State private var isAuthenticating = false

    var body: some View {
        ZStack {
            // Warm gradient background
            KindredTheme.warmGradient
                .ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                // Logo area
                VStack(spacing: 16) {
                    // App icon representation
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

                // Login section
                VStack(spacing: 20) {
                    Text("Connect your Flickr account to search, organize, and explore your private photo library with AI.")
                        .font(.system(.subheadline, design: .rounded))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)

                    Button {
                        login()
                    } label: {
                        HStack(spacing: 10) {
                            if isAuthenticating {
                                ProgressView()
                                    .tint(.white)
                            } else {
                                Image(systemName: "link.badge.plus")
                                    .font(.system(.body, design: .rounded, weight: .semibold))
                            }
                            Text("Connect with Flickr")
                                .font(.system(.body, design: .rounded, weight: .semibold))
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(KindredTheme.pine)
                        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.buttonRadius))
                    }
                    .disabled(isAuthenticating)
                    .padding(.horizontal, 32)

                    if let error = authError {
                        Text(error)
                            .font(.system(.caption, design: .rounded))
                            .foregroundStyle(.red)
                            .padding(.horizontal, 32)
                    }
                }

                Spacer()
                    .frame(height: 60)

                // Footer
                Text("Built by Kindling Signal")
                    .font(.system(.caption2, design: .rounded))
                    .foregroundStyle(.quaternary)
                    .padding(.bottom, 16)
            }
        }
    }

    private func login() {
        isAuthenticating = true
        authError = nil

        Task {
            do {
                try await flickrAuth.authenticate()
                authError = nil
            } catch {
                authError = error.localizedDescription
            }
            isAuthenticating = false
        }
    }
}
