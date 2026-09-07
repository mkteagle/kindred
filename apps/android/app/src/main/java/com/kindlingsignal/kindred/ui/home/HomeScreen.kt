package com.kindlingsignal.kindred.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.components.DockedSearchBar
import com.kindlingsignal.kindred.ui.components.KindredAvatar
import com.kindlingsignal.kindred.ui.components.KindredDayHeader
import com.kindlingsignal.kindred.ui.components.KindredEmptyState
import com.kindlingsignal.kindred.ui.components.KindredEyebrow
import com.kindlingsignal.kindred.ui.components.KindredIconAction
import com.kindlingsignal.kindred.ui.components.KindredMark
import com.kindlingsignal.kindred.ui.components.KindredStatCard
import com.kindlingsignal.kindred.ui.components.MosaicTile
import com.kindlingsignal.kindred.ui.components.photoMosaic
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType
import com.kindlingsignal.kindred.util.formatCount
import com.kindlingsignal.kindred.util.greetingTimeOfDay

/**
 * Screen 1 — Home.
 *
 * The inverse lockup and account row, the docked search bar, the mono time-of-
 * day eyebrow over a 30sp title, two stat cards, and the latest day as a
 * 3-column mosaic on 110dp rows. The extended FAB is owned by the navigation
 * shell so it sits above the navigation bar on every tab.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onSearchClick: () -> Unit,
    onPhotoClick: (List<MosaicTile>, Int) -> Unit,
    onNotificationsClick: () -> Unit,
    onAccountClick: () -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val displayName by viewModel.displayName.collectAsStateWithLifecycle()
    val avatarUrl by viewModel.avatarUrl.collectAsStateWithLifecycle()
    val colors = KindredTheme.colors

    PullToRefreshBox(
        isRefreshing = state.isRefreshing,
        onRefresh = viewModel::refresh,
        modifier = modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = contentPadding,
        ) {
            item("lockup") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .windowInsetsPadding(WindowInsets.statusBars)
                        .padding(start = 16.dp, end = 8.dp, top = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    KindredMark(size = 18.dp)
                    Spacer(Modifier.width(10.dp))
                    Text(
                        text = "Kindred",
                        style = KindredType.AppBarTitle,
                        color = colors.inkPrimary,
                        modifier = Modifier.semantics { heading() },
                    )
                    Spacer(Modifier.weight(1f))
                    KindredIconAction(
                        icon = Icons.Outlined.Notifications,
                        contentDescription = "Notifications",
                        onClick = onNotificationsClick,
                    )
                    Box(
                        modifier = Modifier
                            .padding(horizontal = 8.dp)
                            .clip(CircleShape)
                            .clickable(role = Role.Button, onClick = onAccountClick),
                    ) {
                        KindredAvatar(
                            url = avatarUrl,
                            contentDescription = "Your account, ${displayName ?: "signed in"}",
                            size = 26.dp,
                            initial = displayName ?: "K",
                        )
                    }
                }
            }

            item("search") {
                Box(Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
                    DockedSearchBar(onClick = onSearchClick)
                }
            }

            item("greeting") {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    KindredEyebrow(greetingTimeOfDay())
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = "A quieter view\nof your week.",
                        style = KindredType.ScreenTitle,
                        color = colors.inkPrimary,
                        modifier = Modifier.semantics { heading() },
                    )
                }
            }

            item("stats") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    KindredStatCard(
                        value = formatCount(state.newMoments),
                        label = "new moments",
                        modifier = Modifier.weight(1f),
                    )
                    KindredStatCard(
                        value = formatCount(state.peopleToName),
                        label = "people to name",
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            if (state.latestDayTiles.isEmpty()) {
                item("empty") {
                    KindredEmptyState(
                        title = if (state.isLoading) "Looking through the library" else "Nothing here yet",
                        body = state.error
                            ?: "Photos appear here as soon as the first ones land on your server.",
                    )
                }
            } else {
                item("day-header") {
                    KindredDayHeader(
                        title = state.latestDayTitle,
                        // The day's own title would come from a member-named
                        // event or a reverse-geocoded EXIF place. Neither is
                        // available, and the handoff says never invent one, so
                        // the count stands alone.
                        // TODO: use /events once it returns a member-set label
                        // per day, and a place name once one is reverse-geocoded.
                        subtitle = formatCount(state.latestDayCount),
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }

                photoMosaic(
                    tiles = state.latestDayTiles,
                    keyPrefix = "home",
                    rowHeight = 110.dp,
                    onTileClick = { tile ->
                        onPhotoClick(state.latestDayTiles, state.latestDayTiles.indexOf(tile))
                    },
                )
            }

            item("tail") { Spacer(Modifier.height(120.dp)) }
        }
    }
}
