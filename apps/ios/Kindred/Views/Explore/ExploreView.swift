import SwiftUI

struct ExploreView: View {
    @State private var viewModel = ExploreViewModel()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    exploreRow(title: "Timeline", icon: "calendar", color: KindredTheme.pine) {
                        TimelineView(viewModel: viewModel)
                    }

                    exploreRow(title: "Locations", icon: "mappin.and.ellipse", color: KindredTheme.ember) {
                        LocationsView(viewModel: viewModel)
                    }

                    exploreRow(title: "Landmarks", icon: "building.columns", color: .orange) {
                        ScenesView(viewModel: viewModel)
                    }

                    exploreRow(title: "Objects", icon: "cube.fill", color: .purple) {
                        ObjectsView(viewModel: viewModel)
                    }
                } header: {
                    Text("Browse")
                        .font(.kindredMeta)
                }

                Section {
                    exploreRow(title: "Duplicates", icon: "square.on.square", color: .red) {
                        DuplicatesView(viewModel: viewModel)
                    }
                } header: {
                    Text("Cleanup")
                        .font(.kindredMeta)
                }
            }
            .scrollContentBackground(.hidden)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(KindredTheme.paper.ignoresSafeArea())
            .navigationTitle("Explore")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Image("KindredLogo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 32, height: 32)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
        }
        .tint(KindredTheme.pine)
    }

    private func exploreRow<Destination: View>(
        title: String,
        icon: String,
        color: Color,
        @ViewBuilder destination: @escaping () -> Destination
    ) -> some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.kindredLabel)
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(color)
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                Text(title)
                    .font(.kindredBody)
            }
            .padding(.vertical, 2)
        }
    }
}
