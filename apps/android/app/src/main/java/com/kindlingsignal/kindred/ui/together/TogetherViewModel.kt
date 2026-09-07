package com.kindlingsignal.kindred.ui.together

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.data.repository.KindredRepository
import com.kindlingsignal.kindred.ui.components.MosaicTile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * "Together with…" from the person detail screen: pick a second person and see
 * only the photos that contain both. `/photos/together` takes comma-separated
 * cluster ids and works across categories, so a person and a pet is a valid
 * pair too.
 */
@HiltViewModel
class TogetherViewModel @Inject constructor(
    private val repository: KindredRepository,
) : ViewModel() {

    data class TogetherUiState(
        val people: List<ClusterSummary> = emptyList(),
        val selected: Set<String> = emptySet(),
        val results: List<MosaicTile> = emptyList(),
        val isLoading: Boolean = false,
        val error: String? = null,
    )

    private val _uiState = MutableStateFlow(TogetherUiState())
    val uiState: StateFlow<TogetherUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.getClusters("people").onSuccess { response ->
                _uiState.update {
                    it.copy(
                        people = response.clusters
                            .filter { cluster -> !cluster.label.isNullOrBlank() }
                            .sortedByDescending { cluster -> cluster.photoCount },
                    )
                }
            }
        }
    }

    /** Preselects the person whose detail screen opened this. */
    fun preselect(clusterId: String) {
        _uiState.update { it.copy(selected = it.selected + clusterId) }
        search()
    }

    fun toggle(clusterId: String) {
        _uiState.update { state ->
            state.copy(
                selected = if (clusterId in state.selected) state.selected - clusterId
                else state.selected + clusterId,
            )
        }
        search()
    }

    private fun search() {
        val ids = _uiState.value.selected
        // One person alone is a person page, not a "together" question.
        if (ids.size < 2) {
            _uiState.update { it.copy(results = emptyList(), error = null) }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            repository.getPhotosTogether(ids.joinToString(","))
                .onSuccess { response ->
                    _uiState.update { state ->
                        state.copy(
                            results = response.photos.map { photo ->
                                MosaicTile(
                                    id = photo.photoId,
                                    imageUrl = photo.thumbUrl ?: photo.photoUrl,
                                    label = photo.photoTitle?.takeIf { it.isNotBlank() } ?: "Photo",
                                )
                            },
                            isLoading = false,
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            results = emptyList(),
                            isLoading = false,
                            error = error.message ?: "Could not look that up",
                        )
                    }
                }
        }
    }
}
