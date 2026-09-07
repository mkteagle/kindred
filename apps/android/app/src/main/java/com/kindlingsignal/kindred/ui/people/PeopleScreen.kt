package com.kindlingsignal.kindred.ui.people

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.ui.components.KindredBackIcon
import com.kindlingsignal.kindred.ui.components.KindredEmptyState
import com.kindlingsignal.kindred.ui.components.KindredImage
import com.kindlingsignal.kindred.ui.components.KindredMeta
import com.kindlingsignal.kindred.ui.components.KindredPillButton
import com.kindlingsignal.kindred.ui.components.KindredTopAppBar
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType
import com.kindlingsignal.kindred.util.formatCount

/**
 * Screen 4 — People (and, with `category = "pets"`, the Animals screen the
 * Library's second chip opens).
 *
 * Back + title + a mono "N named", a 16dp-radius review card with a terracotta
 * Review button, then the 3-up circular face grid.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PeopleScreen(
    category: String,
    title: String,
    onBack: () -> Unit,
    onPersonClick: (ClusterSummary) -> Unit,
    onReview: () -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: PeopleViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val colors = KindredTheme.colors

    LaunchedEffect(category) { viewModel.load(category) }

    PullToRefreshBox(
        isRefreshing = state.isRefreshing,
        onRefresh = viewModel::refresh,
        modifier = modifier.fillMaxSize(),
    ) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            modifier = Modifier.fillMaxSize(),
            contentPadding = contentPadding,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }, key = "bar") {
                KindredTopAppBar(
                    title = title,
                    navigationIcon = KindredBackIcon,
                    navigationLabel = "Back",
                    onNavigationClick = onBack,
                    trailingMeta = "${formatCount(state.named.size)} named",
                )
            }

            if (state.unnamedCount > 0) {
                item(span = { GridItemSpan(maxLineSpan) }, key = "review") {
                    ReviewCard(
                        unnamedCount = state.unnamedCount,
                        onReview = onReview,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                }
            }

            if (state.named.isEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }, key = "empty") {
                    KindredEmptyState(
                        title = if (state.isLoading) "Sorting faces" else "No names yet",
                        body = state.error
                            ?: "Name a group and it appears here with everything it matches.",
                    )
                }
            }

            items(state.named, key = { it.id }) { cluster ->
                FaceCell(
                    cluster = cluster,
                    onClick = { onPersonClick(cluster) },
                    modifier = Modifier.padding(horizontal = 2.dp),
                )
            }

            item(span = { GridItemSpan(maxLineSpan) }, key = "tail") {
                Spacer(Modifier.height(120.dp))
            }
        }
    }
}

@Composable
private fun ReviewCard(
    unnamedCount: Int,
    onReview: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KindredTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(KindredShape.Medium)
            .background(colors.fillSoft)
            .border(1.dp, colors.hairline, KindredShape.Medium)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                text = "${formatCount(unnamedCount)} need a name",
                style = KindredType.CardTitle,
                color = colors.inkPrimary,
            )
            // TODO: the handoff also shows "N possible duplicates" here. No
            // endpoint reports likely-duplicate clusters; a
            // `GET /clusters/{category}/duplicates` would close it.
            KindredMeta("Review them one at a time")
        }
        Spacer(Modifier.weight(1f))
        KindredPillButton(
            label = "Review",
            onClick = onReview,
            minHeight = 36.dp,
            contentDescription = "Review $unnamedCount unnamed groups",
        )
    }
}

@Composable
private fun FaceCell(
    cluster: ClusterSummary,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KindredTheme.colors
    val name = cluster.label ?: "Unnamed"
    Column(
        modifier = modifier
            .clickable(role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) {
                contentDescription = "$name, ${cluster.photoCount} photos"
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        KindredImage(
            // The chip is the cropped face, which is what a circular face grid
            // wants; the full photo is the fallback when there is no crop.
            url = cluster.avatar ?: cluster.thumbUrl ?: cluster.photoUrl,
            contentDescription = null,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(CircleShape),
        )
        Text(
            text = name,
            style = KindredType.Name,
            color = colors.inkPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = formatCount(cluster.photoCount),
            style = KindredType.Micro,
            color = colors.inkMeta,
        )
    }
}
