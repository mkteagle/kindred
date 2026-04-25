import SwiftUI

struct DuplicatesView: View {
    @Bindable var viewModel: ExploreViewModel
    @State private var selectedPhoto: PhotoGridItem?
    @State private var photoToDelete: DuplicatePhoto?
    @State private var showDeleteConfirm = false

    var body: some View {
        Group {
            if viewModel.isLoadingDuplicates {
                ProgressView("Finding duplicates...")
                    .font(.system(.body, design: .rounded))
            } else if viewModel.duplicates.isEmpty {
                ContentUnavailableView(
                    "No Duplicates",
                    systemImage: "checkmark.circle",
                    description: Text("No duplicate photos found. Your library is clean!")
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 24) {
                        ForEach(viewModel.duplicates) { group in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text("\(group.photos.count) similar photos")
                                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                                        .foregroundStyle(KindredTheme.darkAccent)
                                    Spacer()
                                    Text("\(Int(group.similarity * 100))% similar")
                                        .font(.system(.caption, design: .rounded, weight: .medium))
                                        .foregroundStyle(KindredTheme.pine)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(KindredTheme.pine.opacity(0.12))
                                        .clipShape(Capsule())
                                }
                                .padding(.horizontal)

                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 8) {
                                        ForEach(group.photos) { photo in
                                            ZStack(alignment: .topTrailing) {
                                                AsyncImage(url: URL(string: photo.thumb_url ?? photo.photo_url ?? "")) { phase in
                                                    switch phase {
                                                    case .success(let image):
                                                        image
                                                            .resizable()
                                                            .aspectRatio(1, contentMode: .fill)
                                                            .frame(width: 140, height: 140)
                                                            .clipped()
                                                    default:
                                                        KindredTheme.warmCardBackground
                                                            .frame(width: 140, height: 140)
                                                            .overlay {
                                                                ProgressView()
                                                            }
                                                    }
                                                }
                                                .clipShape(RoundedRectangle(cornerRadius: KindredTheme.cardRadius))
                                                .shadow(color: KindredTheme.cardShadow, radius: 4, x: 0, y: 2)
                                                .onTapGesture {
                                                    selectedPhoto = PhotoGridItem(
                                                        id: photo.photo_id,
                                                        photoURL: photo.photo_url ?? photo.thumb_url ?? "",
                                                        thumbURL: photo.thumb_url,
                                                        flickrURL: photo.flickr_url,
                                                        title: nil
                                                    )
                                                }

                                                // Delete button
                                                Button {
                                                    photoToDelete = photo
                                                    showDeleteConfirm = true
                                                } label: {
                                                    Image(systemName: "xmark.circle.fill")
                                                        .font(.title3)
                                                        .symbolRenderingMode(.palette)
                                                        .foregroundStyle(.white, .red)
                                                }
                                                .padding(6)
                                            }
                                        }
                                    }
                                    .padding(.horizontal)
                                }
                            }
                        }
                    }
                    .padding(.vertical)
                }
            }
        }
        .background(KindredTheme.warmBackground)
        .navigationTitle("Duplicates")
        .navigationBarTitleDisplayMode(.large)
        .sheet(item: $selectedPhoto) { item in
            FullScreenPhotoView(item: item)
        }
        .alert("Delete Photo", isPresented: $showDeleteConfirm) {
            Button("Delete from Flickr", role: .destructive) {
                if let photo = photoToDelete {
                    Task {
                        await viewModel.deleteDuplicatePhotos(photoIds: [photo.photo_id])
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will permanently delete this photo from Flickr. This cannot be undone.")
        }
        .task {
            if viewModel.duplicates.isEmpty {
                await viewModel.loadDuplicates()
            }
        }
    }
}
