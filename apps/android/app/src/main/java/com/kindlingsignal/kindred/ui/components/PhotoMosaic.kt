package com.kindlingsignal.kindred.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme

/**
 * One tile in the mosaic. Kept transport-agnostic so the same tile serves the
 * library gallery, search results, a person's recent grid and the filmstrip.
 */
data class MosaicTile(
    val id: String,
    val imageUrl: String?,
    /** Announced by TalkBack; the title, or a date, never "image". */
    val label: String,
    val isVideo: Boolean = false,
    val durationLabel: String? = null,
)

/**
 * Tile geometry, recorded as tiles are laid out so a sweep can tell which tile
 * the finger is currently over. Positions are in root coordinates, which is
 * the frame `detectDragGesturesAfterLongPress` reports against once the
 * container's own root offset is subtracted.
 */
class MosaicBounds {
    private val rects = LinkedHashMap<String, Rect>()
    internal var containerOrigin: Offset = Offset.Zero

    fun record(id: String, rect: Rect) {
        rects[id] = rect
    }

    /**
     * Drop a tile that has scrolled out of the list.
     *
     * Without this a recycled row leaves its last on-screen rectangle behind,
     * and a sweep over that patch of screen would select whatever used to be
     * there rather than what is there now.
     */
    fun forget(id: String) {
        rects.remove(id)
    }

    /** The tile under a point expressed in the container's local coordinates. */
    fun idAt(local: Offset): String? {
        val root = local + containerOrigin
        return rects.entries.firstOrNull { it.value.contains(root) }?.key
    }
}

@Composable
fun rememberMosaicBounds(): MosaicBounds = remember { MosaicBounds() }

/**
 * Long-press to start selecting, then drag across tiles to sweep — the
 * interaction `ANDROID.md` describes. Attach to the scrolling container that
 * holds the mosaic, not to individual tiles: a per-tile gesture cannot follow
 * a finger past its own edge.
 *
 * [onSweep] is called once per tile the finger newly enters, so the caller can
 * fire a haptic tick per selection rather than per pixel of travel.
 */
fun Modifier.mosaicSweep(
    bounds: MosaicBounds,
    enabled: Boolean,
    onSweepStart: (String) -> Unit,
    onSweep: (String) -> Unit,
): Modifier = this
    .onGloballyPositioned { bounds.containerOrigin = it.positionInRoot() }
    .then(
        if (!enabled) Modifier else Modifier.pointerInput(bounds) {
            var last: String? = null
            detectDragGesturesAfterLongPress(
                onDragStart = { offset ->
                    last = bounds.idAt(offset)
                    last?.let(onSweepStart)
                },
                onDragEnd = { last = null },
                onDragCancel = { last = null },
                onDrag = { change, _ ->
                    val id = bounds.idAt(change.position)
                    if (id != null && id != last) {
                        last = id
                        onSweep(id)
                    }
                },
            )
        }
    )

/**
 * A single photo tile: 4dp radius, video badge, and the handoff's selection
 * treatment — a 3dp terracotta outline inset by 3dp, the photo at 78% opacity,
 * and a filled check. Unselected tiles in selection mode show the empty circle.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun PhotoTile(
    tile: MosaicTile,
    modifier: Modifier = Modifier,
    selectionActive: Boolean = false,
    selected: Boolean = false,
    bounds: MosaicBounds? = null,
    onClick: () -> Unit = {},
    onLongClick: (() -> Unit)? = null,
) {
    val colors = KindredTheme.colors
    val stateSuffix = when {
        !selectionActive -> ""
        selected -> ", selected"
        else -> ", not selected"
    }

    if (bounds != null) {
        DisposableEffect(bounds, tile.id) {
            onDispose { bounds.forget(tile.id) }
        }
    }

    Box(
        modifier = modifier
            .clip(KindredShape.Tile)
            .then(
                if (bounds == null) Modifier else Modifier.onGloballyPositioned { coords ->
                    val origin = coords.positionInRoot()
                    bounds.record(
                        tile.id,
                        Rect(origin, androidx.compose.ui.geometry.Size(
                            coords.size.width.toFloat(),
                            coords.size.height.toFloat(),
                        )),
                    )
                }
            )
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick,
            )
            .semantics {
                contentDescription = tile.label + stateSuffix
                if (selectionActive) this.selected = selected
            },
    ) {
        KindredImage(
            url = tile.imageUrl,
            contentDescription = null,
            modifier = Modifier
                .fillMaxSize()
                .alpha(if (selected) 0.78f else 1f),
        )

        if (selected) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(3.dp)
                    .border(3.dp, colors.terracotta, KindredShape.Tile),
            )
        }

        if (tile.isVideo && !selectionActive) {
            VideoTileBadge(tile.durationLabel, Modifier.align(Alignment.BottomEnd))
        }

        if (selectionActive) {
            SelectionMark(selected = selected, modifier = Modifier.align(Alignment.TopStart))
        }
    }
}

@Composable
private fun BoxScope.SelectionMark(selected: Boolean, modifier: Modifier = Modifier) {
    val colors = KindredTheme.colors
    Box(
        modifier = modifier
            .padding(6.dp)
            .size(20.dp)
            .clip(CircleShape)
            .then(
                if (selected) Modifier.background(colors.terracotta)
                else Modifier.border(2.dp, colors.inkPrimary.copy(alpha = 0.7f), CircleShape)
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = null,
                tint = colors.onAccentInk,
                modifier = Modifier.size(13.dp),
            )
        }
    }
}

@Composable
private fun BoxScope.VideoTileBadge(duration: String?, modifier: Modifier = Modifier) {
    val colors = KindredTheme.colors
    Row(
        modifier = modifier.padding(6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (duration != null) {
            KindredOnPhotoChip(duration)
        } else {
            Box(
                modifier = Modifier
                    .size(20.dp)
                    .clip(CircleShape)
                    .background(colors.onPhotoScrim),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Filled.PlayArrow,
                    contentDescription = null,
                    tint = colors.inkPrimary,
                    modifier = Modifier.size(12.dp),
                )
            }
        }
    }
}

/**
 * How the mosaic breaks a flat list into rows.
 *
 * The handoff's grid is a CSS auto-placed field with a 2×2 lead tile and an
 * occasional 2×1 wide tile. Compose has no vertical grid span, so the pattern
 * is expressed as explicit row shapes and repeats every cycle: a hero block,
 * two plain rows, then a wide row.
 */
private sealed interface MosaicRow {
    /** A 2-column × 2-row lead tile with small tiles stacked beside it. */
    data class Hero(val lead: MosaicTile, val side: List<MosaicTile>) : MosaicRow

    data class Plain(val tiles: List<MosaicTile>) : MosaicRow

    /** A 2-column wide tile followed by single-column tiles. */
    data class Wide(val wide: MosaicTile, val rest: List<MosaicTile>) : MosaicRow
}

private fun buildRows(tiles: List<MosaicTile>, columns: Int): List<MosaicRow> {
    val rows = mutableListOf<MosaicRow>()
    var i = 0
    var step = 0
    while (i < tiles.size) {
        when (step % 4) {
            0 -> {
                val sideCount = (columns - 2) * 2
                val lead = tiles[i]
                val side = tiles.drop(i + 1).take(sideCount)
                rows += MosaicRow.Hero(lead, side)
                i += 1 + side.size
            }

            3 -> {
                val wide = tiles[i]
                val rest = tiles.drop(i + 1).take(columns - 2)
                rows += MosaicRow.Wide(wide, rest)
                i += 1 + rest.size
            }

            else -> {
                val row = tiles.drop(i).take(columns)
                rows += MosaicRow.Plain(row)
                i += row.size
            }
        }
        step++
    }
    return rows
}

/**
 * The mosaic, emitted into a caller's `LazyColumn` so a screen can interleave
 * day headers, chips and section titles with it.
 *
 * @param keyPrefix keeps item keys unique when a screen shows more than one
 *   mosaic (a day per section, say).
 */
fun LazyListScope.photoMosaic(
    tiles: List<MosaicTile>,
    keyPrefix: String,
    rowHeight: Dp,
    columns: Int = 3,
    gap: Dp = 3.dp,
    selectionActive: Boolean = false,
    selectedIds: Set<String> = emptySet(),
    bounds: MosaicBounds? = null,
    onTileClick: (MosaicTile) -> Unit = {},
    onTileLongClick: ((MosaicTile) -> Unit)? = null,
) {
    val rows = buildRows(tiles, columns)

    rows.forEachIndexed { index, row ->
        item(key = "$keyPrefix-row-$index") {
            @Composable
            fun tile(t: MosaicTile, modifier: Modifier) = PhotoTile(
                tile = t,
                modifier = modifier,
                selectionActive = selectionActive,
                selected = t.id in selectedIds,
                bounds = bounds,
                onClick = { onTileClick(t) },
                onLongClick = onTileLongClick?.let { handler -> { handler(t) } },
            )

            when (row) {
                is MosaicRow.Hero -> {
                    val heroHeight = rowHeight * 2 + gap
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(heroHeight)
                            .padding(horizontal = gap),
                        horizontalArrangement = Arrangement.spacedBy(gap),
                    ) {
                        tile(row.lead, Modifier.weight(2f).fillMaxHeight())
                        // Remaining columns, filled top-to-bottom then across.
                        row.side.chunked(2).forEach { column ->
                            Column(
                                modifier = Modifier.weight(1f).fillMaxHeight(),
                                verticalArrangement = Arrangement.spacedBy(gap),
                            ) {
                                column.forEach { t ->
                                    tile(t, Modifier.fillMaxWidth().height(rowHeight))
                                }
                            }
                        }
                    }
                }

                is MosaicRow.Plain -> Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(rowHeight)
                        .padding(horizontal = gap),
                    horizontalArrangement = Arrangement.spacedBy(gap),
                ) {
                    row.tiles.forEach { t -> tile(t, Modifier.weight(1f).fillMaxHeight()) }
                    repeat(columns - row.tiles.size) { Box(Modifier.weight(1f)) }
                }

                is MosaicRow.Wide -> Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(rowHeight)
                        .padding(horizontal = gap),
                    horizontalArrangement = Arrangement.spacedBy(gap),
                ) {
                    tile(row.wide, Modifier.weight(2f).fillMaxHeight())
                    row.rest.forEach { t -> tile(t, Modifier.weight(1f).fillMaxHeight()) }
                    repeat(columns - 2 - row.rest.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
    }
}
