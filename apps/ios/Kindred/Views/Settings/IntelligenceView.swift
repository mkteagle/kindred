import SwiftUI

// MARK: - Intelligence State Manager

/// Manages server-side intelligence settings with UserDefaults persistence.
@Observable
final class IntelligenceState {
    static let shared = IntelligenceState()

    var enabled: Bool {
        didSet { UserDefaults.standard.set(enabled, forKey: "intelligence_enabled") }
    }
    var facesEnabled: Bool {
        didSet { UserDefaults.standard.set(facesEnabled, forKey: "intelligence_faces") }
    }
    var petsEnabled: Bool {
        didSet { UserDefaults.standard.set(petsEnabled, forKey: "intelligence_pets") }
    }
    var placesEnabled: Bool {
        didSet { UserDefaults.standard.set(placesEnabled, forKey: "intelligence_places") }
    }
    var objectsEnabled: Bool {
        didSet { UserDefaults.standard.set(objectsEnabled, forKey: "intelligence_objects") }
    }
    var landmarksEnabled: Bool {
        didSet { UserDefaults.standard.set(landmarksEnabled, forKey: "intelligence_landmarks") }
    }

    // Status info (mock for now)
    let modelVersion = "Kindred Vision \u{00b7} v3.2.1"
    let modelSize = "214 MB"
    let lastUpdated = "Apr 18"
    let serverStatus = "Connected"
    let totalIndexed = 12_407

    private init() {
        let defaults = UserDefaults.standard
        // Default to true for first launch
        if defaults.object(forKey: "intelligence_enabled") == nil {
            defaults.set(true, forKey: "intelligence_enabled")
        }
        if defaults.object(forKey: "intelligence_faces") == nil {
            defaults.set(true, forKey: "intelligence_faces")
        }
        if defaults.object(forKey: "intelligence_pets") == nil {
            defaults.set(true, forKey: "intelligence_pets")
        }
        if defaults.object(forKey: "intelligence_places") == nil {
            defaults.set(true, forKey: "intelligence_places")
        }
        if defaults.object(forKey: "intelligence_objects") == nil {
            defaults.set(true, forKey: "intelligence_objects")
        }
        // landmarks default off
        if defaults.object(forKey: "intelligence_landmarks") == nil {
            defaults.set(false, forKey: "intelligence_landmarks")
        }

        self.enabled = defaults.bool(forKey: "intelligence_enabled")
        self.facesEnabled = defaults.bool(forKey: "intelligence_faces")
        self.petsEnabled = defaults.bool(forKey: "intelligence_pets")
        self.placesEnabled = defaults.bool(forKey: "intelligence_places")
        self.objectsEnabled = defaults.bool(forKey: "intelligence_objects")
        self.landmarksEnabled = defaults.bool(forKey: "intelligence_landmarks")
    }
}

// MARK: - Intelligence Main View (Screen 01 + 02)

struct IntelligenceView: View {
    @State private var intelligence = IntelligenceState.shared
    @State private var showExplainer = false
    @State private var showReindexConfirm = false
    @State private var showPauseConfirm = false

    var body: some View {
        ZStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    if intelligence.enabled {
                        enabledContent
                    } else {
                        disabledContent
                    }
                    Spacer().frame(height: intelligence.enabled ? 110 : 140)
                }
            }
            .kindredPaperBackground()

            // Sticky CTA when disabled
            if !intelligence.enabled {
                VStack {
                    Spacer()
                    KindredButton(
                        title: "Turn intelligence on",
                        style: .primary,
                        isFullWidth: true
                    ) {
                        withAnimation(.easeOut(duration: 0.28)) {
                            intelligence.enabled = true
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                    .background(
                        LinearGradient(
                            colors: [KindredTheme.paper.opacity(0), KindredTheme.paper],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .frame(height: 80)
                        .allowsHitTesting(false)
                    )
                }
            }
        }
        .navigationTitle("Intelligence")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showExplainer) {
            IntelligenceExplainerSheet()
                .presentationDetents([.large])
                .presentationCornerRadius(22)
                .presentationDragIndicator(.visible)
        }
        .alert("Pause intelligence?", isPresented: $showPauseConfirm) {
            Button("Pause", role: .destructive) {
                withAnimation(.easeOut(duration: 0.28)) {
                    intelligence.enabled = false
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Existing groups will stay. New photos won\u{2019}t be sorted.")
        }
        .alert("Re-index library?", isPresented: $showReindexConfirm) {
            Button("Re-index now", role: .destructive) {
                // placeholder — would trigger re-index
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will re-run on every photo on your server and takes approximately 40 minutes.")
        }
    }

    // MARK: - Enabled Content (Screen 01)

    private var enabledContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Hero card
            heroCardEnabled
                .padding(.horizontal, 16)
                .padding(.top, 4)

            // Status section
            sectionEyebrow("Status")
            statusCard
                .padding(.horizontal, 16)

            // What we look for
            sectionEyebrow("What we look for")
            categoriesCard
                .padding(.horizontal, 16)

            // Maintenance
            sectionEyebrow("Maintenance")
            maintenanceCard
                .padding(.horizontal, 16)
        }
    }

    // MARK: - Disabled Content (Screen 02)

    private var disabledContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Muted hero card
            heroCardDisabled
                .padding(.horizontal, 16)
                .padding(.top, 4)

            // While off section
            sectionEyebrow("While off")
            whileOffCard
                .padding(.horizontal, 16)
        }
    }

    // MARK: - Hero Card (Enabled)

    private var heroCardEnabled: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                // Gold radial glow
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [KindredTheme.gold.opacity(0.5), .clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: 60
                        )
                    )
                    .frame(width: 120, height: 120)
                    .offset(x: 30, y: -30)

                VStack(alignment: .leading, spacing: 0) {
                    Text("PRIVATE INTELLIGENCE")
                        .font(.kindredEyebrow)
                        .tracking(1.8)
                        .foregroundStyle(KindredTheme.ember)

                    Text("Your photos stay\nin your household.")
                        .font(.display(22, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                        .lineSpacing(-2)
                        .tracking(-0.11)
                        .padding(.top, 6)

                    Text("Kindred clusters faces, recognises pets, places, and objects on your server. Nothing is sent to any third party for analysis.")
                        .font(.body(13))
                        .foregroundStyle(KindredTheme.pine)
                        .lineSpacing(3)
                        .padding(.top, 8)

                    // Status row
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Intelligence is on")
                                .font(.display(13, weight: .bold))
                                .foregroundStyle(KindredTheme.forest)
                            Text("RUNNING \u{00b7} \(intelligence.totalIndexed.formatted()) PHOTOS INDEXED")
                                .font(.mono(9, weight: .medium))
                                .tracking(1)
                                .foregroundStyle(KindredTheme.pine)
                        }
                        Spacer()
                        Toggle("", isOn: Binding(
                            get: { intelligence.enabled },
                            set: { newValue in
                                if !newValue {
                                    showPauseConfirm = true
                                }
                            }
                        ))
                        .tint(KindredTheme.forest)
                        .labelsHidden()
                    }
                    .padding(12)
                    .background(KindredTheme.forest.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(KindredTheme.forest.opacity(0.22), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .padding(.top, 14)
                }
            }
        }
        .padding(18)
        .background(
            LinearGradient(
                colors: [KindredTheme.canvas, KindredTheme.card],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(KindredTheme.line, lineWidth: 1)
        )
    }

    // MARK: - Hero Card (Disabled)

    private var heroCardDisabled: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("INTELLIGENCE \u{00b7} PAUSED")
                .font(.kindredEyebrow)
                .tracking(1.8)
                .foregroundStyle(KindredTheme.mist)

            Text("Nothing is being analysed.")
                .font(.display(20, weight: .bold))
                .foregroundStyle(KindredTheme.ash)
                .lineSpacing(-2)
                .padding(.top, 6)

            Text("Existing groups stay where they are. New photos won\u{2019}t be sorted into people, pets, or places until you turn this back on.")
                .font(.body(13))
                .foregroundStyle(KindredTheme.pine)
                .lineSpacing(3)
                .padding(.top, 8)

            HStack {
                Text("Turn intelligence back on")
                    .font(.display(13, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                Spacer()
                Toggle("", isOn: Binding(
                    get: { intelligence.enabled },
                    set: { newValue in
                        if newValue {
                            withAnimation(.easeOut(duration: 0.28)) {
                                intelligence.enabled = true
                            }
                        }
                    }
                ))
                .tint(KindredTheme.forest)
                .labelsHidden()
            }
            .padding(.top, 14)
        }
        .padding(18)
        .background(Color(hex: 0x4A281A).opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(KindredTheme.lineDark, lineWidth: 1)
        )
    }

    // MARK: - Status Card

    private var statusCard: some View {
        VStack(spacing: 0) {
            statusRow(label: "Model", value: intelligence.modelVersion, isLast: false)
            statusRow(label: "Model size", value: intelligence.modelSize, isLast: false)
            statusRow(label: "Last updated", value: intelligence.lastUpdated, isLast: false)
            statusRow(label: "Server status", value: intelligence.serverStatus, isLast: true)
        }
        .kindredGroupedCard()
    }

    private func statusRow(label: String, value: String, isLast: Bool) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text(label)
                    .font(.body(13.5))
                    .foregroundStyle(KindredTheme.ash)
                Spacer()
                Text(value)
                    .font(.mono(11))
                    .tracking(0.4)
                    .foregroundStyle(KindredTheme.mist)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)

            if !isLast {
                Divider()
                    .overlay(KindredTheme.line)
                    .padding(.leading, 14)
            }
        }
    }

    // MARK: - Categories Card

    private var categoriesCard: some View {
        let categories: [(icon: String, label: String, caption: String, binding: Binding<Bool>)] = [
            ("person.2.fill", "People (faces)", "38 people \u{00b7} last clustered 2h ago", $intelligence.facesEnabled),
            ("pawprint.fill", "Pets", "4 pets \u{00b7} cat, dog", $intelligence.petsEnabled),
            ("mappin.and.ellipse", "Places", "12 places \u{00b7} home, school, lake", $intelligence.placesEnabled),
            ("cube.fill", "Objects", "164 tags \u{00b7} books, food, plants\u{2026}", $intelligence.objectsEnabled),
            ("building.columns.fill", "Landmarks", intelligence.landmarksEnabled ? "Scanning\u{2026}" : "Off", $intelligence.landmarksEnabled),
        ]

        return VStack(spacing: 0) {
            ForEach(Array(categories.enumerated()), id: \.offset) { index, cat in
                VStack(spacing: 0) {
                    HStack(spacing: 12) {
                        // Icon tile
                        RoundedRectangle(cornerRadius: 7)
                            .fill(cat.binding.wrappedValue && intelligence.enabled
                                  ? KindredTheme.ember.opacity(0.12)
                                  : Color(hex: 0x4A281A).opacity(0.06))
                            .frame(width: 30, height: 30)
                            .overlay {
                                Image(systemName: cat.icon)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(cat.binding.wrappedValue && intelligence.enabled
                                                     ? KindredTheme.ember
                                                     : KindredTheme.mist)
                            }

                        VStack(alignment: .leading, spacing: 2) {
                            Text(cat.label)
                                .font(.display(13.5, weight: .bold))
                                .foregroundStyle(KindredTheme.ash)
                            Text(cat.caption)
                                .font(.body(11))
                                .foregroundStyle(KindredTheme.mist)
                        }
                        Spacer()
                        Toggle("", isOn: cat.binding)
                            .tint(KindredTheme.forest)
                            .labelsHidden()
                            .disabled(!intelligence.enabled)
                            .opacity(intelligence.enabled ? 1 : 0.4)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)

                    if index < categories.count - 1 {
                        Divider()
                            .overlay(KindredTheme.line)
                            .padding(.leading, 14)
                    }
                }
            }
        }
        .kindredGroupedCard()
    }

    // MARK: - Maintenance Card

    private var maintenanceCard: some View {
        VStack(spacing: 0) {
            // Re-index library
            Button {
                showReindexConfirm = true
            } label: {
                maintenanceRow(
                    icon: "arrow.triangle.2.circlepath",
                    iconTint: KindredTheme.pine,
                    iconBg: Color(hex: 0x4A281A).opacity(0.06),
                    label: "Re-index library",
                    caption: "Will re-run on your server \u{00b7} ~40 min",
                    isLast: false
                )
            }
            .buttonStyle(.plain)

            Divider()
                .overlay(KindredTheme.line)
                .padding(.leading, 14)

            // What is this?
            Button {
                showExplainer = true
            } label: {
                maintenanceRow(
                    icon: "info.circle",
                    iconTint: Color(hex: 0xA8821F),
                    iconBg: KindredTheme.gold.opacity(0.18),
                    label: "What is this?",
                    caption: "Plain-English explainer",
                    isLast: true
                )
            }
            .buttonStyle(.plain)
        }
        .kindredGroupedCard()
    }

    private func maintenanceRow(icon: String, iconTint: Color, iconBg: Color, label: String, caption: String, isLast: Bool) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 7)
                .fill(iconBg)
                .frame(width: 30, height: 30)
                .overlay {
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(iconTint)
                }

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.display(13.5, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                Text(caption)
                    .font(.body(11))
                    .foregroundStyle(KindredTheme.mist)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(KindredTheme.mist)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - While Off Card

    private var whileOffCard: some View {
        let items = [
            ("New photos", "Backed up but not sorted"),
            ("Existing people, places", "Frozen as-is"),
            ("Search", "Limited to dates + albums"),
            ("Memories", "Paused"),
        ]
        return VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                VStack(spacing: 0) {
                    HStack {
                        Text(item.0)
                            .font(.body(13))
                            .foregroundStyle(KindredTheme.ash)
                        Spacer()
                        Text(item.1)
                            .font(.mono(11))
                            .foregroundStyle(KindredTheme.mist)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)

                    if index < items.count - 1 {
                        Divider()
                            .overlay(KindredTheme.line)
                            .padding(.leading, 14)
                    }
                }
            }
        }
        .kindredGroupedCard()
    }

    // MARK: - Section Eyebrow Helper

    private func sectionEyebrow(_ text: String) -> some View {
        KindredEyebrow(text: text, color: KindredTheme.pine)
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 6)
    }
}

// MARK: - Explainer Sheet (Screen 03)

struct IntelligenceExplainerSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            KindredTheme.paper.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    // Eyebrow + title
                    Text("WHAT RUNS ON YOUR SERVER")
                        .font(.kindredEyebrow)
                        .tracking(1.8)
                        .foregroundStyle(KindredTheme.ember)
                        .padding(.top, 4)

                    Text("Recognition happens on your server, not in the cloud.")
                        .font(.display(22, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                        .lineSpacing(-2)
                        .tracking(-0.11)
                        .padding(.top, 8)

                    // Diagram card
                    diagramCard
                        .padding(.top, 14)

                    // Plain answers
                    qaSection
                        .padding(.top, 14)

                    Spacer().frame(height: 100)
                }
                .padding(.horizontal, 22)
            }

            // Sticky "Got it" button
            VStack {
                Spacer()
                KindredButton(
                    title: "Got it",
                    style: .dark,
                    isFullWidth: true
                ) {
                    dismiss()
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 22)
            }
        }
    }

    // MARK: - Diagram

    private var diagramCard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                // Server column
                VStack(spacing: 8) {
                    Image(systemName: "server.rack")
                        .font(.system(size: 28, weight: .light))
                        .foregroundStyle(KindredTheme.ash)
                    Text("Your server")
                        .font(.display(11, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                    Text("FACE \u{00b7} PET \u{00b7} OBJECT")
                        .font(.mono(8, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(KindredTheme.pine)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(KindredTheme.gold.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(KindredTheme.gold.opacity(0.33), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 10))

                // Arrow
                VStack(spacing: 3) {
                    Image(systemName: "arrow.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(KindredTheme.forest)
                    Text("BYTES\nONLY")
                        .font(.mono(7, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(KindredTheme.forest)
                        .multilineTextAlignment(.center)
                }

                // Cloud column
                VStack(spacing: 8) {
                    Image(systemName: "cloud")
                        .font(.system(size: 28, weight: .light))
                        .foregroundStyle(KindredTheme.pine)
                    Text("Flickr storage")
                        .font(.display(11, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                    Text("RAW PHOTOS ONLY")
                        .font(.mono(8, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(KindredTheme.pine)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color(hex: 0x4A281A).opacity(0.04))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(KindredTheme.line, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }

            // Footer explanation
            Divider()
                .overlay(KindredTheme.line)
                .padding(.top, 14)

            Text("Faces, pet detections, and place names are processed on your server. They never leave your household \u{2014} only the photo bytes themselves are backed up to Flickr.")
                .font(.body(11.5))
                .foregroundStyle(KindredTheme.pine)
                .lineSpacing(3)
                .padding(.horizontal, 4)
                .padding(.top, 10)
        }
        .padding(14)
        .background(KindredTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(KindredTheme.line, lineWidth: 1)
        )
    }

    // MARK: - Q&A

    private var qaSection: some View {
        let qas: [(String, String)] = [
            ("Does Kindred see my photos?", "No. Recognition runs on your own server. Storage is end-to-end with Flickr."),
            ("What if I share with the household?", "Detections sync as labels (e.g. \u{201c}Maya\u{201d}, \u{201c}Lake Galena\u{201d}) \u{2014} not raw recognition data."),
            ("Can I turn it off?", "Yes. Existing groups freeze; new photos stop being sorted."),
        ]

        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(qas.enumerated()), id: \.offset) { index, qa in
                VStack(alignment: .leading, spacing: 3) {
                    Text(qa.0)
                        .font(.display(13, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                    Text(qa.1)
                        .font(.body(12))
                        .foregroundStyle(KindredTheme.pine)
                        .lineSpacing(3)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 10)

                if index < qas.count - 1 {
                    Divider()
                        .overlay(KindredTheme.line)
                }
            }
        }
    }
}

// MARK: - Onboarding Step (Screen 04)

struct IntelligenceOnboardingView: View {
    @State private var intelligence = IntelligenceState.shared
    var onComplete: (Bool) -> Void = { _ in }

    var body: some View {
        ZStack {
            KindredTheme.paper.ignoresSafeArea()

            VStack(spacing: 0) {
                // Step indicator
                VStack(alignment: .leading, spacing: 10) {
                    Text("STEP 4 OF 5")
                        .font(.kindredEyebrow)
                        .tracking(1.8)
                        .foregroundStyle(KindredTheme.ember)

                    // Progress bar
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(Color(hex: 0x4A281A).opacity(0.1))
                                .frame(height: 3)
                            RoundedRectangle(cornerRadius: 2)
                                .fill(KindredTheme.ember)
                                .frame(width: geo.size.width * 0.8, height: 3)
                        }
                    }
                    .frame(height: 3)
                }
                .padding(.horizontal, 22)
                .padding(.top, 10)

                Spacer().frame(height: 24)

                // Hero glyph
                RoundedRectangle(cornerRadius: 24)
                    .fill(
                        LinearGradient(
                            colors: [KindredTheme.gold, KindredTheme.ember],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 88, height: 88)
                    .overlay {
                        Image(systemName: "sun.max")
                            .font(.system(size: 40, weight: .light))
                            .foregroundStyle(.white)
                    }
                    .shadow(color: KindredTheme.ember.opacity(0.28), radius: 20, x: 0, y: 18)

                Spacer().frame(height: 18)

                // Title
                Text("Let Kindred sort your\nlibrary, privately.")
                    .font(.display(24, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                    .multilineTextAlignment(.center)
                    .lineSpacing(-2)
                    .tracking(-0.12)

                // Body
                (Text("Kindred recognises faces, pets, and places ")
                + Text("on your server")
                    .italic()
                + Text(" \u{2014} so search and Memories work without sending your photos to any third party."))
                    .font(.body(13.5))
                    .foregroundStyle(KindredTheme.pine)
                    .lineSpacing(3)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.top, 10)

                Spacer().frame(height: 22)

                // Trust points
                trustPoints
                    .padding(.horizontal, 22)

                Spacer()

                // Buttons
                VStack(spacing: 8) {
                    KindredButton(
                        title: "Turn intelligence on",
                        style: .primary,
                        isFullWidth: true
                    ) {
                        intelligence.enabled = true
                        onComplete(true)
                    }

                    Button {
                        onComplete(false)
                    } label: {
                        Text("Skip \u{2014} I\u{2019}ll decide later")
                            .font(.body(13, weight: .semibold))
                            .foregroundStyle(KindredTheme.pine)
                            .frame(height: 42)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
        }
    }

    private var trustPoints: some View {
        let points: [(icon: String, title: String, subtitle: String)] = [
            ("shield.fill", "Stays on your server", "No third-party analysis"),
            ("slider.horizontal.3", "You stay in control", "Toggle any category off, anytime"),
            ("clock.fill", "~40 min for first sort", "Runs on your server in the background"),
        ]

        return VStack(spacing: 0) {
            ForEach(Array(points.enumerated()), id: \.offset) { index, point in
                HStack(alignment: .top, spacing: 12) {
                    RoundedRectangle(cornerRadius: 7)
                        .fill(KindredTheme.forest.opacity(0.1))
                        .frame(width: 30, height: 30)
                        .overlay {
                            Image(systemName: point.icon)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(KindredTheme.forest)
                        }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(point.title)
                            .font(.display(13.5, weight: .bold))
                            .foregroundStyle(KindredTheme.ash)
                        Text(point.subtitle)
                            .font(.body(12))
                            .foregroundStyle(KindredTheme.mist)
                    }
                    Spacer()
                }
                .padding(.vertical, 10)

                if index < points.count - 1 {
                    Divider()
                        .overlay(KindredTheme.line)
                }
            }
        }
    }
}
