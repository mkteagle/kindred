import Foundation

/// Carries a pairing request from a `kindred://pair` link to whatever is on
/// screen when it arrives.
///
/// A deep link can land before, during or after sign-in, so the URL handler
/// cannot present anything itself — it records the request and the root view
/// presents it when it can.
@Observable
@MainActor
final class PairingCoordinator {
    static let shared = PairingCoordinator()

    /// Set when a pairing link arrives; cleared once it has been presented.
    var pending: PairingService.Pairing?
    /// Set when the user asks to pair from the UI rather than from a link.
    var isPresenting = false

    private init() {}

    /// Handle a `kindred://pair?server=…&code=…` link.
    /// Returns false if the URL is not a pairing link, so the caller can pass
    /// it to whoever else is listening on the scheme.
    @discardableResult
    func handle(url: URL) -> Bool {
        guard url.scheme?.lowercased() == "kindred",
              url.host?.lowercased() == "pair" else { return false }
        guard let pairing = PairingService.parse(url.absoluteString) else {
            // A malformed pairing link still belongs to us — open the screen so
            // the person can type the code rather than silently doing nothing.
            isPresenting = true
            return true
        }
        pending = pairing
        isPresenting = true
        return true
    }
}
