package com.kindlingsignal.kindred.ui.viewer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.api.MediaUrls
import com.kindlingsignal.kindred.data.repository.KindredRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** A person the photo contains, as the viewer's chips show them. */
data class ViewerPerson(val name: String, val avatarUrl: String?)

@HiltViewModel
class PhotoViewerViewModel @Inject constructor(
    private val repository: KindredRepository,
    private val mediaUrls: MediaUrls,
    private val sessionManager: com.kindlingsignal.kindred.data.auth.SessionManager,
) : ViewModel() {

    /**
     * Media3 has its own HTTP stack, so it needs the session token directly
     * rather than through the app's OkHttp interceptor.
     */
    val sessionToken: String? get() = sessionManager.sessionToken.value

    data class ViewerUiState(
        val photoId: String? = null,
        val dateLabel: String = "",
        val timeLabel: String? = null,
        val people: List<ViewerPerson> = emptyList(),
        val tags: List<String> = emptyList(),
        val isFavorite: Boolean = false,
        val snackbar: String? = null,
    )

    private val _uiState = MutableStateFlow(ViewerUiState())
    val uiState: StateFlow<ViewerUiState> = _uiState.asStateFlow()

    private var detailJob: Job? = null

    fun previewUrl(photoId: String): String? = mediaUrls.preview(photoId)

    fun originalUrl(photoId: String): String? = mediaUrls.original(photoId)

    /** Called on every page change, so the detail request is always cancelled first. */
    fun onPhotoShown(photoId: String, fallbackDateLabel: String) {
        detailJob?.cancel()
        _uiState.value = ViewerUiState(photoId = photoId, dateLabel = fallbackDateLabel)

        detailJob = viewModelScope.launch {
            val metadata = repository.getPhotoMetadata(photoId).getOrNull()
            val detections = repository.getPhotoDetections(photoId).getOrNull()

            val people = detections?.detections
                .orEmpty()
                .filter { it.category == "people" && !it.clusterLabel.isNullOrBlank() }
                .distinctBy { it.clusterLabel }
                .map { ViewerPerson(it.clusterLabel!!, it.chip) }

            // Subtypes are the object vocabulary ("dog", "car"); the handoff's
            // "campfire" chip is a scene label, which lives on a different
            // pipeline.
            // TODO: surface scene labels once /scenes reports them per photo.
            val tags = detections?.detections
                .orEmpty()
                .filter { it.category != "people" }
                .mapNotNull { it.subtype?.takeIf(String::isNotBlank) }
                .distinct()
                .take(4)

            _uiState.update { state ->
                if (state.photoId != photoId) return@update state
                state.copy(
                    timeLabel = com.kindlingsignal.kindred.util.formatTimeOfDay(metadata?.dateTaken),
                    people = people,
                    tags = tags,
                )
            }
        }
    }

    fun toggleFavorite() {
        val photoId = _uiState.value.photoId ?: return
        val next = !_uiState.value.isFavorite
        // Optimistic: the endpoint is idempotent both ways, so a failed call
        // can be rolled back without leaving the server in a half state.
        _uiState.update { it.copy(isFavorite = next) }
        viewModelScope.launch {
            repository.setFavorite(photoId, next).onFailure { error ->
                _uiState.update {
                    it.copy(
                        isFavorite = !next,
                        snackbar = error.message ?: "Could not change the favorite",
                    )
                }
            }
        }
    }

    /**
     * TODO: deleting a photo has no member-safe endpoint. `POST /flickr/delete`
     * is admin-only and removes the Flickr copy rather than the catalog row; a
     * `POST /photos/delete` with a soft delete would close this and make the
     * handoff's Undo snackbar honest.
     */
    fun delete() {
        _uiState.update { it.copy(snackbar = "Deleting isn't available yet") }
    }

    fun share() {
        _uiState.update { it.copy(snackbar = "Sharing a single photo isn't available yet") }
    }

    fun dismissSnackbar() {
        _uiState.update { it.copy(snackbar = null) }
    }
}
