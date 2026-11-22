import Foundation
import OSLog
import PostHog
import UIKit

enum Analytics {
    enum BackupStage: String {
        case preflight, queue, staging, multipart, receipt, background
        case resumableStart = "resumable_start"
        case resumableChunk = "resumable_chunk"
        case resumableComplete = "resumable_complete"
        case resumablePoll = "resumable_poll"
        case verifyCopies = "verify_copies"
    }

    enum BackupReason: String {
        case wifiRequired = "wifi_required"
        case signInRequired = "sign_in_required"
        case queueWriteFailed = "queue_write_failed"
        case originalUnavailable = "original_unavailable"
        case localFileError = "local_file_error"
        case invalidOffset = "invalid_offset"
        case finalizationTimeout = "finalization_timeout"
        case missingNASReceipt = "missing_nas_receipt"
        case invalidResponse = "invalid_response"
        case payloadTooLarge = "payload_too_large"
        case forbidden, cancelled, offline, timeout
        case rateLimited = "rate_limited"
        case serverFailure = "server_failure"
        case httpFailure = "http_failure"
        case networkFailure = "network_failure"
        case unexpected
        case backgroundUnavailable = "background_unavailable"
    }

    struct BackupFailure {
        let reason: BackupReason
        let httpStatus: Int?
        let retryable: Bool

        init(_ reason: BackupReason, httpStatus: Int? = nil, retryable: Bool = false) {
            self.reason = reason
            self.httpStatus = httpStatus
            self.retryable = retryable
        }

        init(_ error: Error) {
            switch error {
            case let failure as BackgroundUploadError:
                switch failure {
                case .invalidResponse: self.init(.invalidResponse, retryable: failure.isRetryable)
                case .nasOriginalUnconfirmed: self.init(.missingNASReceipt)
                case .http(let status, _): self.init(httpStatus: status, retryable: failure.isRetryable)
                }
            case let failure as APIClient.APIError:
                switch failure {
                case .unauthorized: self.init(httpStatus: 401, retryable: false)
                case .httpError(let status): self.init(httpStatus: status, retryable: failure.isRetryable)
                case .invalidResponse, .invalidURL: self.init(.invalidResponse, retryable: failure.isRetryable)
                }
            case let failure as FlickrUploader.UploadError:
                switch failure {
                case .noAssetData: self.init(.originalUnavailable)
                case .cannotStageUpload: self.init(.localFileError)
                case .queuePersistenceFailed: self.init(.queueWriteFailed)
                case .invalidServerOffset: self.init(.invalidOffset)
                case .finalizationTimedOut: self.init(.finalizationTimeout)
                }
            case let failure as URLError:
                switch failure.code {
                case .cancelled: self.init(.cancelled)
                case .timedOut: self.init(.timeout, retryable: true)
                case .notConnectedToInternet, .networkConnectionLost: self.init(.offline, retryable: true)
                case .badURL, .userAuthenticationRequired, .dataNotAllowed, .fileDoesNotExist: self.init(.networkFailure)
                default: self.init(.networkFailure, retryable: true)
                }
            case is DecodingError: self.init(.invalidResponse)
            case is CancellationError: self.init(.cancelled)
            case is CocoaError: self.init(.localFileError)
            default: self.init(.unexpected)
            }
        }

        private init(httpStatus: Int, retryable: Bool) {
            let reason: BackupReason
            switch httpStatus {
            case 401: reason = .signInRequired
            case 403: reason = .forbidden
            case 408: reason = .timeout
            case 413: reason = .payloadTooLarge
            case 429: reason = .rateLimited
            case 500...599: reason = .serverFailure
            default: reason = .httpFailure
            }
            self.init(reason, httpStatus: httpStatus, retryable: retryable)
        }
    }

    private static let logger = Logger(subsystem: "com.kindlingsignal.kindred", category: "Backup")
    private static let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
    private static let event = "backup_diagnostic"
    private static let timingEvent = "backup_timing"
    private static let transportTimingEvent = "backup_transport_timing"
    private static let propertyNames: Set<String> = [
        "stage", "reason", "http_status", "retryable", "attempt_id", "app_build",
        "attempt_number", "media_type", "bytes", "network_start", "network_end", "low_data_mode",
        "app_state_start", "app_state_end", "elapsed_ms", "queue_wait_ms", "staging_ms", "setup_ms",
        "transfer_ms", "finalize_ms", "icloud_fetch_ms", "outcome", "response_wait_ms", "callback_wait_ms"
    ]

    static func configure() {
        guard let token = Bundle.main.object(forInfoDictionaryKey: "KindredPostHogProjectToken") as? String,
              token.hasPrefix("phc_"),
              let host = Bundle.main.object(forInfoDictionaryKey: "KindredPostHogHost") as? String,
              URL(string: host)?.scheme == "https" else { return }
        let config = PostHogConfig(projectToken: token, host: host)
        config.personProfiles = .never
        config.setDefaultPersonProperties = false
        config.captureScreenViews = false
        config.captureApplicationLifecycleEvents = false
        config.enableSwizzling = false
        config.preloadFeatureFlags = false
        config.setBeforeSend { event in
            guard [Self.event, Self.timingEvent, Self.transportTimingEvent].contains(event.event),
                  let id = event.properties["attempt_id"] as? String,
                  UUID(uuidString: id) != nil else { return nil }
            event.distinctId = id
            event.properties = event.properties.filter { Self.propertyNames.contains($0.key) }
            event.properties["$process_person_profile"] = false
            event.properties["$geoip_disable"] = true
            return event
        }
        PostHogSDK.shared.setup(config)
    }

    static func backupDiagnostic(_ stage: BackupStage, failure: BackupFailure, attemptID: UUID = UUID()) {
        guard failure.reason != .cancelled else { return }
        let id = attemptID.uuidString
        logger.notice("backup_diagnostic stage=\(stage.rawValue, privacy: .public) reason=\(failure.reason.rawValue, privacy: .public) http_status=\(failure.httpStatus ?? 0, privacy: .public) retryable=\(failure.retryable, privacy: .public) attempt_id=\(id, privacy: .public) app_build=\(build, privacy: .public)")
        var properties: [String: Any] = [
            "stage": stage.rawValue,
            "reason": failure.reason.rawValue,
            "retryable": failure.retryable,
            "attempt_id": id,
            "app_build": build,
        ]
        properties["http_status"] = failure.httpStatus
        PostHogSDK.shared.capture(event, distinctId: id, properties: properties)
    }

    static func backupTransportTiming(
        _ stage: BackupStage, attemptID: UUID, submittedAt: Date?,
        transaction: URLSessionTaskTransactionMetrics, callbackAt: Date
    ) {
        func milliseconds(_ start: Date?, _ end: Date?) -> Int? {
            guard let start, let end else { return nil }
            return Int(max(0, end.timeIntervalSince(start) * 1_000))
        }
        var properties: [String: Any] = [
            "attempt_id": attemptID.uuidString, "stage": stage.rawValue, "app_build": build,
            "bytes": transaction.countOfRequestBodyBytesSent,
            "network_start": transaction.isCellular ? "cellular" : "unmetered_or_unknown",
        ]
        properties["queue_wait_ms"] = milliseconds(submittedAt, transaction.fetchStartDate)
        properties["transfer_ms"] = milliseconds(transaction.requestStartDate, transaction.requestEndDate)
        properties["response_wait_ms"] = milliseconds(transaction.requestEndDate, transaction.responseEndDate)
        properties["callback_wait_ms"] = milliseconds(transaction.responseEndDate, callbackAt)
        properties["http_status"] = (transaction.response as? HTTPURLResponse)?.statusCode
        PostHogSDK.shared.capture(transportTimingEvent, distinctId: attemptID.uuidString, properties: properties)
    }

    struct BackupTiming {
        enum Phase: String {
            case staging = "staging_ms"
            case setup = "setup_ms"
            case transfer = "transfer_ms"
            case finalize = "finalize_ms"
        }

        private let startedAt = ContinuousClock.now
        private let appState: String
        private let network: String
        private let lowDataMode: Bool
        private var phase: Phase?
        private var phaseStartedAt: ContinuousClock.Instant?
        private var durations: [Phase: Duration] = [:]
        var bytes: Int?
        var iCloudFetch: Duration?

        @MainActor init() {
            appState = Self.currentAppState
            network = NetworkReachability.shared.backupConnection
            lowDataMode = NetworkReachability.shared.isConstrained
        }

        mutating func begin(_ phase: Phase) {
            let now = ContinuousClock.now
            finishPhase(at: now)
            self.phase = phase
            phaseStartedAt = now
        }

        @MainActor mutating func record(
            attemptID: UUID,
            attemptNumber: Int,
            queueWait: Duration?,
            isVideo: Bool,
            stage: BackupStage,
            failure: BackupFailure?
        ) {
            let now = ContinuousClock.now
            finishPhase(at: now)
            let id = attemptID.uuidString
            let outcome = failure.map { $0.reason == .cancelled ? "cancelled" : "failed" } ?? "succeeded"
            let elapsed = Self.milliseconds(startedAt.duration(to: now))
            let appStateEnd = Self.currentAppState
            let networkEnd = NetworkReachability.shared.backupConnection
            var properties: [String: Any] = [
                "attempt_id": id,
                "attempt_number": attemptNumber,
                "app_build": Analytics.build,
                "media_type": isVideo ? "video" : "photo",
                "stage": stage.rawValue,
                "outcome": outcome,
                "elapsed_ms": elapsed,
                "app_state_start": appState,
                "app_state_end": appStateEnd,
                "network_start": network,
                "network_end": networkEnd,
                "low_data_mode": lowDataMode,
            ]
            properties["reason"] = failure?.reason.rawValue
            properties["http_status"] = failure?.httpStatus
            properties["bytes"] = bytes
            properties["queue_wait_ms"] = queueWait.map(Self.milliseconds)
            properties["icloud_fetch_ms"] = iCloudFetch.map(Self.milliseconds)
            for (phase, duration) in durations {
                properties[phase.rawValue] = Self.milliseconds(duration)
            }
            Analytics.logger.notice("backup_timing outcome=\(outcome, privacy: .public) stage=\(stage.rawValue, privacy: .public) elapsed_ms=\(elapsed, privacy: .public) app_state=\(appStateEnd, privacy: .public) network=\(networkEnd, privacy: .public)")
            PostHogSDK.shared.capture(Analytics.timingEvent, distinctId: id, properties: properties)
        }

        private mutating func finishPhase(at now: ContinuousClock.Instant) {
            guard let phase, let phaseStartedAt else { return }
            durations[phase, default: .zero] += phaseStartedAt.duration(to: now)
            self.phaseStartedAt = nil
        }

        private static func milliseconds(_ duration: Duration) -> Int64 {
            let parts = duration.components
            return parts.seconds * 1_000 + parts.attoseconds / 1_000_000_000_000_000
        }

        @MainActor private static var currentAppState: String {
            switch UIApplication.shared.applicationState {
            case .active: return "active"
            case .inactive: return "inactive"
            case .background: return "background"
            @unknown default: return "unknown"
            }
        }
    }
}
