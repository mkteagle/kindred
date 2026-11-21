import Foundation
import OSLog
import PostHog

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
    private static let propertyNames: Set<String> = [
        "stage", "reason", "http_status", "retryable", "attempt_id", "app_build"
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
            guard event.event == Self.event,
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
}
