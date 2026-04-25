import SwiftUI

struct TimelineView: View {
    @Bindable var viewModel: ExploreViewModel
    @State private var selectedPhoto: PhotoGridItem?

    var body: some View {
        Group {
            if viewModel.isLoadingTimeline {
                ProgressView("Loading timeline...")
                    .font(.system(.body, design: .rounded))
            } else if viewModel.timeline.isEmpty {
                ContentUnavailableView(
                    "No Timeline Data",
                    systemImage: "calendar",
                    description: Text("No photos with date information found.")
                )
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 24) {
                        ForEach(viewModel.timeline) { month in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(month.month)
                                        .font(.system(.headline, design: .rounded, weight: .bold))
                                        .foregroundStyle(KindredTheme.darkAccent)
                                    Spacer()
                                    Text("\(month.count) photos")
                                        .font(.system(.caption, design: .rounded, weight: .medium))
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(KindredTheme.warmCardBackground)
                                        .clipShape(Capsule())
                                }
                                .padding(.horizontal)

                                let items = month.photos.map { photo in
                                    PhotoGridItem(
                                        id: photo.photo_id,
                                        photoURL: photo.thumb_url ?? "",
                                        thumbURL: photo.thumb_url,
                                        flickrURL: photo.flickr_url,
                                        title: photo.photo_title
                                    )
                                }

                                PhotoGridView(photoURLs: items, columns: 4) { item in
                                    selectedPhoto = item
                                }
                                .padding(.horizontal, 2)
                            }
                        }
                    }
                    .padding(.vertical)
                }
            }
        }
        .background(KindredTheme.warmBackground)
        .navigationTitle("Timeline")
        .navigationBarTitleDisplayMode(.large)
        .sheet(item: $selectedPhoto) { item in
            FullScreenPhotoView(item: item)
        }
        .task {
            if viewModel.timeline.isEmpty {
                await viewModel.loadTimeline()
            }
        }
    }
}
