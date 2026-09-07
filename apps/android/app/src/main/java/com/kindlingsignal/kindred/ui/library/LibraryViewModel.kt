package com.kindlingsignal.kindred.ui.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.api.MediaUrls
import com.kindlingsignal.kindred.data.model.LibraryPhoto
import com.kindlingsignal.kindred.data.model.MediaFilter
import com.kindlingsignal.kindred.data.repository.KindredRepository
import com.kindlingsignal.kindred.ui.components.MosaicTile
import com.kindlingsignal.kindred.util.dayKey
import com.kindlingsignal.kindred.util.formatDayShort
import com.kindlingsignal.kindred.util.formatDuration
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** One day of the library, the unit the mosaic and "select all" work on. */
data class LibraryDay(
    val key: String,
    val title: String,
    val tiles: List<MosaicTile>,
)

@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val repository: KindredRepository,
    private val mediaUrls: MediaUrls,
) : ViewModel() {

    data class LibraryUiState(
        val days: List<LibraryDay> = emptyList(),
        val isLoading: Boolean = true,
        val isRefreshing: Boolean = false,
        val isAppending: Boolean = false,
        val hasMore: Boolean = false,
        val error: String? = null,
        /** Null means no selection; empty set means selection with nothing in it. */
        val selection: Set<String>? = null,
        val snackbar: String? = null,
    ) {
        val selectionActive: Boolean get() = selection != null
        val selectedCount: Int get() = selection?.size ?: 0
        val allTiles: List<MosaicTile> get() = days.flatMap { it.tiles }
    }

    private val _uiState = MutableStateFlow(LibraryUiState())
    val uiState: StateFlow<LibraryUiState> = _uiState.asStateFlow()

    private var cursor: String? = null
    private var loadJob: Job? = null

    init {
        load(reset = true, refreshing = false)
    }

    fun refresh() = load(reset = true, refreshing = true)

    /** Called as the mosaic nears its end; keyset paging makes this cheap. */
    fun loadMore() {
        val state = _uiState.value
        if (state.isAppending || state.isLoading || !state.hasMore) return
        load(reset = false, refreshing = false)
    }

    private fun load(reset: Boolean, refreshing: Boolean) {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            if (reset) cursor = null
            _uiState.update {
                it.copy(
                    isLoading = reset && !refreshing,
                    isRefreshing = refreshing,
                    isAppending = !reset,
                    error = null,
                )
            }

            repository.getLibraryPhotos(media = MediaFilter.ALL, cursor = cursor)
                .onSuccess { page ->
                    cursor = page.nextCursor
                    val existing = if (reset) emptyList() else _uiState.value.days
                    _uiState.update {
                        it.copy(
                            days = mergeDays(existing, page.photos),
                            isLoading = false,
                            isRefreshing = false,
                            isAppending = false,
                            hasMore = page.nextCursor != null,
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            isAppending = false,
                            error = error.message ?: "Could not reach the library",
                        )
                    }
                }
        }
    }

    /**
     * Fold a new page into the days already on screen. Rows arrive newest
     * first, so a page can continue the day the last one ended on rather than
     * starting a second header for it.
     */
    private fun mergeDays(existing: List<LibraryDay>, page: List<LibraryPhoto>): List<LibraryDay> {
        val days = existing.toMutableList()
        page.forEach { photo ->
            val key = dayKey(photo.dateTaken) ?: "undated"
            val tile = toTile(photo)
            val index = days.indexOfFirst { it.key == key }
            if (index >= 0) {
                days[index] = days[index].copy(tiles = days[index].tiles + tile)
            } else {
                days += LibraryDay(
                    key = key,
                    title = formatDayShort(photo.dateTaken),
                    tiles = listOf(tile),
                )
            }
        }
        return days
    }

    private fun toTile(photo: LibraryPhoto) = MosaicTile(
        id = photo.photoId,
        imageUrl = mediaUrls.thumb(photo.photoId),
        label = photo.photoTitle?.takeIf { it.isNotBlank() } ?: "Photo",
        isVideo = photo.isVideo,
        durationLabel = formatDuration(photo.durationSeconds),
    )

    // MARK: - Selection

    fun startSelection(photoId: String) {
        _uiState.update { it.copy(selection = setOf(photoId)) }
    }

    fun toggle(photoId: String) {
        _uiState.update { state ->
            val current = state.selection ?: return@update state
            val next = if (photoId in current) current - photoId else current + photoId
            state.copy(selection = next)
        }
    }

    /** Sweep adds rather than toggles, so dragging back over a tile is not a flicker. */
    fun addToSelection(photoId: String) {
        _uiState.update { state ->
            val current = state.selection ?: emptySet()
            state.copy(selection = current + photoId)
        }
    }

    /** Long-press the day header, or tap its "select all" affordance. */
    fun selectDay(key: String) {
        _uiState.update { state ->
            val day = state.days.firstOrNull { it.key == key } ?: return@update state
            state.copy(selection = (state.selection ?: emptySet()) + day.tiles.map { it.id })
        }
    }

    fun clearSelection() {
        _uiState.update { it.copy(selection = null) }
    }

    fun isDayFullySelected(key: String): Boolean {
        val state = _uiState.value
        val day = state.days.firstOrNull { it.key == key } ?: return false
        val selection = state.selection ?: return false
        return day.tiles.isNotEmpty() && day.tiles.all { it.id in selection }
    }

    // MARK: - Selection actions

    fun favoriteSelection() {
        val ids = _uiState.value.selection.orEmpty().toList()
        if (ids.isEmpty()) return
        viewModelScope.launch {
            val failures = ids.count { repository.setFavorite(it, true).isFailure }
            _uiState.update {
                it.copy(
                    selection = null,
                    snackbar = if (failures == 0) "Added ${ids.size} to favorites"
                    else "Could not favorite $failures of ${ids.size}",
                )
            }
        }
    }

    /**
     * Deletion has no endpoint the app may call for a member: the backend's
     * delete paths are Flickr-scoped and admin-only.
     *
     * TODO: close this with a member-safe `POST /photos/delete` (soft delete,
     * undoable) — the snackbar's Undo affordance the handoff asks for cannot
     * be honest until then.
     */
    fun deleteSelection() {
        _uiState.update {
            it.copy(snackbar = "Deleting from the phone isn't available yet")
        }
    }

    fun shareSelection() {
        _uiState.update {
            it.copy(snackbar = "Sharing a selection isn't available yet")
        }
    }

    fun dismissSnackbar() {
        _uiState.update { it.copy(snackbar = null) }
    }
}
