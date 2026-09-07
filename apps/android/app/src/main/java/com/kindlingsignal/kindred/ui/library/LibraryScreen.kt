package com.kindlingsignal.kindred.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.components.KindredDayHeader
import com.kindlingsignal.kindred.ui.components.KindredEmptyState
import com.kindlingsignal.kindred.ui.components.KindredFilterChip
import com.kindlingsignal.kindred.ui.components.KindredIconAction
import com.kindlingsignal.kindred.ui.components.KindredMenuIcon
import com.kindlingsignal.kindred.ui.components.KindredOverflowAction
import com.kindlingsignal.kindred.ui.components.KindredTopAppBar
import com.kindlingsignal.kindred.ui.components.MosaicTile
import com.kindlingsignal.kindred.ui.components.SelectionAppBar
import com.kindlingsignal.kindred.ui.components.SwappableAppBar
import com.kindlingsignal.kindred.ui.components.mosaicSweep
import com.kindlingsignal.kindred.ui.components.photoMosaic
import com.kindlingsignal.kindred.ui.components.rememberMosaicBounds
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Screens 2 and 3 — Library, and the select mode it turns into.
 *
 * The mosaic runs at 116dp rows with 2x2 and 2x1 spans. Long-pressing a tile
 * starts selection and swaps the top app bar for the contextual one; dragging
 * from there sweeps across tiles; long-pressing a day header takes the day.
 * Every selection change fires a haptic tick.
 *
 * The People, Animals and Videos chips push their own screens rather than
 * filtering in place: the handoff draws each as a full screen with its own back
 * chevron and title, so a chip that only filtered the mosaic would leave those
 * screens unreachable.
 */
@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun LibraryScreen(
    onMenuClick: () -> Unit,
    onOpenPeople: () -> Unit,
    onOpenAnimals: () -> Unit,
    onOpenVideos: () -> Unit,
    onSearchClick: () -> Unit,
    onPhotoClick: (List<MosaicTile>, Int) -> Unit,
    snackbarHostState: SnackbarHostState,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: LibraryViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val colors = KindredTheme.colors
    val haptics = LocalHapticFeedback.current
    val bounds = rememberMosaicBounds()
    val listState = rememberLazyListState()

    fun tick() = haptics.performHapticFeedback(HapticFeedbackType.LongPress)

    // Page as the mosaic nears its end rather than on a "load more" button —
    // keyset paging means the next page costs the same as the first.
    val nearEnd by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= listState.layoutInfo.totalItemsCount - 4
        }
    }
    LaunchedEffect(listState) {
        snapshotFlow { nearEnd }.collect { if (it) viewModel.loadMore() }
    }

    state.snackbar?.let { message ->
        LaunchedEffect(message) {
            snackbarHostState.showSnackbar(message)
            viewModel.dismissSnackbar()
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        PullToRefreshBox(
            isRefreshing = state.isRefreshing,
            onRefresh = viewModel::refresh,
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .mosaicSweep(
                        bounds = bounds,
                        enabled = true,
                        onSweepStart = { id ->
                            if (!state.selectionActive) viewModel.startSelection(id)
                            else viewModel.addToSelection(id)
                            tick()
                        },
                        onSweep = { id ->
                            viewModel.addToSelection(id)
                            tick()
                        },
                    ),
                contentPadding = contentPadding,
            ) {
                item("bar") {
                    SwappableAppBar(
                        selectionActive = state.selectionActive,
                        standard = {
                            KindredTopAppBar(
                                title = "Library",
                                navigationIcon = KindredMenuIcon,
                                navigationLabel = "Open navigation menu",
                                onNavigationClick = onMenuClick,
                            ) {
                                KindredIconAction(
                                    icon = Icons.Outlined.Search,
                                    contentDescription = "Search photos",
                                    onClick = onSearchClick,
                                )
                                KindredOverflowAction(onClick = { })
                            }
                        },
                        contextual = {
                            SelectionAppBar(
                                count = state.selectedCount,
                                onClose = viewModel::clearSelection,
                                onShare = viewModel::shareSelection,
                                onFavorite = viewModel::favoriteSelection,
                                onDelete = viewModel::deleteSelection,
                                onOverflow = { },
                            )
                        },
                    )
                }

                item("chips") {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 16.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        KindredFilterChip("All", selected = true, onClick = { })
                        KindredFilterChip("People", selected = false, onClick = onOpenPeople)
                        KindredFilterChip("Animals", selected = false, onClick = onOpenAnimals)
                        KindredFilterChip("Videos", selected = false, onClick = onOpenVideos)
                    }
                }

                item("chips-gap") { Spacer(Modifier.height(10.dp)) }

                if (state.days.isEmpty()) {
                    item("empty") {
                        KindredEmptyState(
                            title = if (state.isLoading) "Opening the library" else "Nothing in the library yet",
                            body = state.error
                                ?: "Photos land here once they are on your server.",
                        )
                    }
                }

                state.days.forEach { day ->
                    item("header-${day.key}") {
                        val fullySelected = state.selection != null &&
                            day.tiles.isNotEmpty() && day.tiles.all { it.id in state.selection!! }

                        KindredDayHeader(
                            title = day.title,
                            subtitle = null,
                            modifier = Modifier
                                .combinedClickable(
                                    onClick = { },
                                    onLongClick = {
                                        viewModel.selectDay(day.key)
                                        tick()
                                    },
                                )
                                .padding(horizontal = 16.dp, vertical = 8.dp),
                        ) {
                            if (fullySelected) {
                                Text(
                                    text = "All ${day.tiles.size} selected",
                                    style = KindredType.ButtonSmall,
                                    color = colors.onAccentInk,
                                    modifier = Modifier
                                        .clip(KindredShape.Chip)
                                        .background(colors.terracotta)
                                        .padding(horizontal = 12.dp, vertical = 7.dp),
                                )
                            } else {
                                Text(
                                    text = "SELECT ALL ${day.tiles.size}",
                                    style = KindredType.MetaSmall,
                                    color = colors.terracotta,
                                    modifier = Modifier
                                        .clip(KindredShape.Chip)
                                        .clickable(role = Role.Button) {
                                            viewModel.selectDay(day.key)
                                            tick()
                                        }
                                        .padding(horizontal = 8.dp, vertical = 6.dp)
                                        .semantics {
                                            contentDescription =
                                                "Select all ${day.tiles.size} photos from ${day.title}"
                                        },
                                )
                            }
                        }
                    }

                    photoMosaic(
                        tiles = day.tiles,
                        keyPrefix = "lib-${day.key}",
                        rowHeight = 116.dp,
                        selectionActive = state.selectionActive,
                        selectedIds = state.selection.orEmpty(),
                        bounds = bounds,
                        onTileClick = { tile ->
                            if (state.selectionActive) {
                                viewModel.toggle(tile.id)
                                tick()
                            } else {
                                val all = state.allTiles
                                onPhotoClick(all, all.indexOf(tile))
                            }
                        },
                        onTileLongClick = { tile ->
                            viewModel.startSelection(tile.id)
                            tick()
                        },
                    )

                    item("day-gap-${day.key}") { Spacer(Modifier.height(14.dp)) }
                }

                if (state.selectionActive) {
                    item("hint") {
                        Text(
                            text = "Long-press to start · drag across tiles to sweep · " +
                                "long-press the day header to take the whole day",
                            style = KindredType.MetaSmall,
                            color = colors.inkMeta,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                        )
                    }
                }

                item("tail") { Spacer(Modifier.height(120.dp)) }
            }
        }
    }
}
