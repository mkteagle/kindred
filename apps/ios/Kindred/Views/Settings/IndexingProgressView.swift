import SwiftUI

struct IndexingProgressView: View {
    @State private var session = SessionManager.shared
    @State private var snapshot: IndexingSnapshot?
    @State private var lastUpdated: Date?
    @State private var refreshing = false
    @State private var refreshFailed = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        SettingsPage("Indexing progress") {
            if session.currentUser?.role == "admin" {
                VStack(alignment: .leading, spacing: 7) {
                    Text("Indexing progress")
                        .font(.largeTitle.bold())
                        .foregroundStyle(KindredTheme.ink)
                        .accessibilityAddTraits(.isHeader)
                    if let lastUpdated {
                        Text("Updated \(lastUpdated, format: .dateTime.hour().minute())")
                            .font(.subheadline)
                            .foregroundStyle(KindredTheme.inkMeta)
                    }
                }
                .padding(.vertical, 5)

                if let snapshot {
                    if snapshot.pipelines.isEmpty {
                        status("No indexing workers connected", icon: "externaldrive.badge.minus")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(snapshot.pipelines) { worker in
                                IndexingWorkerRow(worker: worker)
                                if worker.id != snapshot.pipelines.last?.id {
                                    Divider().padding(.leading, 66)
                                }
                            }
                        }
                        .kindredGroupedCard()
                    }
                } else if !refreshFailed {
                    ProgressView("Checking indexing…")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(18)
                        .kindredGroupedCard()
                }

                if refreshFailed {
                    status("Couldn’t refresh indexing progress", icon: "exclamationmark.circle")
                    Button("Try again") { Task { await refresh() } }
                        .font(.kindredLabel)
                        .tint(KindredTheme.accent)
                }
            } else {
                status("Indexing progress is available to household admins.", icon: "lock")
            }
        }
        .refreshable { await refresh() }
        .task(id: scenePhase) {
            guard scenePhase == .active, session.currentUser?.role == "admin" else { return }
            while !Task.isCancelled {
                await refresh()
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
            }
        }
    }

    private func status(_ text: String, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.kindredLabel)
            .foregroundStyle(KindredTheme.inkSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .kindredGroupedCard()
    }

    @MainActor
    private func refresh() async {
        guard session.currentUser?.role == "admin", !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            let value: IndexingSnapshot
            if DemoDataProvider.shared.isActive {
                value = .demo
            } else {
                value = try await APIClient.shared.get("/admin/indexing-progress")
            }
            guard !Task.isCancelled else { return }
            snapshot = value
            lastUpdated = Date()
            refreshFailed = false
        } catch {
            guard !Task.isCancelled else { return }
            if case APIClient.APIError.httpError(403) = error {
                snapshot = nil
                lastUpdated = nil
            }
            refreshFailed = true
        }
    }
}

private struct IndexingSnapshot: Decodable {
    var pipelines: [IndexingWorker]

    static let demo = IndexingSnapshot(pipelines: [
        .init(key: "discovery", label: "File catalog", done: 92_000, total: 92_000,
              running: false, complete: true, stale: false, phase: nil),
        .init(key: "previews", label: "Thumbnails", done: 81_240, total: 92_000,
              running: true, complete: false, stale: false, phase: nil),
        .init(key: "index", label: "Recognition", done: 12_407, total: 78_520,
              running: false, complete: false, stale: false, phase: "waiting_for_previews"),
    ])
}

private struct IndexingWorker: Decodable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let done: Int
    let total: Int?
    let running: Bool
    let complete: Bool
    let stale: Bool
    let phase: String?

    var title: String {
        switch key {
        case "discovery": "File catalog"
        case "previews": "Thumbnails"
        case "index": "Recognition"
        default: label
        }
    }

    var icon: String {
        switch key {
        case "discovery": "folder"
        case "previews": "photo.on.rectangle"
        case "index": "viewfinder"
        default: "gearshape"
        }
    }

    var status: String {
        if complete { return "Complete" }
        if stale { return "Update delayed" }
        switch phase {
        case "waiting_for_discovery": return "Waiting for file catalog"
        case "waiting_for_previews": return "Waiting for thumbnails"
        case "waiting_for_capacity": return "Waiting for NAS"
        case "waiting_for_flickr_match": return "Waiting for Flickr comparison"
        case "reconciliation_needed", "needs_review", "failed": return "Needs attention"
        default: return running ? "Running" : "Waiting"
        }
    }
}

private struct IndexingWorkerRow: View {
    let worker: IndexingWorker

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: worker.icon)
                .font(.headline)
                .foregroundStyle(KindredTheme.accent)
                .frame(width: 38, height: 38)
                .background(KindredTheme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 11))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 8) {
                ViewThatFits(in: .horizontal) {
                    HStack {
                        title.fixedSize()
                        Spacer(minLength: 8)
                        status.fixedSize()
                    }
                    VStack(alignment: .leading, spacing: 5) {
                        title
                        status
                    }
                }

                if worker.running {
                    if let total = worker.total, total > 0 {
                        ProgressView(value: min(Double(worker.done), Double(total)), total: Double(total))
                            .tint(KindredTheme.accent)
                    } else {
                        ProgressView().tint(KindredTheme.accent)
                    }
                }

                Group {
                    if let total = worker.total {
                        Text("\(worker.done.formatted()) of \(total.formatted()) files")
                    } else {
                        Text("\(worker.done.formatted()) files")
                    }
                }
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(KindredTheme.inkMeta)
            }
            .padding(.top, 2)
        }
        .padding(16)
        .accessibilityElement(children: .combine)
    }

    private var title: some View {
        Text(worker.title)
            .font(.headline)
            .foregroundStyle(KindredTheme.ink)
    }

    private var status: some View {
        HStack(spacing: 6) {
            if worker.running || worker.complete {
                Circle()
                    .fill(KindredTheme.sageText)
                    .frame(width: 6, height: 6)
                    .accessibilityHidden(true)
            }
            Text(worker.status)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(worker.complete ? KindredTheme.sageText : KindredTheme.inkSecondary)
        }
    }
}
