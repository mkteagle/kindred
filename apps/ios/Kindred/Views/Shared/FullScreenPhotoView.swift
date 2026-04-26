import SwiftUI

/// Full-screen photo viewer with zoom and swipe-to-dismiss.
/// Loads full-res images through the Kindred backend proxy so family
/// members can view private Flickr photos without their own account.
struct FullScreenPhotoView: View {
    let item: PhotoGridItem
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1.0
    @State private var imageData: Data?
    @State private var isLoading = true
    @State private var loadError = false

    /// Build the proxy URL for full-res photo viewing
    private var proxyURL: URL? {
        // Extract photo_id — for detection items the id is the detection UUID,
        // but the photo_id is embedded in the photoURL or stored separately.
        // For most items, the id IS the photo_id.
        let photoId = item.id
        // Use the backend proxy with size=b (1024px) for fast loading
        guard let token = SessionManager.shared.sessionToken else { return nil }
        // We'll load this authenticated, so build the URL with the photo ID
        return URL(string: "https://api.kindredphotos.app/photos/\(photoId)/image?size=h")
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView([.horizontal, .vertical], showsIndicators: false) {
                    if let imageData, let uiImage = UIImage(data: imageData) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(
                                width: geometry.size.width * scale,
                                height: geometry.size.height * scale
                            )
                            .gesture(
                                MagnifyGesture()
                                    .onChanged { value in
                                        scale = max(1.0, value.magnification)
                                    }
                                    .onEnded { value in
                                        withAnimation {
                                            scale = max(1.0, min(value.magnification, 4.0))
                                        }
                                    }
                            )
                            .onTapGesture(count: 2) {
                                withAnimation {
                                    scale = scale > 1.0 ? 1.0 : 2.0
                                }
                            }
                    } else if loadError {
                        ContentUnavailableView(
                            "Failed to load",
                            systemImage: "photo.badge.exclamationmark",
                            description: Text("The photo could not be loaded.")
                        )
                    } else {
                        ProgressView()
                            .frame(width: geometry.size.width, height: geometry.size.height)
                    }
                }
            }
            .background(.black)
            .navigationTitle(item.title ?? "Photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") {
                        dismiss()
                    }
                    .font(.system(.body, design: .rounded, weight: .medium))
                }
            }
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .task {
                await loadImage()
            }
        }
    }

    private func loadImage() async {
        guard let proxyURL else {
            // Fall back to direct URL if no session
            await loadDirect()
            return
        }

        var request = URLRequest(url: proxyURL)
        if let token = SessionManager.shared.sessionToken {
            request.setValue(token, forHTTPHeaderField: "X-Session-Token")
        }
        request.timeoutInterval = 30

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                // Fall back to direct URL
                await loadDirect()
                return
            }
            await MainActor.run {
                self.imageData = data
                self.isLoading = false
            }
        } catch {
            await loadDirect()
        }
    }

    /// Fallback: load directly from the Flickr CDN URL
    private func loadDirect() async {
        guard let url = URL(string: item.photoURL) else {
            await MainActor.run { loadError = true; isLoading = false }
            return
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            await MainActor.run {
                self.imageData = data
                self.isLoading = false
            }
        } catch {
            await MainActor.run { loadError = true; isLoading = false }
        }
    }
}
