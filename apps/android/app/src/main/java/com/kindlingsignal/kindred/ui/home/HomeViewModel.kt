package com.kindlingsignal.kindred.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.api.MediaUrls
import com.kindlingsignal.kindred.data.auth.SessionManager
import com.kindlingsignal.kindred.data.model.TimelinePhoto
import com.kindlingsignal.kindred.data.repository.KindredRepository
import com.kindlingsignal.kindred.ui.components.MosaicTile
import com.kindlingsignal.kindred.util.dayKey
import com.kindlingsignal.kindred.util.formatDayLong
import com.kindlingsignal.kindred.util.formatDuration
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repository: KindredRepository,
    private val mediaUrls: MediaUrls,
    sessionManager: SessionManager,
) : ViewModel() {

    data class HomeUiState(
        val newMoments: Int = 0,
        val peopleToName: Int = 0,
        /** Empty until the newest day is known; the mosaic renders nothing. */
        val latestDayTitle: String = "",
        val latestDayCount: Int = 0,
        val latestDayTiles: List<MosaicTile> = emptyList(),
        val isLoading: Boolean = true,
        val isRefreshing: Boolean = false,
        val error: String? = null,
    )

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    val displayName: StateFlow<String?> = sessionManager.displayName
    val avatarUrl: StateFlow<String?> = sessionManager.avatarUrl

    init {
        load(initial = true)
    }

    fun refresh() = load(initial = false)

    private fun load(initial: Boolean) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = initial, isRefreshing = !initial, error = null) }

            // One month is enough for "the latest day"; asking for more would
            // pull thousands of rows the home screen never renders.
            val timeline = repository.getTimeline(months = 1)
            val people = repository.getClusters("people")

            val photos = timeline.getOrNull()?.months?.firstOrNull()?.photos.orEmpty()
            val latestKey = photos.firstNotNullOfOrNull { dayKey(it.dateTaken) }
            val latestDay = photos.filter { dayKey(it.dateTaken) == latestKey }

            // Unnamed groups are the ones the review flow exists for.
            val unnamed = people.getOrNull()?.clusters?.count { it.label.isNullOrBlank() } ?: 0

            _uiState.value = HomeUiState(
                newMoments = latestDay.size,
                peopleToName = unnamed,
                latestDayTitle = latestDay.firstOrNull()
                    ?.let { formatDayLong(it.dateTaken) }.orEmpty(),
                latestDayCount = latestDay.size,
                // The mosaic's lead tile is the 2x2, so a dozen rows is plenty
                // for the fold; the Library tab is where the whole day lives.
                latestDayTiles = latestDay.take(12).map(::toTile),
                isLoading = false,
                isRefreshing = false,
                error = timeline.exceptionOrNull()?.message.takeIf { latestDay.isEmpty() },
            )
        }
    }

    private fun toTile(photo: TimelinePhoto) = MosaicTile(
        id = photo.photoId,
        // /timeline builds thumb URLs itself; everything else composes them.
        imageUrl = photo.thumbUrl?.takeIf { it.isNotBlank() } ?: mediaUrls.thumb(photo.photoId),
        label = photo.photoTitle?.takeIf { it.isNotBlank() } ?: "Photo",
        isVideo = photo.isVideo,
        durationLabel = formatDuration(photo.durationSeconds),
    )
}
