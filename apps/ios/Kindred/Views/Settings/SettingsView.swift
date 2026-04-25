import SwiftUI

struct SettingsView: View {
    @State private var viewModel = SettingsViewModel()
    @State private var showLogoutConfirm = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Account card
                    accountCard

                    // System status card
                    systemCard

                    // Sync card
                    syncCard

                    // About card
                    aboutCard

                    // Sign out
                    Button(role: .destructive) {
                        showLogoutConfirm = true
                    } label: {
                        HStack {
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                            Text("Sign Out")
                                .font(.system(.body, design: .rounded, weight: .medium))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)
                    .alert("Sign Out", isPresented: $showLogoutConfirm) {
                        Button("Sign Out", role: .destructive) {
                            viewModel.logout()
                        }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("Are you sure you want to sign out?")
                    }
                }
                .padding()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(KindredTheme.warmBackground.ignoresSafeArea())
            .navigationTitle("Settings")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Image("KindredLogo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 32, height: 32)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
            .task {
                await viewModel.checkHealth()
                await viewModel.loadSyncs()
                await viewModel.checkActiveJob()
            }
        }
        .tint(KindredTheme.pine)
    }

    // MARK: - Account Card

    private var accountCard: some View {
        VStack(spacing: 0) {
            if let user = viewModel.session.currentUser {
                HStack(spacing: 14) {
                    ZStack {
                        Circle()
                            .fill(KindredTheme.pine)
                            .frame(width: 48, height: 48)
                        Text(String(user.display_name.prefix(1)).uppercased())
                            .font(.system(.title3, design: .rounded, weight: .bold))
                            .foregroundStyle(.white)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.display_name)
                            .font(.system(.headline, design: .rounded, weight: .semibold))
                        Text("@\(user.username) · \(user.role)")
                            .font(.system(.caption, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(KindredTheme.pine)
                        .font(.title3)
                }
                .padding()
            }
        }
        .background(KindredTheme.warmCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - System Card

    private var systemCard: some View {
        VStack(spacing: 0) {
            settingsRow(icon: "server.rack", title: "Backend", trailing: {
                HStack(spacing: 6) {
                    Circle()
                        .fill(viewModel.isHealthy ? Color.green : .red)
                        .frame(width: 8, height: 8)
                    Text(viewModel.isHealthy ? "Online" : "Offline")
                        .font(.system(.caption, design: .rounded, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            })

            Divider().padding(.leading, 48)

            settingsRow(icon: "link", title: "API", trailing: {
                Text("kindred-api.mkteagle.com")
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            })
        }
        .background(KindredTheme.warmCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Sync Card

    private var syncCard: some View {
        VStack(spacing: 0) {
            if let activeJob = viewModel.activeJob {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .foregroundStyle(KindredTheme.pine)
                            .frame(width: 24)
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
                .padding()

                Divider().padding(.leading, 48)
            }

            if let lastSync = viewModel.lastSyncDate {
                settingsRow(icon: "clock.arrow.circlepath", title: "Last Sync", trailing: {
                    Text(lastSync)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(.secondary)
                })
            }

            if !viewModel.syncs.isEmpty {
                Divider().padding(.leading, 48)

                NavigationLink {
                    syncHistoryView
                } label: {
                    settingsRow(icon: "list.bullet.clipboard", title: "Sync History", trailing: {
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    })
                }
                .buttonStyle(.plain)
            }
        }
        .background(KindredTheme.warmCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - About Card

    private var aboutCard: some View {
        VStack(spacing: 0) {
            settingsRow(icon: "info.circle", title: "Version", trailing: {
                Text("1.0.0")
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(.secondary)
            })

            Divider().padding(.leading, 48)

            settingsRow(icon: "heart.fill", title: "Built by", trailing: {
                Text("Kindling Signal")
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(.secondary)
            })
        }
        .background(KindredTheme.warmCardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Settings Row Helper

    private func settingsRow<Trailing: View>(icon: String, title: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(KindredTheme.pine)
                .frame(width: 24)
            Text(title)
                .font(.system(.body, design: .rounded))
            Spacer()
            trailing()
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
    }

    // MARK: - Sync History

    private var syncHistoryView: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(viewModel.syncs) { sync in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(sync.status == "completed" ? Color.green : sync.status == "failed" ? .red : KindredTheme.pine)
                                    .frame(width: 8, height: 8)
                                Text(sync.status.capitalized)
                                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                            }
                            if let started = sync.started_at {
                                Text(started)
                                    .font(.system(.caption, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if let total = sync.total_photos {
                            Text("\(total) photos")
                                .font(.system(.caption, design: .rounded, weight: .medium))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding()
                    .background(KindredTheme.warmCardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
            .padding()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KindredTheme.warmBackground.ignoresSafeArea())
        .navigationTitle("Sync History")
        .navigationBarTitleDisplayMode(.inline)
    }
}
