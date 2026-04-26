import SwiftUI

struct TimelineView: View {
    @Bindable var viewModel: ExploreViewModel
    @State private var selectedPhoto: PhotoGridItem?
    @State private var scrollTarget: String?

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.isLoadingTimeline {
                Spacer()
                ProgressView()
                    .tint(KindredTheme.ember)
                Spacer()
            } else if viewModel.timeline.isEmpty {
                ContentUnavailableView(
                    "No Timeline Data",
                    systemImage: "calendar",
                    description: Text("No photos with date information found.")
                )
            } else {
                ScrollViewReader { proxy in
                    ScrollView(showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 0) {
                            // Page header
                            KindredPageHeader(
                                eyebrow: "This week",
                                title: currentWeekRange
                            )

                            LazyVStack(spacing: 18) {
                                ForEach(viewModel.timeline) { month in
                                    dayGroup(month: month)
                                        .id(month.month)
                                }
                            }
                            .padding(.top, 8)

                            Spacer().frame(height: 40)
                        }
                    }
                    .onChange(of: scrollTarget) {
                        if let target = scrollTarget {
                            withAnimation { proxy.scrollTo(target, anchor: .top) }
                            scrollTarget = nil
                        }
                    }
                }
            }
        }
        .kindredPaperBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Timeline")
                    .font(.kindredTitle)
                    .foregroundStyle(KindredTheme.ash)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ForEach(viewModel.timeline) { month in
                        Button(month.month) { scrollTarget = month.month }
                    }
                } label: {
                    Text("YEAR ▾")
                        .font(.kindredMicro)
                        .tracking(1.4)
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

    // MARK: - Day Group

    private func dayGroup(month: TimelineMonth) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // Day header
            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(month.month)
                        .font(.display(17, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                    Text("\(month.count) photos")
                        .font(.kindredMeta)
                        .tracking(0.6)
                        .foregroundStyle(KindredTheme.mist)
                }
                Spacer()
                Text("SEE ALL")
                    .font(.kindredMicro)
                    .tracking(1.4)
                    .foregroundStyle(KindredTheme.pine)
            }
            .padding(.horizontal, 20)

            // 3-column grid
            let items = month.photos.map { photo in
                PhotoGridItem(
                    id: photo.photo_id,
                    photoURL: photo.thumb_url ?? "",
                    thumbURL: photo.thumb_url,
                    flickrURL: photo.flickr_url,
                    title: photo.photo_title
                )
            }

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: 3),
                    GridItem(.flexible(), spacing: 3),
                    GridItem(.flexible(), spacing: 3),
                ],
                spacing: 3
            ) {
                ForEach(items.prefix(6)) { item in
                    AsyncImage(url: URL(string: item.thumbURL ?? item.photoURL)) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFill()
                        default:
                            KindredTheme.canvas
                        }
                    }
                    .aspectRatio(1, contentMode: .fill)
                    .clipShape(RoundedRectangle(cornerRadius: 3))
                    .contentShape(Rectangle())
                    .onTapGesture { selectedPhoto = item }
                }
            }
            .padding(.horizontal, 14)
        }
    }

    private var currentWeekRange: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        let now = Date()
        let weekAgo = Calendar.current.date(byAdding: .day, value: -6, to: now)!
        return "\(formatter.string(from: weekAgo)) – \(formatter.string(from: now)), \(Calendar.current.component(.year, from: now))"
    }
}
