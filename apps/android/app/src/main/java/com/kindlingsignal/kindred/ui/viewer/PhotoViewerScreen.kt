package com.kindlingsignal.kindred.ui.viewer

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.components.KindredBackIcon
import com.kindlingsignal.kindred.ui.components.KindredImage
import com.kindlingsignal.kindred.ui.components.KindredOverflowAction
import com.kindlingsignal.kindred.ui.components.KindredPersonChip
import com.kindlingsignal.kindred.ui.components.KindredTagChip
import com.kindlingsignal.kindred.ui.components.MosaicTile
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType
import kotlinx.coroutines.launch

/**
 * Screen 8 — Photo viewer.
 *
 * The stage is `#080908` rather than the app ground, so the photograph is the
 * brightest thing on screen. A pager carries the whole set the reader came
 * from; the filmstrip below tracks it, with the current frame at 46dp inside a
 * terracotta outline.
 *
 * Predictive back is inherited: the pager is a normal composable inside the
 * shell's back stack, and `BackHandler` here only cancels out of the viewer.
 */
@Composable
fun PhotoViewerScreen(
    tiles: List<MosaicTile>,
    initialIndex: Int,
    onBack: () -> Unit,
    snackbarHostState: SnackbarHostState,
    modifier: Modifier = Modifier,
    viewModel: PhotoViewerViewModel = hiltViewModel(),
) {
    if (tiles.isEmpty()) {
        LaunchedEffect(Unit) { onBack() }
        return
    }

    val colors = KindredTheme.colors
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val pagerState = rememberPagerState(
        initialPage = initialIndex.coerceIn(0, tiles.lastIndex),
        pageCount = { tiles.size },
    )
    val filmstripState = rememberLazyListState()

    BackHandler(onBack = onBack)

    LaunchedEffect(pagerState.currentPage) {
        val tile = tiles[pagerState.currentPage]
        viewModel.onPhotoShown(tile.id, tile.label)
        filmstripState.animateScrollToItem(pagerState.currentPage)
    }

    state.snackbar?.let { message ->
        LaunchedEffect(message) {
            snackbarHostState.showSnackbar(message)
            viewModel.dismissSnackbar()
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(colors.viewerStage),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = KindredBackIcon,
                    contentDescription = "Close the photo",
                    tint = colors.inkPrimary,
                    modifier = Modifier.size(21.dp),
                )
            }
            Column(modifier = Modifier.semantics(mergeDescendants = true) { }) {
                Text(
                    text = state.dateLabel,
                    style = KindredType.body(13, androidx.compose.ui.text.font.FontWeight.Bold),
                    color = colors.inkPrimary,
                )
                // The handoff pairs the time with a place. Nothing on the
                // backend reverse-geocodes the stored coordinates, and the
                // handoff forbids inventing a place, so only the time shows.
                // TODO: add the place once a reverse-geocoded name reaches
                // /photos/{id}/metadata.
                state.timeLabel?.let {
                    Text(text = it, style = KindredType.MetaSmall, color = colors.inkMeta)
                }
            }
            Spacer(Modifier.weight(1f))
            KindredOverflowAction(onClick = { })
        }

        HorizontalPager(
            state = pagerState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) { page ->
            val tile = tiles[page]
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                if (tile.isVideo) {
                    // Only the visible page gets a player: an ExoPlayer per
                    // page would hold a codec each and starve the device.
                    VideoStage(
                        url = viewModel.originalUrl(tile.id),
                        sessionToken = viewModel.sessionToken,
                        posterUrl = viewModel.previewUrl(tile.id) ?: tile.imageUrl,
                        label = tile.label,
                        active = page == pagerState.currentPage,
                    )
                } else {
                    KindredImage(
                        // The preview variant is what the stage wants: the
                        // original can be tens of megabytes and the difference
                        // is invisible at phone sizes.
                        url = viewModel.previewUrl(tile.id) ?: tile.imageUrl,
                        contentDescription = tile.label,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Fit,
                    )
                }
            }
        }

        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            if (state.people.isNotEmpty() || state.tags.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(bottom = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    state.people.forEach { person ->
                        KindredPersonChip(
                            name = person.name,
                            avatarUrl = person.avatarUrl,
                            filled = true,
                        )
                    }
                    state.tags.forEach { KindredTagChip(it) }
                }
            }

            val scope = rememberCoroutineScope()
            LazyRow(
                state = filmstripState,
                horizontalArrangement = Arrangement.spacedBy(3.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.height(46.dp),
            ) {
                itemsIndexed(tiles, key = { _, tile -> tile.id }) { index, tile ->
                    val current = index == pagerState.currentPage
                    KindredImage(
                        url = tile.imageUrl,
                        contentDescription = null,
                        modifier = Modifier
                            .size(if (current) 46.dp else 40.dp)
                            .clip(KindredShape.Tile)
                            .then(
                                if (current) Modifier.border(2.dp, colors.terracotta, KindredShape.Tile)
                                else Modifier.alpha(0.5f)
                            )
                            .clickable(role = Role.Button) {
                                scope.launch { pagerState.animateScrollToPage(index) }
                            }
                            .semantics {
                                contentDescription = tile.label +
                                    if (current) ", showing" else ""
                            },
                    )
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.chrome)
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(horizontal = 8.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceAround,
        ) {
            ViewerAction(Icons.Filled.Share, "Share", tint = colors.inkSecondary, onClick = viewModel::share)
            ViewerAction(
                icon = if (state.isFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                label = "Favorite",
                tint = if (state.isFavorite) colors.terracotta else colors.inkSecondary,
                onClick = viewModel::toggleFavorite,
                description = if (state.isFavorite) "Remove from favorites" else "Add to favorites",
            )
            ViewerAction(Icons.Filled.Info, "Info", tint = colors.inkSecondary, onClick = { })
            ViewerAction(Icons.Filled.Delete, "Delete", tint = colors.inkSecondary, onClick = viewModel::delete)
        }
    }
}

@Composable
private fun ViewerAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    tint: Color,
    onClick: () -> Unit,
    description: String = label,
) {
    Column(
        modifier = Modifier
            .clip(KindredShape.Chip)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .semantics(mergeDescendants = true) { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(21.dp),
        )
        Text(
            text = label,
            style = KindredType.body(11, androidx.compose.ui.text.font.FontWeight.SemiBold),
            color = tint,
        )
    }
}

/**
 * A video on the viewer stage.
 *
 * `/photos/{id}/local` answers byte ranges, so Media3 streams and scrubs rather
 * than downloading the file first. The session token rides in the same
 * `X-Session-Token` header the rest of the app uses, set as a default request
 * property on the data source.
 *
 * The player is released the moment the page leaves composition, and paused
 * whenever it is not the fronted page.
 */
@androidx.annotation.OptIn(UnstableApi::class)
@Composable
private fun VideoStage(
    url: String?,
    sessionToken: String?,
    posterUrl: String?,
    label: String,
    active: Boolean,
) {
    if (url == null) {
        KindredImage(
            url = posterUrl,
            contentDescription = label,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Fit,
        )
        return
    }

    val context = LocalContext.current
    val player = remember(url, sessionToken) {
        val httpFactory = DefaultHttpDataSource.Factory().apply {
            if (!sessionToken.isNullOrBlank()) {
                setDefaultRequestProperties(mapOf("X-Session-Token" to sessionToken))
            }
        }
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(httpFactory))
            .build()
            .apply {
                setMediaItem(MediaItem.fromUri(url))
                prepare()
            }
    }

    DisposableEffect(player) {
        onDispose { player.release() }
    }

    LaunchedEffect(active) {
        if (active) player.play() else player.pause()
    }

    AndroidView(
        factory = { ctx ->
            PlayerView(ctx).apply {
                this.player = player
                useController = true
                setShowNextButton(false)
                setShowPreviousButton(false)
                contentDescription = label
            }
        },
        modifier = Modifier
            .fillMaxSize()
            .semantics { contentDescription = "Video: $label" },
    )
}
