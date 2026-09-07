import SwiftUI

// MARK: - Admin Scan View

struct AdminScanView: View {
    @State private var activeJob: ScanJob?
    @State private var syncs: [SyncLog] = []
    @State private var isLoading = true
    @State private var isTriggering = false
    @State private var triggerError: String?
    @State private var triggerSuccess: String?
    @State private var pollTimer: Timer?

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                KindredPageHeader(eyebrow: "Admin", title: "Scan & maintenance.")

                // Active job card
                activeJobSection

                // Trigger button
                triggerSection

                // Sync history
                syncHistorySection

                Spacer().frame(height: 100)
            }
        }
        .kindredPaperBackground()
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadData()
            startPollingIfNeeded()
        }
        .onDisappear {
            stopPolling()
        }
    }

    // MARK: - Active Job Section

    private var activeJobSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredEyebrow(text: "Current scan", color: KindredTheme.pine)
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 6)

            if let job = activeJob {
                activeJobCard(job)
                    .padding(.horizontal, 16)
            } else {
                idleCard
                    .padding(.horizontal, 16)
            }
        }
    }

    private func activeJobCard(_ job: ScanJob) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Status row
            HStack(spacing: 8) {
                Circle()
                    .fill(job.status == "running" ? KindredTheme.forest : KindredTheme.mist)
                    .frame(width: 8, height: 8)
                Text(job.status.uppercased())
                    .font(.kindredEyebrow)
                    .tracking(1.4)
                    .foregroundStyle(job.status == "running" ? KindredTheme.forest : KindredTheme.mist)
                Spacer()
                if job.status == "running" {
                    ProgressView()
                        .tint(KindredTheme.forest)
                        .scaleEffect(0.7)
                }
            }

            // Message
            Text(job.message)
                .font(.body(13))
                .foregroundStyle(KindredTheme.pine)
                .lineSpacing(3)
                .padding(.top, 8)

            // Progress bar
            progressBar(progress: job.total > 0 ? Double(job.progress) / Double(job.total) : 0)
                .padding(.top, 12)

            // Stats row
            HStack(spacing: 0) {
                statPill(value: "\(job.progress)", label: "of \(job.total)")
                Spacer()
                if let counts = job.counts {
                    HStack(spacing: 12) {
                        miniStat(icon: "person.2.fill", value: counts.people)
                        miniStat(icon: "pawprint.fill", value: counts.pets)
                        miniStat(icon: "car.fill", value: counts.vehicles)
                    }
                }
            }
            .padding(.top, 10)
        }
        .padding(16)
        .background(
            job.status == "running"
                ? KindredTheme.forest.opacity(0.06)
                : KindredTheme.card
        )
        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusMD))
        .overlay(
            RoundedRectangle(cornerRadius: KindredTheme.radiusMD)
                .stroke(
                    job.status == "running"
                        ? KindredTheme.forest.opacity(0.22)
                        : KindredTheme.line,
                    lineWidth: 1
                )
        )
    }

    private var idleCard: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 7)
                .fill(KindredTheme.fill)
                .frame(width: 30, height: 30)
                .overlay {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(KindredTheme.mist)
                }
            VStack(alignment: .leading, spacing: 2) {
                Text("No scan running")
                    .font(.display(13.5, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                Text("Your library is idle")
                    .font(.body(11))
                    .foregroundStyle(KindredTheme.mist)
            }
            Spacer()
        }
        .padding(14)
        .kindredGroupedCard()
    }

    // MARK: - Trigger Section

    private var triggerSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredButton(
                title: activeJob != nil ? "Scan in progress..." : "Trigger scan",
                icon: "arrow.triangle.2.circlepath",
                style: activeJob != nil ? .ghost : .forest,
                isFullWidth: true,
                isLoading: isTriggering
            ) {
                Task { await triggerScan() }
            }
            .disabled(activeJob != nil || isTriggering)
            .padding(.horizontal, 16)
            .padding(.top, 14)

            // Feedback messages
            if let error = triggerError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 11))
                    Text(error)
                        .font(.kindredMeta)
                }
                .foregroundStyle(KindredTheme.rosehip)
                .padding(.horizontal, 20)
                .padding(.top, 8)
            }

            if let success = triggerSuccess {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 11))
                    Text(success)
                        .font(.kindredMeta)
                }
                .foregroundStyle(KindredTheme.forest)
                .padding(.horizontal, 20)
                .padding(.top, 8)
            }
        }
    }

    // MARK: - Sync History

    private var syncHistorySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            KindredEyebrow(text: "Scan history", color: KindredTheme.pine)
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 6)

            if isLoading {
                VStack(spacing: 12) {
                    ForEach(0..<3, id: \.self) { _ in
                        SkeletonCard()
                            .frame(height: 60)
                    }
                }
                .padding(.horizontal, 16)
            } else if syncs.isEmpty {
                emptyHistoryCard
                    .padding(.horizontal, 16)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(syncs.prefix(20).enumerated()), id: \.element.id) { index, sync in
                        syncRow(sync, isLast: index == min(syncs.count, 20) - 1)
                    }
                }
                .kindredGroupedCard()
                .padding(.horizontal, 16)
            }
        }
    }

    private var emptyHistoryCard: some View {
        HStack(spacing: 12) {
            Image(systemName: "clock")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(KindredTheme.mist)
            Text("No scans yet")
                .font(.kindredLabel)
                .foregroundStyle(KindredTheme.mist)
            Spacer()
        }
        .padding(14)
        .kindredGroupedCard()
    }

    private func syncRow(_ sync: SyncLog, isLast: Bool) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                // Status indicator
                Circle()
                    .fill(syncStatusColor(sync.status))
                    .frame(width: 8, height: 8)
                    .padding(.top, 5)

                VStack(alignment: .leading, spacing: 3) {
                    // Date + status
                    HStack {
                        Text(formatSyncDate(sync.finished_at ?? sync.started_at))
                            .font(.display(13, weight: .bold))
                            .foregroundStyle(KindredTheme.ash)
                        Spacer()
                        Text(sync.status.uppercased())
                            .font(.mono(9, weight: .semibold))
                            .tracking(0.8)
                            .foregroundStyle(syncStatusColor(sync.status))
                    }

                    // Photo count
                    if let total = sync.total_photos, total > 0 {
                        Text("\(total) photos processed")
                            .font(.body(11))
                            .foregroundStyle(KindredTheme.mist)
                    }

                    // Discovery stats
                    let discoveries = discoveryText(sync)
                    if !discoveries.isEmpty {
                        Text(discoveries)
                            .font(.mono(10))
                            .tracking(0.3)
                            .foregroundStyle(KindredTheme.pine)
                    }

                    // Error message
                    if let error = sync.error, !error.isEmpty {
                        Text(error)
                            .font(.body(11))
                            .foregroundStyle(KindredTheme.rosehip)
                            .lineLimit(2)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)

            if !isLast {
                Divider()
                    .overlay(KindredTheme.line)
                    .padding(.leading, 34)
            }
        }
    }

    // MARK: - Progress Bar

    private func progressBar(progress: Double) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(KindredTheme.fillStrongest)
                    .frame(height: 6)

                RoundedRectangle(cornerRadius: 3)
                    .fill(
                        LinearGradient(
                            colors: [KindredTheme.forest, KindredTheme.lichen],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: max(0, geo.size.width * CGFloat(progress)), height: 6)
                    .animation(.easeOut(duration: 0.6), value: progress)
            }
        }
        .frame(height: 6)
    }

    // MARK: - Helpers

    private func statPill(value: String, label: String) -> some View {
        HStack(spacing: 4) {
            Text(value)
                .font(.display(13, weight: .bold))
                .foregroundStyle(KindredTheme.ash)
            Text(label)
                .font(.body(11))
                .foregroundStyle(KindredTheme.mist)
        }
    }

    private func miniStat(icon: String, value: Int) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(KindredTheme.pine)
            Text("\(value)")
                .font(.mono(10, weight: .semibold))
                .foregroundStyle(KindredTheme.pine)
        }
    }

    private func syncStatusColor(_ status: String) -> Color {
        switch status.lowercased() {
        case "completed", "done", "success":
            return KindredTheme.forest
        case "failed", "error":
            return KindredTheme.rosehip
        case "running":
            return KindredTheme.ember
        default:
            return KindredTheme.mist
        }
    }

    private func formatSyncDate(_ dateStr: String?) -> String {
        guard let dateStr else { return "Unknown" }

        // Try ISO 8601 variants
        let formatters: [DateFormatter] = {
            let iso = DateFormatter()
            iso.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSSSS"
            iso.locale = Locale(identifier: "en_US_POSIX")
            let isoZ = DateFormatter()
            isoZ.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
            isoZ.locale = Locale(identifier: "en_US_POSIX")
            return [iso, isoZ]
        }()

        for formatter in formatters {
            if let date = formatter.date(from: dateStr) {
                let display = DateFormatter()
                display.dateFormat = "MMM d, h:mm a"
                return display.string(from: date)
            }
        }

        return String(dateStr.prefix(16))
    }

    private func discoveryText(_ sync: SyncLog) -> String {
        var parts: [String] = []
        if let faces = sync.new_faces, faces > 0 { parts.append("\(faces) new faces") }
        if let pets = sync.new_pets, pets > 0 { parts.append("\(pets) new pets") }
        if let vehicles = sync.new_vehicles, vehicles > 0 { parts.append("\(vehicles) new vehicles") }
        return parts.joined(separator: " \u{00b7} ")
    }

    // MARK: - Data Loading

    private func loadData() async {
        isLoading = true
        async let jobResult: Void = loadActiveJob()
        async let syncsResult: Void = loadSyncs()
        _ = await (jobResult, syncsResult)
        isLoading = false
    }

    private func loadActiveJob() async {
        do {
            activeJob = try await APIClient.shared.getActiveJob()
        } catch {
            activeJob = nil
        }
    }

    private func loadSyncs() async {
        do {
            syncs = try await APIClient.shared.getSyncs()
        } catch {
            // Silently fail; list stays empty
        }
    }

    private func triggerScan() async {
        isTriggering = true
        triggerError = nil
        triggerSuccess = nil

        do {
            let response = try await APIClient.shared.triggerScan()
            triggerSuccess = response.message
            // Refresh active job after a short delay
            try? await Task.sleep(for: .seconds(1))
            await loadActiveJob()
            startPollingIfNeeded()
        } catch {
            triggerError = error.localizedDescription
        }

        isTriggering = false
    }

    // MARK: - Polling

    private func startPollingIfNeeded() {
        guard activeJob != nil else {
            stopPolling()
            return
        }
        guard pollTimer == nil else { return }

        pollTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            Task { @MainActor in
                await loadActiveJob()
                if activeJob == nil {
                    // Scan finished; refresh history and stop polling
                    stopPolling()
                    await loadSyncs()
                }
            }
        }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }
}
