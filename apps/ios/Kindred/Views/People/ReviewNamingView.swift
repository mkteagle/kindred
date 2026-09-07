import SwiftUI

/// Screen 11 — Review / naming. One unnamed cluster at a time, with the
/// keyboard's obvious next action pinned to the bottom.
///
/// Reuse-a-name chips come from `/clusters/named`, so a household that has
/// already named Junie once never types it again.
struct ReviewNamingView: View {
    let queue: [ClusterSummary]
    var onFinish: () -> Void

    @State private var index = 0
    @State private var name = ""
    @State private var suggestions: [NamedCluster] = []
    @State private var faces: [Detection] = []
    @State private var isSaving = false
    @State private var showMerge = false
    @Environment(\.dismiss) private var dismiss
    @FocusState private var nameFocused: Bool

    private var current: ClusterSummary? {
        index < queue.count ? queue[index] : nil
    }

    var body: some View {
        VStack(spacing: 0) {
            navBar

            if let cluster = current {
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        progressBar
                            .padding(.bottom, 18)

                        FaceCircle(url: cluster.avatar ?? cluster.thumb_url)
                            .frame(width: 172, height: 172)
                            .frame(maxWidth: .infinity)

                        Text(coverMeta(for: cluster))
                            .font(.kindredMeta)
                            .foregroundStyle(KindredTheme.inkMeta)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 12)

                        Text("Who is this?")
                            .font(.display(22, weight: .semibold, relativeTo: .title2))
                            .foregroundStyle(KindredTheme.ink)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 18)
                            .padding(.bottom, 10)
                            .accessibilityAddTraits(.isHeader)

                        nameField
                        suggestionChips
                        faceStrip
                    }
                    .padding(.horizontal, KindredTheme.gutter)
                    .padding(.bottom, 24)
                }

                actionStack
            } else {
                doneState
            }
        }
        .background(KindredTheme.bg.ignoresSafeArea())
        .sheet(isPresented: $showMerge) {
            MergeIntoSheet(candidates: suggestions) { target in
                showMerge = false
                Task { await merge(into: target) }
            }
        }
        .task { await loadSuggestions() }
        .task(id: index) { await loadFaces() }
    }

    // MARK: - Chrome

    private var navBar: some View {
        HStack {
            Button {
                onFinish()
                dismiss()
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 19, weight: .semibold))
                    Text("People")
                        .font(.body(15, weight: .semibold, relativeTo: .headline))
                }
            }
            .foregroundStyle(KindredTheme.accent)
            .accessibilityLabel("Back to People")

            Spacer()

            Text("\(min(index + 1, max(queue.count, 1))) of \(queue.count)")
                .font(.kindredMeta)
                .foregroundStyle(KindredTheme.inkMeta)

            Spacer()

            Button("Skip") { advance() }
                .font(.body(15, weight: .semibold, relativeTo: .headline))
                .foregroundStyle(KindredTheme.accent)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var progressBar: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(KindredTheme.fillStrongest)
                Capsule()
                    .fill(KindredTheme.accent)
                    .frame(width: geo.size.width * fraction)
            }
        }
        .frame(height: 3)
        .accessibilityLabel("Progress")
        .accessibilityValue("\(index) of \(queue.count) reviewed")
    }

    private var fraction: CGFloat {
        guard queue.count > 0 else { return 0 }
        return CGFloat(index) / CGFloat(queue.count)
    }

    // MARK: - Input

    private var nameField: some View {
        TextField("Name this person", text: $name)
            .font(.display(16, weight: .medium, relativeTo: .body))
            .foregroundStyle(KindredTheme.ink)
            .tint(KindredTheme.accent)
            .textInputAutocapitalization(.words)
            .autocorrectionDisabled()
            .submitLabel(.done)
            .focused($nameFocused)
            .onSubmit { Task { await save() } }
            .padding(.horizontal, 13)
            .frame(minHeight: 46)
            .background(KindredTheme.fill)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(KindredTheme.hairlineStrong, lineWidth: 1)
            )
            .accessibilityLabel("Name this person")
    }

    private var suggestionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(suggestions) { candidate in
                    Button(candidate.label ?? "") {
                        name = candidate.label ?? ""
                    }
                    .font(.body(12, weight: .semibold, relativeTo: .footnote))
                    .foregroundStyle(KindredTheme.ink)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 6)
                    .background(KindredTheme.fillStrongest, in: Capsule())
                    .accessibilityHint("Reuse this name")
                }
            }
        }
        .scrollClipDisabled()
        .padding(.top, 12)
    }

    private var faceStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(faces.prefix(4)) { face in
                    detectionChip(face)
                }
                if let cluster = current, cluster.det_count > 4 {
                    Text("+\(cluster.det_count - 4)")
                        .font(.kindredMeta)
                        .foregroundStyle(KindredTheme.inkMeta)
                        .frame(width: 52, height: 52)
                        .background(
                            KindredTheme.fillStrongest,
                            in: RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                        )
                }
            }
        }
        .scrollClipDisabled()
        .padding(.top, 18)
        .accessibilityLabel("Other photos of this person")
    }

    private func detectionChip(_ detection: Detection) -> some View {
        Group {
            let source = detection.chip ?? detection.thumb_url ?? detection.photo_url
            if DemoDataProvider.isDemoURL(source) {
                DemoThumbnailView(urlString: source, cornerRadius: KindredTheme.radiusSM)
            } else if let url = URL(string: source) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFill()
                    default: KindredTheme.tile
                    }
                }
            } else {
                KindredTheme.tile
            }
        }
        .frame(width: 52, height: 52)
        .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
        .accessibilityHidden(true)
    }

    // MARK: - Actions

    private var actionStack: some View {
        VStack(spacing: 8) {
            KindredButton(
                title: "Save name", style: .primary, isFullWidth: true, isLoading: isSaving
            ) {
                Task { await save() }
            }
            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            .opacity(name.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)

            HStack(spacing: 8) {
                KindredButton(title: "Merge into…", style: .ghost, isSmall: true, isFullWidth: true) {
                    showMerge = true
                }
                KindredButton(title: "Not a person", style: .danger, isSmall: true, isFullWidth: true) {
                    Task { await dismissCluster() }
                }
            }
        }
        .padding(.horizontal, KindredTheme.gutter)
        .padding(.bottom, 30)
        .padding(.top, 8)
        .background(KindredTheme.bg)
    }

    private var doneState: some View {
        VStack(spacing: 12) {
            Spacer()
            KindredEyebrow(text: "All caught up", color: KindredTheme.sageText)
            Text("Everyone has a name.")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ink)
            KindredButton(title: "Done", style: .primary) {
                onFinish()
                dismiss()
            }
            .padding(.top, 8)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func coverMeta(for cluster: ClusterSummary) -> String {
        // "first seen" would need a date on the cluster summary; until then
        // this states only what the summary actually knows.
        "\(cluster.photo_count.formatted()) photos · \(cluster.det_count.formatted()) faces"
    }

    private func save() async {
        guard let cluster = current else { return }
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        isSaving = true
        try? await APIClient.shared.labelCluster(
            LabelRequest(cluster_id: cluster.id, label: trimmed, category: "people")
        )
        isSaving = false
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        advance()
        await loadSuggestions()
    }

    private func merge(into target: NamedCluster) async {
        guard let cluster = current else { return }
        try? await APIClient.shared.mergeClusters(
            MergeRequest(source_id: cluster.id, target_id: target.id, category: "people")
        )
        advance()
    }

    private func dismissCluster() async {
        guard let cluster = current else { return }
        try? await APIClient.shared.dismissCluster(
            DismissRequest(cluster_id: cluster.id, category: "people")
        )
        advance()
    }

    private func advance() {
        name = ""
        nameFocused = false
        withAnimation(KindredTheme.ease(0.24)) { index += 1 }
    }

    private func loadSuggestions() async {
        suggestions = (try? await APIClient.shared.namedClusters(category: "people")) ?? []
    }

    private func loadFaces() async {
        guard let cluster = current else { return }
        let detail = try? await APIClient.shared.getClusterDetail(
            category: "people", clusterId: cluster.id
        )
        faces = detail?.items ?? []
    }
}

// MARK: - Merge sheet

struct MergeIntoSheet: View {
    let candidates: [NamedCluster]
    let onPick: (NamedCluster) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(candidates) { candidate in
                    Button {
                        onPick(candidate)
                    } label: {
                        HStack(spacing: 12) {
                            KindredAvatar(url: candidate.avatar, size: 34)
                            Text(candidate.label ?? "Unnamed")
                                .font(.kindredLabel)
                                .foregroundStyle(KindredTheme.ink)
                            Spacer()
                        }
                    }
                    .listRowBackground(KindredTheme.fill)
                }
            }
            .scrollContentBackground(.hidden)
            .background(KindredTheme.sheet.ignoresSafeArea())
            .navigationTitle("Merge into")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(KindredTheme.accent)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
