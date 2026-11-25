import SwiftUI

// MARK: - Span plan

/// How many columns and rows a tile occupies.
struct MosaicSpan: Equatable, Sendable {
    let columns: Int
    let rows: Int

    static let single = MosaicSpan(columns: 1, rows: 1)
    static let hero = MosaicSpan(columns: 2, rows: 2)
    static let wide = MosaicSpan(columns: 2, rows: 1)

    /// The rhythm the prototype uses: a 2x2 hero opening each block of nine,
    /// a 2x1 near its end, singles between. Deterministic, so a tile does not
    /// change size when the page around it grows.
    static func plan(index: Int, columns: Int) -> MosaicSpan {
        guard columns >= 3 else { return .single }
        switch index % 9 {
        case 0: return .hero
        case 7: return .wide
        default: return .single
        }
    }
}

/// Grid placement for one tile.
struct MosaicPlacement: Equatable, Sendable {
    let column: Int
    let row: Int
    let span: MosaicSpan
}

enum MosaicPacker {
    /// Greedy row-major packing: each tile takes the first cell where its span
    /// fits. Spans that never fit (a hero in a two-column grid) are demoted to
    /// a single rather than being dropped.
    static func pack(count: Int, columns: Int) -> (placements: [MosaicPlacement], rows: Int) {
        guard columns > 0, count > 0 else { return ([], 0) }
        var occupied: Set<Int> = []          // row * columns + column
        var placements: [MosaicPlacement] = []
        var lastRow = 0

        func fits(_ span: MosaicSpan, column: Int, row: Int) -> Bool {
            guard column + span.columns <= columns else { return false }
            for r in row..<(row + span.rows) {
                for c in column..<(column + span.columns) {
                    if occupied.contains(r * columns + c) { return false }
                }
            }
            return true
        }

        var searchRow = 0
        for index in 0..<count {
            var span = MosaicSpan.plan(index: index, columns: columns)
            if span.columns > columns { span = .single }

            var placed: MosaicPlacement?
            var row = searchRow
            // Bounded: a row can always hold at least one single, so the scan
            // advances at most one row per failed sweep.
            while placed == nil {
                for column in 0..<columns where fits(span, column: column, row: row) {
                    placed = MosaicPlacement(column: column, row: row, span: span)
                    break
                }
                if placed == nil { row += 1 }
            }
            guard let placement = placed else { continue }

            for r in placement.row..<(placement.row + placement.span.rows) {
                for c in placement.column..<(placement.column + placement.span.columns) {
                    occupied.insert(r * columns + c)
                }
            }
            lastRow = max(lastRow, placement.row + placement.span.rows)
            placements.append(placement)

            // Rows fully covered will never take another tile, so the next
            // search starts past them.
            while (0..<columns).allSatisfy({ occupied.contains(searchRow * columns + $0) }) {
                searchRow += 1
            }
        }
        return (placements, lastRow)
    }
}

// MARK: - Layout

/// Fixed-row-height mosaic. Tiles are 2–4px apart so the photos read as one
/// field, which is the brand's rule and why this is not a plain LazyVGrid.
struct MosaicLayout: Layout {
    let columns: Int
    let rowHeight: CGFloat
    let spacing: CGFloat

    struct Cache {
        var placements: [MosaicPlacement]
        var rows: Int
    }

    func makeCache(subviews: Subviews) -> Cache {
        let packed = MosaicPacker.pack(count: subviews.count, columns: columns)
        return Cache(placements: packed.placements, rows: packed.rows)
    }

    func updateCache(_ cache: inout Cache, subviews: Subviews) {
        cache = makeCache(subviews: subviews)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) -> CGSize {
        let width = proposal.width ?? 0
        let height = CGFloat(cache.rows) * rowHeight
            + CGFloat(max(0, cache.rows - 1)) * spacing
        return CGSize(width: width, height: height)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout Cache
    ) {
        guard columns > 0 else { return }
        let totalSpacing = spacing * CGFloat(columns - 1)
        let columnWidth = max(0, (bounds.width - totalSpacing) / CGFloat(columns))

        for (index, subview) in subviews.enumerated() {
            guard index < cache.placements.count else { break }
            let placement = cache.placements[index]
            let width = columnWidth * CGFloat(placement.span.columns)
                + spacing * CGFloat(placement.span.columns - 1)
            let height = rowHeight * CGFloat(placement.span.rows)
                + spacing * CGFloat(placement.span.rows - 1)
            let x = bounds.minX + CGFloat(placement.column) * (columnWidth + spacing)
            let y = bounds.minY + CGFloat(placement.row) * (rowHeight + spacing)
            subview.place(
                at: CGPoint(x: x, y: y),
                proposal: ProposedViewSize(width: width, height: height)
            )
        }
    }
}

// MARK: - Selection sweep

/// Tile frames reported in a named coordinate space, so a drag can decide
/// which tiles it has crossed.
struct TileFrameKey: PreferenceKey {
    static let defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue()) { _, new in new }
    }
}

extension View {
    /// Publishes this tile's frame for the sweep gesture.
    func reportsTileFrame(id: String, in space: CoordinateSpace) -> some View {
        background(
            GeometryReader { geo in
                Color.clear.preference(key: TileFrameKey.self, value: [id: geo.frame(in: space)])
            }
        )
    }
}

// MARK: - Grid

/// A day's tiles laid out as a mosaic, with tap, long-press and sweep.
///
/// Interactions follow IOS.md: tap opens the viewer, long-press enters select
/// mode, and press-and-drag sweeps a selection once select mode is on.
struct MosaicGrid: View {
    let photos: [LibraryPhoto]
    var columns: Int = 3
    var rowHeight: CGFloat = 116
    var spacing: CGFloat = KindredTheme.tileGap
    var isSelecting: Bool = false
    var selection: Set<String> = []
    var matchPercent: (LibraryPhoto) -> Int? = { _ in nil }
    var squareTileRadius: CGFloat? = nil
    var journalWidth: CGFloat? = nil
    var dateLabel: (LibraryPhoto) -> String? = { _ in nil }
    var onSelectDate: ((LibraryPhoto) -> Void)? = nil
    var onTap: (LibraryPhoto) -> Void
    var onLongPress: (LibraryPhoto) -> Void = { _ in }
    var onSweep: (Set<String>) -> Void = { _ in }

    private let space = "kindred.mosaic"
    @State private var frames: [String: CGRect] = [:]
    @State private var imageRatios: [String: CGFloat] = [:]
    @State private var sweepStart: CGPoint?
    @State private var sweptIDs: Set<String> = []

    var body: some View {
        Group {
            if let journalWidth {
                journalRows(width: journalWidth)
            } else if squareTileRadius != nil {
                let tracks = Array(repeating: GridItem(.flexible(), spacing: spacing), count: columns)
                LazyVGrid(columns: tracks, spacing: spacing) { tiles }
            } else {
                MosaicLayout(columns: columns, rowHeight: rowHeight, spacing: spacing) { tiles }
            }
        }
        .coordinateSpace(name: space)
        .onPreferenceChange(TileFrameKey.self) { frames = $0 }
        .simultaneousGesture(sweepGesture, isEnabled: isSelecting)
    }

    private var tiles: some View {
        ForEach(photos) { tile($0) }
    }

    private func journalRows(width: CGFloat) -> some View {
        let available = max(1, width)
        let preferredCount = available < 660 ? 2 : 3
        let fullRows = max(1, Int((Double(photos.count) / Double(preferredCount)).rounded()))
        let photosPerRow = photos.count / fullRows
        let extraPhotos = photos.count % fullRows
        let maximumHeight = min(250, available / (available < 660 ? 2.8 : 4.35))

        return LazyVStack(alignment: .leading, spacing: spacing) {
            ForEach(0..<fullRows, id: \.self) { row in
                let start = row * photosPerRow + min(row, extraPhotos)
                let end = start + photosPerRow + (row < extraPhotos ? 1 : 0)
                let items = photos[start..<end]
                let ratios = items.map { imageRatios[$0.id] ?? 1.5 }
                let gaps = CGFloat(max(0, ratios.count - 1)) * spacing
                let usableWidth = max(1, available - gaps)
                let totalRatio = max(1, ratios.reduce(0, +))
                let fittedHeight = usableWidth / totalRatio
                let height = min(maximumHeight * 1.15, fittedHeight)
                let fillsRow = items.count >= preferredCount
                // A row of similarly shaped photos still gets a featured tile when
                // the height cap already requires cropping to fill the canvas.
                let similarShapes = (ratios.max() ?? 0) - (ratios.min() ?? 0) < 0.28
                let emphasizesOnePhoto = available >= 660 && fillsRow && similarShapes && height < fittedHeight
                let weights = ratios.enumerated().map { index, ratio in
                    emphasizesOnePhoto && index == row % ratios.count ? ratio * 1.38 : ratio
                }
                let widthPerUnit = fillsRow ? usableWidth / max(1, weights.reduce(0, +)) : height
                HStack(spacing: spacing) {
                    ForEach(items) { photo in
                        if let index = items.firstIndex(where: { $0.id == photo.id }) {
                            tile(photo, journalSize: CGSize(
                                width: widthPerUnit * weights[index - items.startIndex], height: height
                            ))
                        }
                    }
                }
            }
        }
        .frame(width: available, alignment: .leading)
    }

    private func tile(_ photo: LibraryPhoto, journalSize: CGSize? = nil) -> some View {
        let isSelected = selection.contains(photo.id)
        return Group {
            if let journalSize {
                PhotoTile(photo: photo, isSelected: isSelected, isSelecting: isSelecting,
                          cornerRadius: 8, onAspectRatio: { ratio in
                    let clamped = min(2.8, max(0.55, ratio))
                    if imageRatios[photo.id] == nil { imageRatios[photo.id] = clamped }
                })
                .frame(width: journalSize.width, height: journalSize.height)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(KindredThumbnail.accessibilityText(for: photo))
                .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
                .accessibilityValue(isSelecting ? (isSelected ? "Selected" : "Not selected") : "")
                .accessibilityIdentifier("library.journal.\(photo.id)")
            } else if let squareTileRadius {
                SquarePhotoTile(photo: photo, isSelected: isSelected, isSelecting: isSelecting,
                                matchPercent: matchPercent(photo), cornerRadius: squareTileRadius)
            } else {
                PhotoTile(photo: photo, isSelected: isSelected, isSelecting: isSelecting,
                          matchPercent: matchPercent(photo))
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if let label = dateLabel(photo) {
                if let onSelectDate {
                    Button {
                        onSelectDate(photo)
                    } label: {
                        KindredPhotoBadge(text: label)
                            .frame(minWidth: 44, minHeight: 44, alignment: .bottomTrailing)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Select photos from \(label)")
                    .padding(7)
                } else {
                    KindredPhotoBadge(text: label)
                        .padding(7)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
        }
        .onTapGesture { onTap(photo) }
        .onLongPressGesture(minimumDuration: 0.35) { onLongPress(photo) }
        .accessibilityAction { onTap(photo) }
        .reportsTileFrame(id: photo.id, in: .named(space))
    }

    /// Press and drag across tiles to sweep. Only armed in select mode, so an
    /// ordinary scroll is never stolen from the list.
    private var sweepGesture: some Gesture {
        DragGesture(minimumDistance: 12, coordinateSpace: .named(space))
            .onChanged { value in
                if sweepStart == nil {
                    sweepStart = value.startLocation
                    sweptIDs = []
                }
                guard let start = sweepStart else { return }
                let rect = CGRect(
                    x: min(start.x, value.location.x),
                    y: min(start.y, value.location.y),
                    width: abs(value.location.x - start.x),
                    height: abs(value.location.y - start.y)
                )
                let hit = Set(frames.filter { $0.value.intersects(rect) }.keys)
                if hit != sweptIDs {
                    sweptIDs = hit
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    onSweep(hit)
                }
            }
            .onEnded { _ in
                sweepStart = nil
                sweptIDs = []
            }
    }
}
