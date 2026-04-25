import SwiftUI
import AuthenticationServices

struct SettingsView: View {
    @State private var viewModel = SettingsViewModel()
    @State private var showLogoutConfirm = false
    @State private var authError: String?

    var body: some View {
        NavigationStack {
            List {
                // Logo header
                Section {
                    VStack(spacing: 8) {
                        Image(systemName: "heart.text.square.fill")
                            .font(.system(size: 36, weight: .light))
                            .foregroundStyle(KindredTheme.pine)
                        Text("Kindred")
                            .font(.system(.title2, design: .rounded, weight: .bold))
                            .foregroundStyle(KindredTheme.darkAccent)
                        Text("Family Photo Library")
                            .font(.system(.caption, design: .rounded, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .listRowBackground(Color.clear)
                }

                // Account
                if viewModel.flickrAuth.isAuthenticated {
                    accountSection
                } else {
                    loginSection
                }

                // Sync
                syncSection

                // System
                systemSection

                // About
                aboutSection
            }
            .scrollContentBackground(.hidden)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KindredTheme.warmBackground.ignoresSafeArea())
            .navigationTitle("Settings")
            .task {
                await viewModel.checkHealth()
                await viewModel.loadSyncs()
                await viewModel.checkActiveJob()
            }
        }
        .tint(KindredTheme.pine)
    }

    // MARK: - Login

    private var loginSection: some View {
        Section {
            Button {
                login()
            } label: {
                HStack {
                    Image(systemName: "person.badge.plus")
                        .foregroundStyle(KindredTheme.pine)
                    Text("Connect Flickr Account")
                        .font(.system(.body, design: .rounded, weight: .medium))
                }
            }

            if let error = authError {
                Text(error)
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(.red)
            }
        } header: {
            Text("Account")
                .font(.system(.caption, design: .rounded, weight: .semibold))
        } footer: {
            Text("Sign in with your Flickr account to access your photo library.")
                .font(.system(.caption2, design: .rounded))
        }
    }

    // MARK: - Account

    private var accountSection: some View {
        Section {
            if let user = viewModel.flickrAuth.user {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.fullname.isEmpty ? user.username : user.fullname)
                            .font(.system(.headline, design: .rounded, weight: .semibold))
                        Text("@\(user.username)")
                            .font(.system(.caption, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(KindredTheme.pine)
                }
            }

            Button(role: .destructive) {
                showLogoutConfirm = true
            } label: {
                Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    .font(.system(.body, design: .rounded))
            }
            .alert("Sign Out", isPresented: $showLogoutConfirm) {
                Button("Sign Out", role: .destructive) {
                    viewModel.logout()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Are you sure you want to sign out of your Flickr account?")
            }
        } header: {
            Text("Account")
                .font(.system(.caption, design: .rounded, weight: .semibold))
        }
    }

    // MARK: - Sync

    private var syncSection: some View {
        Section {
            if let activeJob = viewModel.activeJob {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Scan Running")
                            .font(.system(.subheadline, design: .rounded, weight: .semibold))
                            .foregroundStyle(KindredTheme.pine)
                        Spacer()
                        ProgressView()
                    }
                    ProgressView(value: Double(activeJob.progress), total: Double(max(activeJob.total, 1)))
                        .tint(KindredTheme.pine)
                    Text(activeJob.message)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }

            if let lastSync = viewModel.lastSyncDate {
                HStack {
                    Text("Last Sync")
                        .font(.system(.body, design: .rounded))
                    Spacer()
                    Text(lastSync)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }

            if !viewModel.syncs.isEmpty {
                NavigationLink {
                    syncHistoryView
                } label: {
                    Label("Sync History", systemImage: "clock.arrow.circlepath")
                        .font(.system(.body, design: .rounded))
                }
            }
        } header: {
            Text("Sync")
                .font(.system(.caption, design: .rounded, weight: .semibold))
        }
    }

    // MARK: - System

    private var systemSection: some View {
        Section {
            HStack {
                Text("Backend Status")
                    .font(.system(.body, design: .rounded))
                Spacer()
                HStack(spacing: 4) {
                    Circle()
                        .fill(viewModel.isHealthy ? KindredTheme.pine : .red)
                        .frame(width: 8, height: 8)
                    Text(viewModel.isHealthy ? "Online" : "Offline")
                        .font(.system(.caption, design: .rounded, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }

            HStack {
                Text("API Endpoint")
                    .font(.system(.body, design: .rounded))
                Spacer()
                Text("kindred-api.mkteagle.com")
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("System")
                .font(.system(.caption, design: .rounded, weight: .semibold))
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        Section {
            HStack {
                Text("Version")
                    .font(.system(.body, design: .rounded))
                Spacer()
                Text("1.0.0")
                    .font(.system(.body, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text("Built by")
                    .font(.system(.body, design: .rounded))
                Spacer()
                Text("Kindling Signal")
                    .font(.system(.body, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("About")
                .font(.system(.caption, design: .rounded, weight: .semibold))
        }
    }

    // MARK: - Sync History

    private var syncHistoryView: some View {
        List(viewModel.syncs) { sync in
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(sync.status.capitalized)
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .foregroundStyle(sync.status == "completed" ? KindredTheme.pine : sync.status == "failed" ? .red : .primary)
                    Spacer()
                    if let total = sync.total_photos {
                        Text("\(total) photos")
                            .font(.system(.caption, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
                if let started = sync.started_at {
                    Text(started)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                if let faces = sync.new_faces, faces > 0 {
                    Text("\(faces) new faces")
                        .font(.system(.caption2, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                if let error = sync.error {
                    Text(error)
                        .font(.system(.caption2, design: .rounded))
                        .foregroundStyle(.red)
                }
            }
            .padding(.vertical, 2)
        }
        .scrollContentBackground(.hidden)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KindredTheme.warmBackground.ignoresSafeArea())
        .navigationTitle("Sync History")
    }

    // MARK: - Login Action

    private func login() {
        Task {
            do {
                try await viewModel.flickrAuth.authenticate()
                authError = nil
            } catch {
                authError = error.localizedDescription
            }
        }
    }
}
