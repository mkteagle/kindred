package com.kindlingsignal.kindred.ui.videos

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.components.KindredBackIcon
import com.kindlingsignal.kindred.ui.components.KindredEmptyState
import com.kindlingsignal.kindred.ui.components.KindredFilterChip
import com.kindlingsignal.kindred.ui.components.KindredImage
import com.kindlingsignal.kindred.ui.components.KindredTopAppBar
import com.kindlingsignal.kindred.ui.components.photoScrimBrush
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType
import com.kindlingsignal.kindred.util.formatCount

/**
 * Screen 7 — Videos.
 *
 * Title and count, three facet chips, then stacked 16dp-radius poster cards
 * with a scrim, a round play chip, and the title and duration on the photo.
 *
 * The handoff's "never watched" affordance is deliberately absent: playback
 * tracking is out of scope for this release and there is no watch state to
 * read, so nothing here claims to know whether a video has been seen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideosScreen(
    onBack: () -> Unit,
    onPlay: (VideoPoster) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: VideosViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()

    val nearEnd by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= listState.layoutInfo.totalItemsCount - 3
        }
    }
    LaunchedEffect(listState) {
        snapshotFlow { nearEnd }.collect { if (it) viewModel.loadMore() }
    }

    PullToRefreshBox(
        isRefreshing = state.isRefreshing,
        onRefresh = viewModel::refresh,
        modifier = modifier.fillMaxSize(),
    ) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = contentPadding,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item("bar") {
                KindredTopAppBar(
                    title = "Videos",
                    navigationIcon = KindredBackIcon,
                    navigationLabel = "Back",
                    onNavigationClick = onBack,
                    trailingMeta = formatCount(state.totalCount),
                )
            }

            item("chips") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    VideoFilter.entries.forEach { filter ->
                        KindredFilterChip(
                            label = filter.label,
                            selected = filter == state.filter,
                            onClick = { viewModel.setFilter(filter) },
                        )
                    }
                }
            }

            if (state.videos.isEmpty()) {
                item("empty") {
                    KindredEmptyState(
                        title = if (state.isLoading) "Finding the videos" else "No videos here",
                        body = state.error ?: "Nothing matches this filter yet.",
                    )
                }
            }

            items(state.videos, key = { it.id }) { video ->
                PosterCard(
                    video = video,
                    onClick = { onPlay(video) },
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }

            item("tail") { Spacer(Modifier.height(120.dp)) }
        }
    }
}

@Composable
private fun PosterCard(
    video: VideoPoster,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KindredTheme.colors
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(176.dp)
            .clip(KindredShape.Medium)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) {
                contentDescription = listOfNotNull("Play ${video.title}", video.duration)
                    .joinToString(", ")
            },
    ) {
        KindredImage(
            url = video.posterUrl,
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop,
        )
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(photoScrimBrush())
        )
        Box(
            modifier = Modifier
                .padding(12.dp)
                .size(36.dp)
                .clip(CircleShape)
                .background(colors.bg.copy(alpha = 0.55f))
                .align(Alignment.TopStart),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.PlayArrow,
                contentDescription = null,
                tint = colors.inkPrimary,
                modifier = Modifier.size(16.dp),
            )
        }
        Row(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .padding(start = 14.dp, end = 14.dp, bottom = 12.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(
                text = video.title,
                style = KindredType.CardTitle,
                color = colors.inkPrimary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.weight(1f))
            if (video.duration != null) {
                Text(
                    text = video.duration,
                    style = KindredType.MetaSmall,
                    color = colors.inkPrimary.copy(alpha = 0.75f),
                )
            }
        }
    }
}
