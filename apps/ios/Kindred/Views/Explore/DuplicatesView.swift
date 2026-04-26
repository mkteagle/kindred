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
                    .font(.kindredBody)
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
                                        .font(.kindredCardTitle)
                                        .foregroundStyle(KindredTheme.darkAccent)
                                    Spacer()
                                    Text("\(Int(group.similarity * 100))% similar")
                                        .font(.kindredMeta)
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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KindredTheme.warmBackground.ignoresSafeArea())
        .navigationTitle("Duplicates")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $selectedPhoto) { item in
            FullScreenPhotoView(item: item)
        }
        .sheet(isPresented: $showDeleteConfirm) {
            DeletePhotoSheet(
                onConfirm: {
                    showDeleteConfirm = false
                    if let photo = photoToDelete {
                        Task {
                            await viewModel.deleteDuplicatePhotos(photoIds: [photo.photo_id])
                        }
                    }
                },
                onCancel: { showDeleteConfirm = false }
            )
            .presentationDetents([.height(320)])
            .presentationDragIndicator(.visible)
        }
        .task {
            if viewModel.duplicates.isEmpty {
                await viewModel.loadDuplicates()
            }
        }
    }
}

// MARK: - Delete Photo Sheet

struct DeletePhotoSheet: View {
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "trash.fill")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(KindredTheme.rosehip)
                .padding(.top, 32)

            Text("Delete photo?")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ash)
                .padding(.top, 16)

            Text("This will permanently delete this photo from Flickr. This cannot be undone.")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.pine)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            Spacer()

            VStack(spacing: 10) {
                KindredButton(
                    title: "Delete",
                    icon: "trash",
                    style: .danger,
                    isFullWidth: true
                ) {
                    onConfirm()
                }

                KindredButton(
                    title: "Cancel",
                    style: .ghost,
                    isFullWidth: true
                ) {
                    onCancel()
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(KindredTheme.paper)
    }
}
