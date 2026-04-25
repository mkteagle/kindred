import SwiftUI

struct LocationsView: View {
    @Bindable var viewModel: ExploreViewModel
    @State private var selectedPhoto: PhotoGridItem?
    @State private var expandedLocation: String?

    var body: some View {
        Group {
            if viewModel.isLoadingLocations {
                ProgressView("Loading locations...")
                    .font(.system(.body, design: .rounded))
            } else if viewModel.locations.isEmpty {
                ContentUnavailableView(
                    "No Locations",
                    systemImage: "mappin.slash",
                    description: Text("No photos with location data found.")
                )
            } else {
                List {
                    ForEach(viewModel.locations) { location in
                        Section {
                            DisclosureGroup(
                                isExpanded: Binding(
                                    get: { expandedLocation == location.name },
                                    set: { expandedLocation = $0 ? location.name : nil }
                                )
                            ) {
                                let items = location.photos.map { photo in
                                    PhotoGridItem(
                                        id: photo.photo_id,
                                        photoURL: photo.thumb_url ?? "",
                                        thumbURL: photo.thumb_url,
                                        flickrURL: photo.flickr_url,
                                        title: photo.photo_title
                                    )
                                }
                                PhotoGridView(photoURLs: items, columns: 3) { item in
                                    selectedPhoto = item
                                }
                                .listRowInsets(EdgeInsets())
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(location.name)
                                            .font(.system(.headline, design: .rounded, weight: .semibold))
                                        Text("\(location.count) photos")
                                            .font(.system(.caption, design: .rounded))
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }
                            }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
                .listStyle(.insetGrouped)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KindredTheme.warmBackground.ignoresSafeArea())
        .navigationTitle("Locations")
        .navigationBarTitleDisplayMode(.large)
        .sheet(item: $selectedPhoto) { item in
            FullScreenPhotoView(item: item)
        }
        .task {
            if viewModel.locations.isEmpty {
                await viewModel.loadLocations()
            }
        }
    }
}
