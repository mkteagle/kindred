import SwiftUI

/// Full-screen photo viewer with zoom and swipe-to-dismiss.
struct FullScreenPhotoView: View {
    let item: PhotoGridItem
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1.0

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ScrollView([.horizontal, .vertical], showsIndicators: false) {
                    AsyncImage(url: URL(string: item.photoURL)) { phase in
                        switch phase {
                        case .success(let image):
                            image
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
                        case .failure:
                            ContentUnavailableView(
                                "Failed to load",
                                systemImage: "photo.badge.exclamationmark",
                                description: Text("The photo could not be loaded.")
                            )
                        case .empty:
                            ProgressView()
                                .frame(width: geometry.size.width, height: geometry.size.height)
                        @unknown default:
                            EmptyView()
                        }
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
                if let flickrURL = item.flickrURL, let url = URL(string: flickrURL) {
                    ToolbarItem(placement: .topBarTrailing) {
                        Link(destination: url) {
                            Image(systemName: "arrow.up.right.square")
                        }
                    }
                }
            }
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}
