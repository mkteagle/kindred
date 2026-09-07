package com.kindlingsignal.kindred.ui.gallery

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.api.MediaUrls
import com.kindlingsignal.kindred.data.repository.KindredRepository
import com.kindlingsignal.kindred.ui.components.KindredBackIcon
import com.kindlingsignal.kindred.ui.components.KindredEmptyState
import com.kindlingsignal.kindred.ui.components.KindredTopAppBar
import com.kindlingsignal.kindred.ui.components.MosaicTile
import com.kindlingsignal.kindred.ui.components.photoMosaic
import com.kindlingsignal.kindred.util.formatCount
import com.kindlingsignal.kindred.util.formatDuration
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class FavoritesViewModel @Inject constructor(
    private val repository: KindredRepository,
    private val mediaUrls: MediaUrls,
) : ViewModel() {

    data class FavoritesUiState(
        val tiles: List<MosaicTile> = emptyList(),
        val isLoading: Boolean = true,
        val error: String? = null,
    )

    private val _uiState = MutableStateFlow(FavoritesUiState())
    val uiState: StateFlow<FavoritesUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.getFavorites()
                .onSuccess { page ->
                    _uiState.value = FavoritesUiState(
                        tiles = page.photos.map { photo ->
                            MosaicTile(
                                id = photo.photoId,
                                imageUrl = mediaUrls.thumb(photo.photoId),
                                label = photo.photoTitle?.takeIf { it.isNotBlank() } ?: "Photo",
                                isVideo = photo.isVideo,
                                durationLabel = formatDuration(photo.durationSeconds),
                            )
                        },
                        isLoading = false,
                    )
                }
                .onFailure { error ->
                    _uiState.value = FavoritesUiState(
                        isLoading = false,
                        error = error.message ?: "Could not load favorites",
                    )
                }
        }
    }
}

/**
 * Favourites, as their own mosaic. Not one of the handoff's twelve screens, but
 * `/favorites` is per member and the Settings group links to it, so it needed
 * somewhere to land rather than a dead row.
 */
@Composable
fun FavoritesScreen(
    onBack: () -> Unit,
    onPhotoClick: (List<MosaicTile>, Int) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: FavoritesViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = contentPadding,
    ) {
        item("bar") {
            KindredTopAppBar(
                title = "Favorites",
                navigationIcon = KindredBackIcon,
                navigationLabel = "Back",
                onNavigationClick = onBack,
                trailingMeta = formatCount(state.tiles.size),
            )
        }

        if (state.tiles.isEmpty()) {
            item("empty") {
                KindredEmptyState(
                    title = if (state.isLoading) "Gathering your favorites" else "No favorites yet",
                    body = state.error ?: "Tap the heart on a photo and it lands here.",
                )
            }
        } else {
            photoMosaic(
                tiles = state.tiles,
                keyPrefix = "favorites",
                rowHeight = 116.dp,
                onTileClick = { tile -> onPhotoClick(state.tiles, state.tiles.indexOf(tile)) },
            )
        }

        item("tail") { Spacer(Modifier.height(120.dp)) }
    }
}
