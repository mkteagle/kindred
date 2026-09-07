package com.kindlingsignal.kindred.ui.people

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.components.KindredBackIcon
import com.kindlingsignal.kindred.ui.components.KindredEyebrow
import com.kindlingsignal.kindred.ui.components.KindredIconAction
import com.kindlingsignal.kindred.ui.components.KindredImage
import com.kindlingsignal.kindred.ui.components.KindredMeta
import com.kindlingsignal.kindred.ui.components.KindredOverflowAction
import com.kindlingsignal.kindred.ui.components.KindredPillButton
import com.kindlingsignal.kindred.ui.components.KindredTopAppBar
import com.kindlingsignal.kindred.ui.components.MosaicTile
import com.kindlingsignal.kindred.ui.components.photoMosaic
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType
import com.kindlingsignal.kindred.util.formatCount

/**
 * Screen 5 — Person detail.
 *
 * A 320dp cover under a scrim with translucent actions, an amber eyebrow, the
 * 32sp name, a mono stats line, two 40dp pill buttons, then the Recent 3-up.
 */
@Composable
fun PersonDetailScreen(
    category: String,
    clusterId: String,
    onBack: () -> Unit,
    onTogether: () -> Unit,
    onPhotoClick: (List<MosaicTile>, Int) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: PersonDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val colors = KindredTheme.colors

    LaunchedEffect(category, clusterId) { viewModel.load(category, clusterId) }

    Box(modifier = modifier.fillMaxSize()) {
        // The cover sits behind the content and fades into the ground, so the
        // name and stats read as if printed on the photograph.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(320.dp),
        ) {
            KindredImage(
                url = state.coverUrl,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0f to colors.bg.copy(alpha = 0.5f),
                            0.4f to colors.bg.copy(alpha = 0f),
                            1f to colors.bg,
                        )
                    )
            )
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = contentPadding,
        ) {
            item("bar") {
                KindredTopAppBar(
                    title = "",
                    navigationIcon = KindredBackIcon,
                    navigationLabel = "Back",
                    onNavigationClick = onBack,
                ) {
                    KindredIconAction(
                        icon = Icons.Filled.Share,
                        contentDescription = "Share ${state.name}",
                        onClick = { },
                        tint = colors.inkPrimary,
                    )
                    KindredOverflowAction(onClick = { })
                }
            }

            item("cover-spacer") { Spacer(Modifier.height(150.dp)) }

            item("identity") {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    // TODO: the handoff's "Since March 2019" eyebrow needs the
                    // first date this person appears. No endpoint reports a
                    // cluster's date range; a `first_seen` on
                    // /clusters/{category}/summary would close it.
                    KindredEyebrow("In your library", color = colors.amber)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = state.name,
                        style = KindredType.PersonName,
                        color = colors.inkPrimary,
                        modifier = Modifier.semantics { heading() },
                    )
                    Spacer(Modifier.height(6.dp))
                    // TODO: the handoff also shows video and place counts here.
                    // The cluster summary reports photos only; per-category
                    // media counts and place counts on that endpoint would
                    // close it.
                    KindredMeta("${formatCount(state.photoCount)} photos", small = false)

                    Spacer(Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        KindredPillButton(
                            label = "Slideshow",
                            onClick = {
                                if (state.recent.isNotEmpty()) onPhotoClick(state.recent, 0)
                            },
                        )
                        KindredPillButton(
                            label = "Together with…",
                            onClick = onTogether,
                            filled = false,
                            contentDescription = "Find photos of ${state.name} with someone else",
                        )
                    }
                }
            }

            item("recent-header") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Recent",
                        style = KindredType.CardTitle,
                        color = colors.inkPrimary,
                        modifier = Modifier.semantics { heading() },
                    )
                }
            }

            photoMosaic(
                tiles = state.recent,
                keyPrefix = "person-$clusterId",
                rowHeight = 108.dp,
                onTileClick = { tile -> onPhotoClick(state.recent, state.recent.indexOf(tile)) },
            )

            item("tail") { Spacer(Modifier.height(120.dp)) }
        }
    }
}
