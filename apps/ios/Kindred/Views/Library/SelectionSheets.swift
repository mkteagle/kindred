import SwiftUI

/// "Album" in the selection bar: pick an existing album or make one, then
/// `POST /albums/{ref}/photos` projects the selection onto the NAS tree and
/// the Flickr photoset exactly as an upload would.
struct AlbumPickerSheet: View {
    let photoIDs: [String]
    let onPick: (String) -> Void

    @State private var albums: [Album] = []
    @State private var isLoading = true
    @State private var newName = ""
    @State private var isCreating = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    KindredEyebrow(text: "Add to album")
                        .padding(.top, 6)
                    Text(countLine)
                        .font(.display(21, weight: .semibold, relativeTo: .title3))
                        .foregroundStyle(KindredTheme.ink)
                        .padding(.top, 8)
                        .padding(.bottom, 16)

                    HStack(spacing: 8) {
                        TextField("New album name", text: $newName)
                            .font(.kindredBody)
                            .foregroundStyle(KindredTheme.ink)
                            .tint(KindredTheme.accent)
                            .padding(.horizontal, 13)
                            .frame(minHeight: 44)
                            .background(KindredTheme.fill)
                            .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                            .overlay(
                                RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                                    .stroke(KindredTheme.hairlineStrong, lineWidth: 1)
                            )
                            .accessibilityLabel("New album name")

                        KindredButton(title: "Create", isSmall: true, isLoading: isCreating) {
                            Task { await create() }
                        }
                        .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .padding(.bottom, 16)

                    if isLoading {
                        ProgressView().tint(KindredTheme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 30)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(albums.enumerated()), id: \.element.id) { position, album in
                                Button {
                                    if let reference = album.reference {
                                        onPick(reference)
                                        dismiss()
                                    }
                                } label: {
                                    HStack {
                                        Text(album.name)
                                            .font(.kindredLabel)
                                            .foregroundStyle(KindredTheme.ink)
                                        Spacer()
                                        Text("\(album.photo_count)")
                                            .font(.kindredMeta)
                                            .foregroundStyle(KindredTheme.inkMeta)
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundStyle(KindredTheme.inkMeta)
                                    }
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 13)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .disabled(album.reference == nil)

                                if position < albums.count - 1 {
                                    Rectangle()
                                        .fill(KindredTheme.hairlineSoft)
                                        .frame(height: 1)
                                        .padding(.leading, 14)
                                }
                            }
                        }
                        .kindredGroupedCard()
                    }

                    if let error {
                        Text(error)
                            .font(.kindredCaption)
                            .foregroundStyle(KindredTheme.dangerText)
                            .padding(.top, 10)
                    }
                }
                .padding(.horizontal, KindredTheme.gutter)
                .padding(.bottom, 30)
            }
            .background(KindredTheme.sheet.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(KindredTheme.accent)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await load() }
    }

    private var countLine: String {
        photoIDs.count == 1 ? "1 photo" : "\(photoIDs.count) photos"
    }

    private func load() async {
        isLoading = true
        albums = (try? await APIClient.shared.albums()) ?? []
        isLoading = false
    }

    private func create() async {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        isCreating = true
        defer { isCreating = false }
        do {
            let album = try await APIClient.shared.createAlbum(name: name)
            if let reference = album.reference {
                onPick(reference)
                dismiss()
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Share

/// The system share sheet over the originals of a selection.
///
/// Sharing hands out the signed media URLs rather than the bytes: downloading
/// full originals for a forty-photo selection before the sheet can open is not
/// something a phone should be asked to do.
struct SelectionShareSheet: UIViewControllerRepresentable {
    let photos: [LibraryPhoto]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let urls = photos.compactMap {
            APIClient.mediaURL(photoID: $0.photo_id, variant: .original)
        }
        return UIActivityViewController(activityItems: urls, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
