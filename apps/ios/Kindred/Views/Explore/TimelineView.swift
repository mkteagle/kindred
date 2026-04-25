import SwiftUI

struct TimelineView: View {
    @Bindable var viewModel: ExploreViewModel
    @State private var selectedPhoto: PhotoGridItem?
    @State private var scrollTarget: String?

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
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                            ForEach(viewModel.timeline) { month in
                                Section {
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
                                    .padding(.bottom, 12)
                                } header: {
                                    HStack {
                                        Text(month.month)
                                            .font(.system(.subheadline, design: .rounded, weight: .bold))
                                            .foregroundStyle(KindredTheme.darkAccent)
                                        Spacer()
                                        Text("\(month.count)")
                                            .font(.system(.caption, design: .rounded, weight: .medium))
                                            .foregroundStyle(.secondary)
                                    }
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(.ultraThinMaterial)
                                    .id(month.month)
                                }
                            }
                        }
                    }
                    .onChange(of: scrollTarget) {
                        if let target = scrollTarget {
                            withAnimation {
                                proxy.scrollTo(target, anchor: .top)
                            }
                            scrollTarget = nil
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KindredTheme.warmBackground.ignoresSafeArea())
        .navigationTitle("Timeline")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ForEach(viewModel.timeline) { month in
                        Button(month.month) {
                            scrollTarget = month.month
                        }
                    }
                } label: {
                    Image(systemName: "calendar.badge.clock")
                        .foregroundStyle(KindredTheme.pine)
                }
            }
        }
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
