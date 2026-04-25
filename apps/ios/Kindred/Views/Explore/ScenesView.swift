import SwiftUI

struct ScenesView: View {
    @Bindable var viewModel: ExploreViewModel
    @State private var selectedPhoto: PhotoGridItem?
    @State private var expandedScene: String?

    var sortedSceneKeys: [String] {
        viewModel.scenes.keys.sorted()
    }

    var body: some View {
        Group {
            if viewModel.isLoadingScenes {
                ProgressView("Loading landmarks...")
                    .font(.system(.body, design: .rounded))
            } else if viewModel.scenes.isEmpty {
                ContentUnavailableView(
                    "No Landmarks",
                    systemImage: "building.columns",
                    description: Text("No scene or landmark data found.")
                )
            } else {
                List {
                    ForEach(sortedSceneKeys, id: \.self) { sceneName in
                        if let photos = viewModel.scenes[sceneName] {
                            Section {
                                DisclosureGroup(
                                    isExpanded: Binding(
                                        get: { expandedScene == sceneName },
                                        set: { expandedScene = $0 ? sceneName : nil }
                                    )
                                ) {
                                    let items = photos.map { PhotoGridItem(from: $0) }
                                    PhotoGridView(photoURLs: items, columns: 3) { item in
                                        selectedPhoto = item
                                    }
                                    .listRowInsets(EdgeInsets())
                                } label: {
                                    HStack {
                                        Text(sceneName.capitalized)
                                            .font(.system(.headline, design: .rounded, weight: .semibold))
                                        Spacer()
                                        Text("\(photos.count)")
                                            .font(.system(.caption, design: .rounded, weight: .medium))
                                            .foregroundStyle(KindredTheme.pine)
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 3)
                                            .background(KindredTheme.pine.opacity(0.12))
                                            .clipShape(Capsule())
                                    }
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
        .navigationTitle("Landmarks")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $selectedPhoto) { item in
            FullScreenPhotoView(item: item)
        }
        .task {
            if viewModel.scenes.isEmpty {
                await viewModel.loadScenes()
            }
        }
    }
}
