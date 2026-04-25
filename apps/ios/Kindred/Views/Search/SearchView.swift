import SwiftUI

struct SearchView: View {
    @State private var viewModel = SearchViewModel()
    @State private var selectedPhoto: PhotoGridItem?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                HStack(spacing: 12) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(KindredTheme.pine)
                    TextField("Describe what you're looking for...", text: $viewModel.query)
                        .font(.system(.body, design: .rounded))
                        .textFieldStyle(.plain)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .submitLabel(.search)
                        .onSubmit {
                            viewModel.search()
                        }
                    if !viewModel.query.isEmpty {
                        Button {
                            viewModel.query = ""
                            viewModel.results = []
                            viewModel.hasSearched = false
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(12)
                .background(KindredTheme.warmCardBackground)
                .clipShape(RoundedRectangle(cornerRadius: KindredTheme.cardRadius))
                .shadow(color: KindredTheme.cardShadow, radius: 4, x: 0, y: 2)
                .padding()

                // Results
                if viewModel.isSearching {
                    Spacer()
                    ProgressView("Searching...")
                        .font(.system(.body, design: .rounded))
                    Spacer()
                } else if viewModel.hasSearched && viewModel.results.isEmpty {
                    ContentUnavailableView.search(text: viewModel.query)
                } else if !viewModel.results.isEmpty {
                    // Results count
                    HStack {
                        Text("\(viewModel.results.count) results for \"\(viewModel.query)\"")
                            .font(.system(.caption, design: .rounded, weight: .medium))
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 4)

                    ScrollView {
                        let items = viewModel.results.map { PhotoGridItem(from: $0) }
                        PhotoGridView(photoURLs: items) { item in
                            selectedPhoto = item
                        }
                    }
                } else {
                    // Empty state
                    Spacer()
                    VStack(spacing: 16) {
                        Image(systemName: "text.magnifyingglass")
                            .font(.system(size: 48, weight: .light))
                            .foregroundStyle(KindredTheme.pine.opacity(0.6))
                        Text("Search your photos")
                            .font(.system(.title3, design: .rounded, weight: .semibold))
                            .foregroundStyle(KindredTheme.darkAccent)
                        Text("Describe what you're looking for using natural language. Try \"sunset over water\", \"birthday cake\", or \"dog playing in snow\".")
                            .font(.system(.subheadline, design: .rounded))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }
                    Spacer()
                }

                if let error = viewModel.error {
                    Text(error)
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(.red)
                        .padding()
                }
            }
            .background(KindredTheme.warmBackground)
            .navigationTitle("Search")
            .sheet(item: $selectedPhoto) { item in
                FullScreenPhotoView(item: item)
            }
            .onChange(of: viewModel.query) {
                viewModel.search()
            }
        }
        .tint(KindredTheme.pine)
    }
}
