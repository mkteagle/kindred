import AudioToolbox
import AVFoundation
import SwiftUI

/// A live camera view that reports the first QR code it reads.
///
/// Wrapped rather than written in SwiftUI because AVFoundation needs a real
/// `AVCaptureVideoPreviewLayer`, which has to be resized by hand as the view's
/// bounds change.
struct PairingScannerView: UIViewControllerRepresentable {
    /// Called once per distinct code. The parent decides when to stop.
    var onCode: (String) -> Void
    var onFailure: (String) -> Void

    func makeUIViewController(context: Context) -> ScannerViewController {
        let controller = ScannerViewController()
        controller.onCode = onCode
        controller.onFailure = onFailure
        return controller
    }

    func updateUIViewController(_ controller: ScannerViewController, context: Context) {}
}

final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?
    var onFailure: ((String) -> Void)?

    private let session = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    /// Codes are reported many times a second while one is in frame; only the
    /// first matters, and re-reporting would fire a claim per frame.
    private var hasReported = false
    // Configuring and running a capture session blocks; keep it off main.
    private let sessionQueue = DispatchQueue(label: "com.kindlingsignal.kindred.scanner")

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        requestAccessThenConfigure()
    }

    private func requestAccessThenConfigure() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            sessionQueue.async { [weak self] in self?.configure() }
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                guard let self else { return }
                if granted {
                    self.sessionQueue.async { self.configure() }
                } else {
                    DispatchQueue.main.async {
                        self.onFailure?("Kindred needs camera access to scan a pairing code. You can also type the code instead.")
                    }
                }
            }
        default:
            onFailure?("Camera access is off for Kindred. Turn it on in Settings, or type the code instead.")
        }
    }

    private func configure() {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            DispatchQueue.main.async { [weak self] in
                self?.onFailure?("This device's camera isn't available. Type the code instead.")
            }
            return
        }

        session.beginConfiguration()
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            DispatchQueue.main.async { [weak self] in
                self?.onFailure?("This device can't scan QR codes. Type the code instead.")
            }
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        // Set after adding the output; the available types are unknown before.
        output.metadataObjectTypes = [.qr]
        session.commitConfiguration()

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let layer = AVCaptureVideoPreviewLayer(session: self.session)
            layer.videoGravity = .resizeAspectFill
            layer.frame = self.view.bounds
            self.view.layer.addSublayer(layer)
            self.previewLayer = layer
            self.sessionQueue.async { self.session.startRunning() }
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sessionQueue.async { [weak self] in
            guard let self, self.session.isRunning else { return }
            self.session.stopRunning()
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput,
                        didOutput objects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        guard !hasReported,
              let readable = objects.first as? AVMetadataMachineReadableCodeObject,
              let value = readable.stringValue else { return }
        hasReported = true
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        onCode?(value)
    }

    /// Allow another scan after a failed attempt, without rebuilding the session.
    func resume() {
        hasReported = false
        sessionQueue.async { [weak self] in
            guard let self, !self.session.isRunning else { return }
            self.session.startRunning()
        }
    }
}
