package com.kindlingsignal.kindred.ui.together

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.components.KindredBackIcon
import com.kindlingsignal.kindred.ui.components.KindredEmptyState
import com.kindlingsignal.kindred.ui.components.KindredMeta
import com.kindlingsignal.kindred.ui.components.KindredPersonChip
import com.kindlingsignal.kindred.ui.components.KindredTopAppBar
import com.kindlingsignal.kindred.ui.components.MosaicTile
import com.kindlingsignal.kindred.ui.components.photoMosaic
import com.kindlingsignal.kindred.util.formatCount

/**
 * "Together with…", reached from a person's detail screen.
 *
 * Not one of the handoff's twelve screens, but screen 5 links to it, so it
 * follows the same vocabulary: person chips as the picker, a mono count, and
 * the same mosaic as everywhere else.
 */
@Composable
fun TogetherScreen(
    seedClusterId: String?,
    onBack: () -> Unit,
    onPhotoClick: (List<MosaicTile>, Int) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: TogetherViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(seedClusterId) {
        if (seedClusterId != null) viewModel.preselect(seedClusterId)
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = contentPadding,
    ) {
        item("bar") {
            KindredTopAppBar(
                title = "Together",
                navigationIcon = KindredBackIcon,
                navigationLabel = "Back",
                onNavigationClick = onBack,
            )
        }

        item("chips") {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                state.people.forEach { person ->
                    KindredPersonChip(
                        name = person.label ?: "Unnamed",
                        avatarUrl = person.avatar ?: person.thumbUrl,
                        filled = person.id in state.selected,
                        onClick = { viewModel.toggle(person.id) },
                    )
                }
            }
        }

        if (state.results.isEmpty()) {
            item("empty") {
                KindredEmptyState(
                    title = when {
                        state.isLoading -> "Looking"
                        state.selected.size < 2 -> "Pick two people"
                        else -> "Never in the same frame"
                    },
                    body = state.error ?: when {
                        state.selected.size < 2 -> "Choose a second person and the photos they share appear here."
                        else -> "No photo in the library has both of them in it."
                    },
                )
            }
        } else {
            item("count") {
                KindredMeta(
                    text = "${formatCount(state.results.size)} together",
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
            photoMosaic(
                tiles = state.results,
                keyPrefix = "together",
                rowHeight = 116.dp,
                onTileClick = { tile -> onPhotoClick(state.results, state.results.indexOf(tile)) },
            )
        }

        item("tail") { Spacer(Modifier.height(120.dp)) }
    }
}
