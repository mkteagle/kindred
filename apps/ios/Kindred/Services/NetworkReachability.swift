import Foundation
import Network

/// Whether the current path is one the household is happy to upload originals
/// over. "Only on Wi-Fi" is a real constraint, not a label: a full-resolution
/// video over cellular is somebody's data plan.
@Observable
@MainActor
final class NetworkReachability {
    static let shared = NetworkReachability()

    /// True when the path is unmetered. Optimistic before the first update, so
    /// a launch-time upload is never blocked by a monitor that has not spoken.
    private(set) var isUnmetered = true

    private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let unmetered = !path.isExpensive && !path.isConstrained
            Task { @MainActor in self?.isUnmetered = unmetered }
        }
        monitor.start(queue: DispatchQueue(label: "com.kindlingsignal.kindred.reachability"))
    }
}
