import SwiftUI

struct ClusterDetailView: View {
    let cluster: ClusterSummary
    let category: ClusterCategory
    @Bindable var viewModel: LibraryViewModel
    @State private var selectedPhoto: PhotoGridItem?
    @State private var showDismissConfirm = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if viewModel.isLoadingDetail {
                ProgressView("Loading photos...")
                    .font(.system(.body, design: .rounded))
            } else if let detail = viewModel.clusterDetail {
                ScrollView {
                    let items = detail.items.map { PhotoGridItem(from: $0) }
                    PhotoGridView(photoURLs: items) { item in
                        selectedPhoto = item
                    }
                }
            } else {
                ContentUnavailableView(
                    "No Photos",
                    systemImage: "photo.on.rectangle.angled",
                    description: Text("No photos found in this group.")
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KindredTheme.warmBackground.ignoresSafeArea())
        .navigationTitle(cluster.label ?? "Unknown")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        showDismissConfirm = true
                    } label: {
                        Label("Dismiss Group", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundStyle(KindredTheme.pine)
                }
            }
        }
        .sheet(item: $selectedPhoto) { item in
            FullScreenPhotoView(item: item)
        }
        .alert("Dismiss Group", isPresented: $showDismissConfirm) {
            Button("Dismiss", role: .destructive) {
                Task {
                    await viewModel.dismissCluster(clusterId: cluster.id)
                    dismiss()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will dismiss all detections in this group. This cannot be undone.")
        }
        .task {
            await viewModel.loadClusterDetail(cluster: cluster)
        }
    }
}
