import SwiftUI

/// Full-screen photo viewer with glass chrome, info sheet, overflow menu,
/// share sheet, and swipe-between-photos navigation.
/// Matches design spec: Photo Detail screens 01-04.
struct FullScreenPhotoView: View {
    let item: PhotoGridItem
    /// Optional array of all photos in the context (grid) for swipe navigation
    var allItems: [PhotoGridItem]?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var scale: CGFloat = 1.0
    @State private var imageData: Data?
    @State private var isLoading = true
    @State private var loadError = false
    @State private var isHearted = false
    @State private var heartScale: CGFloat = 1.0

    // Sheet state — exactly one open at a time
    @State private var activeSheet: PhotoSheet? = nil

    // Swipe navigation
    @State private var currentIndex: Int = 0
    @State private var dragOffset: CGFloat = 0

    private var isIPad: Bool { horizontalSizeClass == .regular }

    private enum PhotoSheet: String, Identifiable {
        case info, overflow, share
        var id: String { rawValue }
    }

    private var photos: [PhotoGridItem] {
        allItems ?? [item]
    }

    private var currentItem: PhotoGridItem {
        guard currentIndex >= 0, currentIndex < photos.count else { return item }
        return photos[currentIndex]
    }

    private var proxyURL: URL? {
        let photoId = currentItem.id
        return URL(string: "\(APIClient.publicBaseURL)/photos/\(photoId)/image?size=h")
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if isIPad && activeSheet == .info {
                // iPad: side-by-side layout — photo on left, info panel on right
                HStack(spacing: 0) {
                    ZStack {
                        photoLayer
                        // Gradient overlays
                        VStack(spacing: 0) {
                            LinearGradient(
                                colors: [Color.black.opacity(0.45), Color.clear],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            .frame(height: 140)
                            Spacer()
                            LinearGradient(
                                colors: [Color.clear, Color.black.opacity(0.55)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            .frame(height: 200)
                        }
                        .allowsHitTesting(false)
                        topToolbar
                        actionDock
                    }

                    // Info sidebar
                    infoSheetContent
                        .frame(width: 340)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
                .ignoresSafeArea()
            } else {
                // Standard layout (iPhone + iPad without info)
                photoLayer

                // Gradient overlays
                VStack(spacing: 0) {
                    LinearGradient(
                        colors: [Color.black.opacity(0.45), Color.clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 140)
                    Spacer()
                    LinearGradient(
                        colors: [Color.clear, Color.black.opacity(0.55)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 200)
                }
                .ignoresSafeArea()
                .allowsHitTesting(false)

                // Top toolbar
                topToolbar

                // Title chip + swipe hint
                titleOverlay

                // Bottom action dock
                actionDock

                // Info sheet overlay (iPhone only)
                if !isIPad && activeSheet == .info {
                    infoSheetOverlay
                }

                // Overflow menu overlay
                if activeSheet == .overflow {
                    overflowMenuOverlay
                }
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: Binding(
            get: { activeSheet == .share },
            set: { if !$0 { activeSheet = nil } }
        )) {
            ShareSheetView(item: currentItem)
        }
        .onAppear {
            if let allItems, let idx = allItems.firstIndex(where: { $0.id == item.id }) {
                currentIndex = idx
            }
        }
        .task {
            await loadImage()
        }
    }

    // MARK: - Photo Layer (with swipe)

    private var photoLayer: some View {
        GeometryReader { geometry in
            if photos.count > 1 {
                // Swipe between photos
                HStack(spacing: 0) {
                    ForEach(photos) { photo in
                        photoContent(for: photo, size: geometry.size)
                            .frame(width: geometry.size.width, height: geometry.size.height)
                    }
                }
                .offset(x: -CGFloat(currentIndex) * geometry.size.width + dragOffset)
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            dragOffset = value.translation.width
                        }
                        .onEnded { value in
                            let threshold = geometry.size.width * 0.25
                            withAnimation(.easeOut(duration: 0.28)) {
                                if value.translation.width < -threshold && currentIndex < photos.count - 1 {
                                    currentIndex += 1
                                } else if value.translation.width > threshold && currentIndex > 0 {
                                    currentIndex -= 1
                                }
                                dragOffset = 0
                            }
                        }
                )
            } else {
                photoContent(for: currentItem, size: geometry.size)
                    .gesture(
                        MagnifyGesture()
                            .onChanged { value in
                                scale = max(1.0, value.magnification)
                            }
                            .onEnded { value in
                                withAnimation { scale = max(1.0, min(value.magnification, 4.0)) }
                            }
                    )
                    .onTapGesture(count: 2) {
                        withAnimation { scale = scale > 1.0 ? 1.0 : 2.0 }
                    }
            }
        }
    }

    private func photoContent(for photo: PhotoGridItem, size: CGSize) -> some View {
        Group {
            if DemoDataProvider.isDemoURL(photo.photoURL) {
                DemoThumbnailView(urlString: photo.photoURL, cornerRadius: 0, contentMode: .fit)
                    .frame(width: size.width, height: size.height)
            } else {
                AsyncImage(url: URL(string: photo.photoURL)) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: size.width, height: size.height)
                    case .failure:
                        VStack(spacing: 12) {
                            Image(systemName: "photo.badge.exclamationmark")
                                .font(.system(size: 40, weight: .light))
                                .foregroundStyle(.white.opacity(0.4))
                            Text("Failed to load")
                                .font(.kindredBody)
                                .foregroundStyle(.white.opacity(0.6))
                        }
                        .frame(width: size.width, height: size.height)
                    default:
                        ProgressView()
                            .tint(.white)
                            .frame(width: size.width, height: size.height)
                    }
                }
            }
        }
    }

    // MARK: - Top Toolbar (glass controls)

    private var topToolbar: some View {
        VStack {
            HStack {
                // Back button
                glassCircleButton(icon: "chevron.left") { dismiss() }

                Spacer()

                // Counter pill
                if photos.count > 1 {
                    Text("\((currentIndex + 1).formatted()) / \(photos.count.formatted())")
                        .font(.mono(10))
                        .tracking(1)
                        .foregroundStyle(KindredTheme.paper.opacity(0.85))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color(red: 20/255, green: 16/255, blue: 14/255).opacity(0.55))
                        .background(.ultraThinMaterial.opacity(0.4))
                        .clipShape(Capsule())
                }

                Spacer()

                // Overflow
                glassCircleButton(icon: "ellipsis") {
                    withAnimation(.spring(response: 0.2, dampingFraction: 0.8)) {
                        activeSheet = activeSheet == .overflow ? nil : .overflow
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 54)
            Spacer()
        }
        .zIndex(30)
    }

    private func glassCircleButton(icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(Color(red: 20/255, green: 16/255, blue: 14/255).opacity(0.55))
                .background(.ultraThinMaterial.opacity(0.4))
                .clipShape(Circle())
                .overlay(
                    Circle().stroke(.white.opacity(0.12), lineWidth: 1)
                )
        }
    }

    // MARK: - Title Overlay

    private var titleOverlay: some View {
        VStack {
            Spacer()

            VStack(alignment: .leading, spacing: 0) {
                // Title chip
                VStack(alignment: .leading, spacing: 6) {
                    Text(dateString.uppercased())
                        .font(.mono(9, weight: .semibold))
                        .tracking(1.6)
                        .foregroundStyle(KindredTheme.gold.opacity(0.95))

                    Text(currentItem.title ?? "Untitled")
                        .font(.display(17, weight: .bold))
                        .foregroundStyle(.white)
                        .lineSpacing(-1)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color(red: 20/255, green: 16/255, blue: 14/255).opacity(0.55))
                .background(.ultraThinMaterial.opacity(0.4))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .onTapGesture {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) {
                        activeSheet = .info
                    }
                }

                // Swipe hint pill
                HStack {
                    Spacer()
                    Text("\u{2191}  SWIPE FOR INFO")
                        .font(.mono(9, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(KindredTheme.paper.opacity(0.85))
                        .padding(.horizontal, 11)
                        .padding(.vertical, 5)
                        .background(Color(red: 20/255, green: 16/255, blue: 14/255).opacity(0.55))
                        .background(.ultraThinMaterial.opacity(0.4))
                        .clipShape(Capsule())
                    Spacer()
                }
                .padding(.top, 10)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 108)
        }
        .zIndex(25)
        .gesture(
            DragGesture(minimumDistance: 30)
                .onEnded { value in
                    if value.translation.height < -50 {
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) {
                            activeSheet = .info
                        }
                    }
                }
        )
    }

    // MARK: - Action Dock (bottom)

    private var actionDock: some View {
        VStack {
            Spacer()
            HStack(spacing: 10) {
                dockAction(icon: isHearted ? "heart.fill" : "heart", label: "heart",
                           isActive: isHearted) {
                    let generator = UIImpactFeedbackGenerator(style: .light)
                    generator.impactOccurred()
                    withAnimation(.easeInOut(duration: 0.12)) {
                        isHearted.toggle()
                        heartScale = 1.2
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                        withAnimation(.easeInOut(duration: 0.12)) {
                            heartScale = 1.0
                        }
                    }
                }

                dockAction(icon: "square.and.arrow.up", label: "share") {
                    activeSheet = .share
                }

                dockAction(icon: "info.circle", label: "info",
                           isActive: activeSheet == .info) {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) {
                        activeSheet = activeSheet == .info ? nil : .info
                    }
                }

                dockAction(icon: "ellipsis", label: "more") {
                    withAnimation(.spring(response: 0.2, dampingFraction: 0.8)) {
                        activeSheet = activeSheet == .overflow ? nil : .overflow
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 26)
            .padding(.top, 14)
            .background(
                LinearGradient(
                    colors: [Color(red: 10/255, green: 8/255, blue: 8/255).opacity(0), Color(red: 10/255, green: 8/255, blue: 8/255).opacity(0.85)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
            )
        }
        .zIndex(30)
    }

    private func dockAction(icon: String, label: String, isActive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .medium))
                    .scaleEffect(label == "heart" ? heartScale : 1)
                    .frame(width: 38, height: 38)
                    .background(isActive ? KindredTheme.paper.opacity(0.95) : KindredTheme.paper.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                Text(label.uppercased())
                    .font(.mono(9, weight: .semibold))
                    .tracking(1.2)
            }
            .foregroundStyle(isActive ? KindredTheme.ember : .white)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Info Sheet Overlay

    private var infoSheetOverlay: some View {
        ZStack {
            // Dimmed background
            Color.black.opacity(0.45)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) {
                        activeSheet = nil
                    }
                }

            VStack {
                Spacer()
                    .frame(height: 240)
                infoSheetContent
            }
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .zIndex(40)
    }

    private var infoSheetContent: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                // Grabber
                RoundedRectangle(cornerRadius: KindredTheme.radiusPill)
                    .fill(Color(hex: 0x4A281A).opacity(0.22))
                    .frame(width: 38, height: 5)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 10)
                    .padding(.bottom, 8)

                // Date + Title
                VStack(alignment: .leading, spacing: 0) {
                    KindredEyebrow(text: dateString)
                    Text(currentItem.title ?? "Untitled")
                        .font(.display(21, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                        .padding(.top, 6)
                    Text("Flickr \u{00b7} via Kindred Photos")
                        .font(.kindredCaption)
                        .foregroundStyle(KindredTheme.pine)
                        .padding(.top, 4)
                }
                .padding(.horizontal, 22)

                // People section
                VStack(alignment: .leading, spacing: 8) {
                    KindredEyebrow(text: "People \u{00b7} 3", color: KindredTheme.pine)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(["Person 1", "Person 2", "Person 3"], id: \.self) { name in
                                HStack(spacing: 6) {
                                    Circle()
                                        .fill(KindredTheme.avatarGradient)
                                        .frame(width: 20, height: 20)
                                        .overlay(
                                            Image(systemName: "person.fill")
                                                .font(.system(size: 9))
                                                .foregroundStyle(.white.opacity(0.8))
                                        )
                                    Text(name)
                                        .font(.display(11, weight: .bold))
                                        .foregroundStyle(KindredTheme.ash)
                                }
                                .padding(.leading, 4)
                                .padding(.trailing, 10)
                                .padding(.vertical, 5)
                                .background(KindredTheme.card)
                                .clipShape(Capsule())
                                .overlay(Capsule().stroke(KindredTheme.line, lineWidth: 1))
                            }

                            // Add tag chip
                            HStack(spacing: 4) {
                                Text("+ tag")
                                    .font(.display(11, weight: .bold))
                                    .foregroundStyle(KindredTheme.mist)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .overlay(
                                Capsule()
                                    .stroke(KindredTheme.lineDark, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                            )
                        }
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 14)

                // Where section
                VStack(alignment: .leading, spacing: 8) {
                    KindredEyebrow(text: "Where", color: KindredTheme.pine)
                    mapPreview
                }
                .padding(.horizontal, 22)
                .padding(.top, 14)

                // EXIF section
                VStack(alignment: .leading, spacing: 8) {
                    KindredEyebrow(text: "Camera \u{00b7} EXIF", color: KindredTheme.pine)
                    exifGrid
                }
                .padding(.horizontal, 22)
                .padding(.top, 14)

                // Tags section
                VStack(alignment: .leading, spacing: 8) {
                    KindredEyebrow(text: "Tags", color: KindredTheme.pine)
                    FlowLayout(spacing: 5) {
                        ForEach(["landscape", "outdoor", "golden hour", "nature", "weekend"], id: \.self) { tag in
                            Text(tag)
                                .font(.body(11))
                                .foregroundStyle(KindredTheme.pine)
                                .padding(.horizontal, 9)
                                .padding(.vertical, 4)
                                .background(KindredTheme.ash.opacity(0.06))
                                .clipShape(Capsule())
                        }
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 14)
                .padding(.bottom, 34)
            }
        }
        .background(KindredTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 22))
        .shadow(color: .black.opacity(0.4), radius: 20, x: 0, y: -20)
        .gesture(
            DragGesture()
                .onEnded { value in
                    if value.translation.height > 80 {
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) {
                            activeSheet = nil
                        }
                    }
                }
        )
    }

    private var mapPreview: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(
                LinearGradient(
                    colors: [Color(hex: 0xD9C89F), Color(hex: 0xB6A37B)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .frame(height: 78)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(KindredTheme.line, lineWidth: 1)
            )
            .overlay(alignment: .bottomLeading) {
                Text("Location")
                    .font(.display(11, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.white.opacity(0.92))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .padding(10)
            }
            .overlay(alignment: .center) {
                VStack(spacing: 0) {
                    Circle()
                        .fill(KindredTheme.ember)
                        .frame(width: 14, height: 14)
                        .overlay(Circle().stroke(.white, lineWidth: 2))
                        .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 4)
                    Rectangle()
                        .fill(KindredTheme.ember)
                        .frame(width: 1, height: 8)
                }
                .offset(y: -8)
            }
    }

    private var exifGrid: some View {
        HStack(spacing: 6) {
            ForEach([
                ("1/250", "shutter"),
                ("\u{0192}/2.8", "aperture"),
                ("400", "iso"),
                ("35mm", "focal"),
            ], id: \.0) { value, label in
                VStack(spacing: 2) {
                    Text(value)
                        .font(.mono(13, weight: .semibold))
                        .foregroundStyle(KindredTheme.ash)
                    Text(label.uppercased())
                        .font(.mono(8, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(KindredTheme.mist)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(KindredTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(KindredTheme.line, lineWidth: 1)
                )
            }
        }
    }

    // MARK: - Overflow Menu Overlay

    private var overflowMenuOverlay: some View {
        ZStack {
            // Dimmed background
            Color.black.opacity(0.45)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation(.spring(response: 0.2, dampingFraction: 0.8)) {
                        activeSheet = nil
                    }
                }

            VStack {
                HStack {
                    Spacer()
                    overflowMenu
                        .padding(.trailing, 14)
                        .padding(.top, 100)
                }
                Spacer()
            }

            // Dismiss hint at bottom
            VStack {
                Spacer()
                Text("TAP ANYWHERE TO DISMISS")
                    .font(.mono(9, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(KindredTheme.paper.opacity(0.7))
                    .padding(.horizontal, 11)
                    .padding(.vertical, 5)
                    .background(Color(red: 20/255, green: 16/255, blue: 14/255).opacity(0.55))
                    .background(.ultraThinMaterial.opacity(0.4))
                    .clipShape(Capsule())
                    .padding(.bottom, 30)
            }
        }
        .transition(.opacity)
        .zIndex(40)
    }

    private var overflowMenu: some View {
        VStack(spacing: 0) {
            overflowRow(icon: "plus", label: "Add to album", hint: "A", isHighlighted: true)
            overflowRow(icon: "sparkles", label: "Add to memory", hint: nil, newTag: true)
            overflowRow(icon: "magnifyingglass", label: "Find similar", hint: "S")
            overflowRow(icon: "person.badge.plus", label: "Tag a person", hint: "T")
            overflowRow(icon: "arrow.up.right.square", label: "Open in Flickr", hint: "\u{2197}") {
                if let flickr = currentItem.flickrURL, let url = URL(string: flickr) {
                    UIApplication.shared.open(url)
                    withAnimation { activeSheet = nil }
                }
            }

            dividerLine

            overflowRow(icon: "rectangle.portrait", label: "Set as cover", hint: nil, adminTag: true)
            overflowRow(icon: "eye.slash", label: "Hide from household", hint: nil, adminTag: true)

            dividerLine

            overflowRow(icon: "trash", label: "Delete photo", hint: "\u{232b}", isDanger: true)
        }
        .padding(6)
        .frame(width: 240)
        .background(Color(red: 26/255, green: 20/255, blue: 17/255).opacity(0.94))
        .background(.ultraThinMaterial.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.5), radius: 24, x: 0, y: 24)
        .transition(.scale(scale: 0.9, anchor: .topTrailing).combined(with: .opacity))
    }

    private func overflowRow(
        icon: String, label: String, hint: String?,
        isHighlighted: Bool = false, newTag: Bool = false,
        adminTag: Bool = false, isDanger: Bool = false,
        action: (() -> Void)? = nil
    ) -> some View {
        Button {
            action?()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(isDanger ? Color(hex: 0x9A3416) : .white.opacity(0.85))
                    .frame(width: 14)

                Text(label)
                    .font(.body(13, weight: isDanger ? .semibold : .medium))
                    .foregroundStyle(isDanger ? Color(hex: 0x9A3416) : .white.opacity(0.95))

                Spacer()

                if newTag {
                    Text("NEW")
                        .font(.mono(8, weight: .semibold))
                        .tracking(1.2)
                        .foregroundStyle(KindredTheme.ash)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(KindredTheme.gold)
                        .clipShape(Capsule())
                }

                if adminTag {
                    Text("ADMIN")
                        .font(.mono(8, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(Color(hex: 0xE88A5C))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(KindredTheme.ember.opacity(0.22))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }

                if let hint, !newTag, !adminTag {
                    Text(hint)
                        .font(.mono(9))
                        .tracking(1)
                        .foregroundStyle(.white.opacity(0.4))
                }
            }
            .padding(.vertical, 9)
            .padding(.horizontal, 10)
            .background(isHighlighted ? KindredTheme.ember.opacity(0.16) : .clear)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private var dividerLine: some View {
        Rectangle()
            .fill(KindredTheme.paper.opacity(0.08))
            .frame(height: 1)
            .padding(.horizontal, 6)
            .padding(.vertical, 6)
    }

    // MARK: - Helpers

    private var dateString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE \u{00b7} MMM d \u{00b7} h:mm a"
        return formatter.string(from: Date())
    }

    // MARK: - Image Loading

    private func loadImage() async {
        // Demo mode: no network loading needed — thumbnails are SwiftUI views
        if DemoDataProvider.shared.isActive {
            await MainActor.run { isLoading = false }
            return
        }
        guard let proxyURL else {
            await loadDirect()
            return
        }
        var request = URLRequest(url: proxyURL)
        if let token = SessionManager.shared.sessionToken {
            request.setValue(token, forHTTPHeaderField: "X-Session-Token")
        }
        request.timeoutInterval = 30
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                await loadDirect()
                return
            }
            await MainActor.run {
                self.imageData = data
                self.isLoading = false
            }
        } catch {
            await loadDirect()
        }
    }

    private func loadDirect() async {
        guard let url = URL(string: currentItem.photoURL) else {
            await MainActor.run { loadError = true; isLoading = false }
            return
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            await MainActor.run {
                self.imageData = data
                self.isLoading = false
            }
        } catch {
            await MainActor.run { loadError = true; isLoading = false }
        }
    }
}

// MARK: - Flow Layout (for tags)

struct FlowLayout: Layout {
    var spacing: CGFloat = 5

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, subview) in subviews.enumerated() {
            if index < result.positions.count {
                let position = result.positions[index]
                subview.place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
            }
        }
    }

    private struct ArrangeResult {
        var size: CGSize
        var positions: [CGPoint]
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> ArrangeResult {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var currentX: CGFloat = 0
        var currentY: CGFloat = 0
        var lineHeight: CGFloat = 0
        var maxX: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if currentX + size.width > maxWidth && currentX > 0 {
                currentX = 0
                currentY += lineHeight + spacing
                lineHeight = 0
            }
            positions.append(CGPoint(x: currentX, y: currentY))
            lineHeight = max(lineHeight, size.height)
            currentX += size.width + spacing
            maxX = max(maxX, currentX)
        }

        return ArrangeResult(
            size: CGSize(width: maxX, height: currentY + lineHeight),
            positions: positions
        )
    }
}

// MARK: - Share Sheet

struct ShareSheetView: View {
    let item: PhotoGridItem
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            // Drag handle
            RoundedRectangle(cornerRadius: KindredTheme.radiusPill)
                .fill(Color(hex: 0x4A281A).opacity(0.22))
                .frame(width: 38, height: 5)
                .padding(.top, 10)
                .padding(.bottom, 12)

            // Photo summary chip
            HStack(spacing: 12) {
                Group {
                    let thumbOrPhoto = item.thumbURL ?? item.photoURL
                    if DemoDataProvider.isDemoURL(thumbOrPhoto) {
                        DemoThumbnailView(urlString: thumbOrPhoto, cornerRadius: 6)
                    } else {
                        AsyncImage(url: URL(string: thumbOrPhoto)) { phase in
                            if case .success(let image) = phase {
                                image.resizable().scaledToFill()
                            } else {
                                KindredTheme.canvas
                            }
                        }
                    }
                }
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 6))

                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title ?? "1 photo selected")
                        .font(.kindredCardTitle)
                        .foregroundStyle(KindredTheme.ash)
                        .lineLimit(1)
                    Text("1 PHOTO \u{00b7} JPEG")
                        .font(.mono(9))
                        .tracking(1)
                        .foregroundStyle(KindredTheme.mist)
                }
                Spacer()
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 14)

            Rectangle()
                .fill(KindredTheme.line)
                .frame(height: 1)

            // Inside Kindred
            KindredEyebrow(text: "Inside Kindred")
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 22)
                .padding(.top, 14)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(["Rosa", "Theo", "Iris", "Mom", "Dad"], id: \.self) { name in
                        VStack(spacing: 5) {
                            Circle()
                                .fill(KindredTheme.avatarGradient)
                                .frame(width: 54, height: 54)
                                .overlay(
                                    Image(systemName: "person.fill")
                                        .font(.system(size: 20))
                                        .foregroundStyle(.white.opacity(0.8))
                                )
                                .overlay(Circle().stroke(.white, lineWidth: 2))
                                .shadow(color: KindredTheme.cardShadowHeavy, radius: 5, x: 0, y: 4)

                            Text(name)
                                .font(.display(11, weight: .bold))
                                .foregroundStyle(KindredTheme.ash)
                        }
                        .frame(width: 60)
                    }

                    // Whole household chip
                    VStack(spacing: 5) {
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [KindredTheme.ember, KindredTheme.gold],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 54, height: 54)
                            .overlay(
                                Text("All")
                                    .font(.display(14, weight: .bold))
                                    .foregroundStyle(.white)
                            )
                            .overlay(Circle().stroke(.white, lineWidth: 2))
                            .shadow(color: KindredTheme.cardShadowHeavy, radius: 5, x: 0, y: 4)

                        Text("Whole\nhousehold")
                            .font(.display(11, weight: .bold))
                            .foregroundStyle(KindredTheme.ash)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                    }
                    .frame(width: 60)
                }
                .padding(.horizontal, 22)
                .padding(.top, 10)
            }

            // Private link
            KindredEyebrow(text: "Link", color: KindredTheme.pine)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 22)
                .padding(.top, 18)

            HStack(spacing: 10) {
                Image(systemName: "link")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(KindredTheme.ash)
                    .frame(width: 32, height: 32)
                    .background(KindredTheme.ash.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 1) {
                    Text("Copy private link")
                        .font(.display(13, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                    Text("EXPIRES IN 7 DAYS \u{00b7} HOUSEHOLD ONLY")
                        .font(.mono(9))
                        .tracking(0.8)
                        .foregroundStyle(KindredTheme.mist)
                }
                Spacer()
                Text("COPY")
                    .font(.display(11, weight: .bold))
                    .tracking(0.6)
                    .foregroundStyle(KindredTheme.ember)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(KindredTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(KindredTheme.lineDark, lineWidth: 1)
            )
            .padding(.horizontal, 22)
            .padding(.top, 8)

            // Apps row
            KindredEyebrow(text: "Apps", color: KindredTheme.pine)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 22)
                .padding(.top, 18)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    shareTarget(name: "Messages", color: Color(hex: 0x4CD964), glyph: "message.fill")
                    shareTarget(name: "Mail", color: Color(hex: 0x1E90FF), glyph: "envelope.fill")
                    shareTarget(name: "Save", color: KindredTheme.gold, glyph: "arrow.down.circle.fill")
                    shareTarget(name: "AirDrop", color: Color(hex: 0x5856D6), glyph: "radiowaves.left")
                    shareTarget(name: "More", color: KindredTheme.mist, glyph: "ellipsis")
                }
                .padding(.horizontal, 22)
                .padding(.top, 10)
            }

            Spacer()

            // Cancel
            Button { dismiss() } label: {
                Text("Cancel")
                    .font(.body(14, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .background(KindredTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(KindredTheme.lineDark, lineWidth: 1)
                    )
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 14)
        }
        .background(KindredTheme.paper)
        .presentationDetents([.large])
        .presentationDragIndicator(.hidden)
    }

    private func shareTarget(name: String, color: Color, glyph: String) -> some View {
        Button {
            if let url = URL(string: item.flickrURL ?? item.photoURL) {
                let activityVC = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let rootVC = windowScene.windows.first?.rootViewController {
                    rootVC.present(activityVC, animated: true)
                }
            }
        } label: {
            VStack(spacing: 5) {
                Image(systemName: glyph)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 50, height: 50)
                    .background(color)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .shadow(color: color.opacity(0.3), radius: 6, x: 0, y: 6)

                Text(name)
                    .font(.display(10, weight: .bold))
                    .foregroundStyle(KindredTheme.ash)
            }
        }
    }
}

// MARK: - Memory View (Stories-style player)

struct MemoryView: View {
    let photos: [PhotoGridItem]
    let title: String
    let subtitle: String
    var onOpenAll: ((_ firstPhoto: PhotoGridItem) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss

    @State private var currentSegment = 0
    @State private var elapsed: CGFloat = 0
    @State private var isPaused = false
    @State private var isMuted = false
    @State private var isHearted = false
    @State private var dragOffset: CGFloat = 0
    @State private var chromeOpacity: Double = 1.0
    @State private var showShareSheet = false

    private let slideInterval: CGFloat = 3.5 // 3.5s per slide
    private let timerInterval: TimeInterval = 0.05 // 50ms tick

    private var totalSegments: Int {
        max(photos.count, 1)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            // Background photo with crossfade
            photoBackground

            // Gradient overlay
            LinearGradient(
                colors: [
                    Color.black.opacity(0.4),
                    Color.clear,
                    Color.clear,
                    Color(red: 20/255, green: 16/255, blue: 14/255).opacity(0.92),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            // Chrome (progress + toolbar + narrative)
            VStack(spacing: 0) {
                // Progress segments
                progressBar
                    .padding(.horizontal, 14)
                    .padding(.top, 8)

                // Toolbar: close / counter / mute
                toolbar
                    .padding(.horizontal, 18)
                    .padding(.top, 12)

                Spacer()

                // Bottom narrative
                narrativeBlock
                    .padding(.horizontal, 24)
                    .padding(.bottom, 16)
                    .safeAreaInset(edge: .bottom) {
                        Color.clear.frame(height: 0)
                    }
            }
            .opacity(chromeOpacity)

            // Tap zones (invisible) — start below toolbar area so buttons work
            VStack(spacing: 0) {
                Color.clear.frame(height: 100) // Reserve space for toolbar — not tappable
                    .allowsHitTesting(false)

                HStack(spacing: 0) {
                    // Left 33% - previous
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture {
                            goToPrevious()
                        }
                        .frame(maxWidth: .infinity)

                    // Center 34% - no action (just absorb)
                    Color.clear
                        .contentShape(Rectangle())
                        .frame(maxWidth: .infinity)

                    // Right 33% - next
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture {
                            goToNext()
                        }
                        .frame(maxWidth: .infinity)
                }
            }
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.3)
                    .onChanged { _ in
                        // Starting press
                    }
                    .sequenced(before: DragGesture(minimumDistance: 0))
                    .onChanged { value in
                        switch value {
                        case .second(true, _):
                            if !isPaused {
                                isPaused = true
                                withAnimation(.easeOut(duration: 0.2)) {
                                    chromeOpacity = 0
                                }
                            }
                        default:
                            break
                        }
                    }
            )
            .simultaneousGesture(
                DragGesture()
                    .onChanged { value in
                        dragOffset = value.translation.height
                    }
                    .onEnded { value in
                        if value.translation.height > 100 {
                            dismiss()
                        } else {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                dragOffset = 0
                            }
                        }
                    }
            )
        }
        .offset(y: max(0, dragOffset))
        .preferredColorScheme(.dark)
        .onReceive(
            Timer.publish(every: timerInterval, on: .main, in: .common).autoconnect()
        ) { _ in
            guard !isPaused else { return }
            elapsed += CGFloat(timerInterval)
            if elapsed >= slideInterval {
                goToNext()
            }
        }
        .onChange(of: isPaused) { _, newValue in
            if !newValue {
                withAnimation(.easeIn(duration: 0.2)) {
                    chromeOpacity = 1
                }
            }
        }
        // Detect touch end for long press release
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onEnded { _ in
                    if isPaused {
                        isPaused = false
                    }
                }
        )
        .sheet(isPresented: $showShareSheet) {
            MemoryShareSheet(title: title, subtitle: subtitle, photoURL: photos.first?.photoURL)
        }
    }

    // MARK: - Photo Background

    private var photoBackground: some View {
        GeometryReader { geo in
            ZStack {
                ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                    Group {
                        if DemoDataProvider.isDemoURL(photo.photoURL) {
                            DemoThumbnailView(urlString: photo.photoURL, cornerRadius: 0)
                                .frame(width: geo.size.width, height: geo.size.height)
                        } else {
                            AsyncImage(url: URL(string: photo.photoURL)) { phase in
                                switch phase {
                                case .success(let image):
                                    image
                                        .resizable()
                                        .scaledToFill()
                                        .frame(width: geo.size.width, height: geo.size.height)
                                        .clipped()
                                default:
                                    Color.black
                                }
                            }
                        }
                    }
                    .opacity(index == currentSegment ? 1 : 0)
                    .animation(.easeInOut(duration: 0.6), value: currentSegment)
                }
            }
        }
        .ignoresSafeArea()
    }

    // MARK: - Progress Bar

    private var progressBar: some View {
        HStack(spacing: 3) {
            ForEach(0..<totalSegments, id: \.self) { i in
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        // Background
                        RoundedRectangle(cornerRadius: 2)
                            .fill(.white.opacity(0.3))

                        // Fill
                        if i < currentSegment {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(.white)
                        } else if i == currentSegment {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(.white)
                                .frame(width: geo.size.width * min(1, elapsed / slideInterval))
                        }
                    }
                }
                .frame(height: 2)
            }
        }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack {
            // Close
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(Color(red: 20/255, green: 16/255, blue: 14/255).opacity(0.4))
                    .background(.ultraThinMaterial.opacity(0.3))
                    .clipShape(Circle())
            }

            Spacer()

            // Counter
            Text("\(currentSegment + 1) / \(totalSegments)")
                .font(.mono(10))
                .tracking(1.6)
                .foregroundStyle(.white.opacity(0.85))

            Spacer()

            // Mute
            Button {
                isMuted.toggle()
            } label: {
                Image(systemName: isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(Color(red: 20/255, green: 16/255, blue: 14/255).opacity(0.4))
                    .background(.ultraThinMaterial.opacity(0.3))
                    .clipShape(Circle())
            }
        }
    }

    // MARK: - Narrative Block

    private var narrativeBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            // On this day chip
            HStack(spacing: 6) {
                Circle()
                    .fill(KindredTheme.gold)
                    .frame(width: 6, height: 6)
                Text("ON THIS DAY \u{00b7} 4 YEARS AGO")
                    .font(.mono(9, weight: .semibold))
                    .tracking(1.6)
                    .foregroundStyle(KindredTheme.gold)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(KindredTheme.gold.opacity(0.22))
            .overlay(
                Capsule()
                    .stroke(KindredTheme.gold.opacity(0.4), lineWidth: 1)
            )
            .clipShape(Capsule())
            .padding(.bottom, 14)

            // Title
            Text(title)
                .font(.display(26, weight: .bold))
                .foregroundStyle(KindredTheme.paper)
                .lineSpacing(-2)
                .tracking(-0.13)

            // Subtitle
            Text(subtitle)
                .font(.kindredCaption)
                .foregroundStyle(KindredTheme.paper.opacity(0.7))
                .lineSpacing(2)
                .padding(.top, 12)

            // Actions
            HStack(spacing: 8) {
                Button {
                    if let first = photos.first {
                        dismiss()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            onOpenAll?(first)
                        }
                    }
                } label: {
                    Text("Open all")
                        .font(.body(13, weight: .bold))
                        .foregroundStyle(KindredTheme.ash)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(KindredTheme.paper)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }

                Button {
                    showShareSheet = true
                } label: {
                    Text("Share memory")
                        .font(.body(13, weight: .bold))
                        .foregroundStyle(KindredTheme.paper)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(KindredTheme.paper.opacity(0.12))
                        .background(.ultraThinMaterial.opacity(0.3))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }

                Button {
                    isHearted.toggle()
                } label: {
                    Image(systemName: isHearted ? "heart.fill" : "heart")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(isHearted ? KindredTheme.ember : KindredTheme.paper)
                        .frame(width: 44, height: 44)
                        .background(KindredTheme.paper.opacity(0.12))
                        .background(.ultraThinMaterial.opacity(0.3))
                        .clipShape(Circle())
                }
            }
            .padding(.top, 16)
        }
    }

    // MARK: - Navigation

    private func goToNext() {
        withAnimation(.easeOut(duration: 0.24)) {
            if currentSegment < totalSegments - 1 {
                currentSegment += 1
            } else {
                // End of memory — dismiss or loop
                dismiss()
            }
            elapsed = 0
        }
    }

    private func goToPrevious() {
        withAnimation(.easeOut(duration: 0.24)) {
            if currentSegment > 0 {
                currentSegment -= 1
            }
            elapsed = 0
        }
    }
}

// MARK: - Memory Share Sheet (UIActivityViewController wrapper)

struct MemoryShareSheet: UIViewControllerRepresentable {
    let title: String
    let subtitle: String
    let photoURL: String?

    func makeUIViewController(context: Context) -> UIActivityViewController {
        var items: [Any] = ["\(title)\n\(subtitle)"]
        if let urlStr = photoURL, let url = URL(string: urlStr) {
            items.append(url)
        }
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        return controller
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
