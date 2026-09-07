package com.kindlingsignal.kindred.ui.videos

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.api.MediaUrls
import com.kindlingsignal.kindred.data.model.LibraryPhoto
import com.kindlingsignal.kindred.data.model.MediaFilter
import com.kindlingsignal.kindred.data.repository.KindredRepository
import com.kindlingsignal.kindred.util.formatDuration
import com.kindlingsignal.kindred.util.startOfCurrentYear
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** One poster card. */
data class VideoPoster(
    val id: String,
    val title: String,
    val posterUrl: String?,
    val duration: String?,
)

/**
 * The three chips the handoff draws. Each is a server-side facet rather than a
 * filter over the current page: filtering client-side would silently hide
 * matches nobody had scrolled to yet.
 */
enum class VideoFilter(val label: String) {
    ALL("All"),
    THIS_YEAR("This year"),
    OVER_A_MINUTE("Over a minute"),
}

@HiltViewModel
class VideosViewModel @Inject constructor(
    private val repository: KindredRepository,
    private val mediaUrls: MediaUrls,
) : ViewModel() {

    data class VideosUiState(
        val videos: List<VideoPoster> = emptyList(),
        val totalCount: Int = 0,
        val filter: VideoFilter = VideoFilter.ALL,
        val isLoading: Boolean = true,
        val isRefreshing: Boolean = false,
        val hasMore: Boolean = false,
        val error: String? = null,
    )

    private val _uiState = MutableStateFlow(VideosUiState())
    val uiState: StateFlow<VideosUiState> = _uiState.asStateFlow()

    private var cursor: String? = null
    private var job: Job? = null

    init {
        viewModelScope.launch {
            repository.getLibraryCounts().onSuccess { counts ->
                _uiState.update { it.copy(totalCount = counts.videos) }
            }
        }
        load(reset = true, refreshing = false)
    }

    fun setFilter(filter: VideoFilter) {
        if (filter == _uiState.value.filter) return
        _uiState.update { it.copy(filter = filter) }
        load(reset = true, refreshing = false)
    }

    fun refresh() = load(reset = true, refreshing = true)

    fun loadMore() {
        val state = _uiState.value
        if (state.isLoading || !state.hasMore) return
        load(reset = false, refreshing = false)
    }

    private fun load(reset: Boolean, refreshing: Boolean) {
        job?.cancel()
        job = viewModelScope.launch {
            if (reset) cursor = null
            val filter = _uiState.value.filter
            _uiState.update {
                it.copy(isLoading = reset && !refreshing, isRefreshing = refreshing, error = null)
            }

            repository.getLibraryPhotos(
                media = MediaFilter.VIDEO,
                cursor = cursor,
                dateFrom = if (filter == VideoFilter.THIS_YEAR) startOfCurrentYear() else null,
                minDuration = if (filter == VideoFilter.OVER_A_MINUTE) 60.0 else null,
            ).onSuccess { page ->
                cursor = page.nextCursor
                val existing = if (reset) emptyList() else _uiState.value.videos
                _uiState.update {
                    it.copy(
                        videos = existing + page.photos.map(::toPoster),
                        isLoading = false,
                        isRefreshing = false,
                        hasMore = page.nextCursor != null,
                    )
                }
            }.onFailure { error ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isRefreshing = false,
                        error = error.message ?: "Could not load videos",
                    )
                }
            }
        }
    }

    private fun toPoster(photo: LibraryPhoto) = VideoPoster(
        id = photo.photoId,
        title = photo.photoTitle?.takeIf { it.isNotBlank() } ?: "Untitled",
        // The poster frame is derived on first request and cached beside the
        // image thumbnails, so a video answers `variant=thumb` like a photo.
        posterUrl = mediaUrls.thumb(photo.photoId),
        duration = formatDuration(photo.durationSeconds),
    )
}
