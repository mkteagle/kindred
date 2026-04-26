import SwiftUI

struct ObjectsView: View {
    @Bindable var viewModel: ExploreViewModel
    @State private var selectedPhoto: PhotoGridItem?
    @State private var expandedObject: String?

    var sortedObjectKeys: [String] {
        viewModel.objects.keys.sorted()
    }

    var body: some View {
        Group {
            if viewModel.isLoadingObjects {
                ProgressView("Loading objects...")
                    .font(.system(.body, design: .rounded))
            } else if viewModel.objects.isEmpty {
                ContentUnavailableView(
                    "No Objects",
                    systemImage: "cube",
                    description: Text("No object detection data found.")
                )
            } else {
                List {
                    ForEach(sortedObjectKeys, id: \.self) { objectName in
                        if let photos = viewModel.objects[objectName] {
                            Section {
                                DisclosureGroup(
                                    isExpanded: Binding(
                                        get: { expandedObject == objectName },
                                        set: { expandedObject = $0 ? objectName : nil }
                                    )
                                ) {
                                    let items = photos.map { PhotoGridItem(from: $0) }
                                    PhotoGridView(photoURLs: items) { item in
                                        selectedPhoto = item
                                    }
                                    .listRowInsets(EdgeInsets())
                                } label: {
                                    HStack {
                                        Text(objectName.capitalized)
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
        .navigationTitle("Objects")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $selectedPhoto) { item in
            FullScreenPhotoView(item: item)
        }
        .task {
            if viewModel.objects.isEmpty {
                await viewModel.loadObjects()
            }
        }
    }
}
