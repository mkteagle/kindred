import SwiftUI

/// Join this device to a household by scanning the code its web app shows.
///
/// Scanning is the fast path; typing is always available, because cameras fail,
/// codes get read down a phone line, and a person on a video call can just say
/// the eight characters.
struct PairDeviceView: View {
    /// Supplied when the screen was opened by a `kindred://pair` link, in which
    /// case there is nothing to scan or type — claim it straight away.
    var initialPairing: PairingService.Pairing?

    @Environment(\.dismiss) private var dismiss

    @State private var typedCode = ""
    @State private var typedServer = ""
    @State private var mode: Mode = .scanning
    @State private var status: Status = .idle
    @FocusState private var codeFieldFocused: Bool

    enum Mode { case scanning, typing }

    enum Status: Equatable {
        case idle
        case working
        case failed(String)
        case paired
    }

    var body: some View {
        NavigationStack {
            Group {
                switch status {
                case .paired: pairedView
                default: pairingView
                }
            }
            .navigationTitle("Add this device")
            .task {
                guard let initialPairing, status == .idle else { return }
                await claim(initialPairing)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    // MARK: - Pairing

    private var pairingView: some View {
        VStack(spacing: 0) {
            if mode == .scanning {
                scanner
            } else {
                manualEntry
            }

            VStack(spacing: 12) {
                if case .failed(let message) = status {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if status == .working {
                    ProgressView().padding(.vertical, 2)
                }

                Button(mode == .scanning ? "Enter the code instead" : "Scan a code instead") {
                    status = .idle
                    mode = mode == .scanning ? .typing : .scanning
                    codeFieldFocused = mode == .typing
                }
                .font(.subheadline.weight(.semibold))
            }
            .padding(20)
        }
    }

    private var scanner: some View {
        VStack(spacing: 16) {
            Text("On a computer, open Kindred and go to Settings → Pair a device. Point your camera at the code it shows.")
                .font(.subheadline)
                .foregroundStyle(KindredTheme.inkBody)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
                .padding(.top, 16)

            PairingScannerView(
                onCode: { scanned in
                    guard status != .working else { return }
                    handle(scanned)
                },
                onFailure: { message in
                    // No camera is not an error worth blocking on — typing works.
                    status = .failed(message)
                    mode = .typing
                }
            )
            .frame(maxWidth: .infinity)
            .frame(height: 300)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(.quaternary, lineWidth: 1)
            )
            .padding(.horizontal, 20)
        }
    }

    private var manualEntry: some View {
        Form {
            Section {
                TextField("ABCD-2345", text: $typedCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(.title2, design: .monospaced))
                    .focused($codeFieldFocused)
                    .onChange(of: typedCode) { _, newValue in
                        // Keep only characters the alphabet allows, so a typo is
                        // visible immediately rather than at submit time.
                        let cleaned = PairingService.normalise(newValue)
                        let grouped = cleaned.count > 4
                            ? "\(cleaned.prefix(4))-\(cleaned.dropFirst(4).prefix(4))"
                            : String(cleaned)
                        if grouped != newValue { typedCode = grouped }
                    }
            } header: {
                Text("Pairing code")
            } footer: {
                Text("Shown in Kindred on your computer, under Settings → Pair a device.")
            }

            Section {
                TextField("nas.example.com", text: $typedServer)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
            } header: {
                Text("Server address")
            } footer: {
                Text(PairingService.storedServerURL().map { "Leave blank to use \($0)." }
                     ?? "The address of your household's Kindred server.")
            }

            Section {
                Button("Pair this device") {
                    handle(typedCode, server: typedServer)
                }
                .disabled(!PairingService.isCompleteCode(typedCode) || status == .working)
            }
        }
    }

    private var pairedView: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.green)
            Text("Paired")
                .font(.title2.weight(.semibold))
            Text("This device is signed in to your household.")
                .font(.subheadline)
                .foregroundStyle(KindredTheme.inkBody)
                .multilineTextAlignment(.center)
            Button("Done") { dismiss() }
                .buttonStyle(.borderedProminent)
                .padding(.top, 8)
        }
        .padding(32)
    }

    // MARK: - Claiming

    private func handle(_ scanned: String, server: String? = nil) {
        guard var pairing = PairingService.parse(scanned) else {
            status = .failed("That doesn't look like a Kindred pairing code.")
            return
        }
        // A typed server overrides whatever the code carried, so a household on
        // a LAN address can pair without its public tunnel.
        if let typed = PairingService.normaliseServer(server) {
            pairing = PairingService.Pairing(serverURL: typed, code: pairing.code)
        }

        Task { await claim(pairing) }
    }

    private func claim(_ pairing: PairingService.Pairing) async {
        status = .working
        do {
            try await PairingService.claim(pairing)
            status = .paired
        } catch {
            status = .failed(error.localizedDescription)
            // Fall back to typing: a failed scan usually means a stale code, and
            // re-scanning the same one will fail the same way.
            if mode == .scanning { mode = .typing }
        }
    }
}
