package com.kindlingsignal.kindred.ui.people

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.data.model.NamedCluster
import com.kindlingsignal.kindred.data.repository.KindredRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Walks the unnamed groups one at a time. The queue is the unnamed half of
 * `/clusters/{category}/summary`; naming, merging and dismissing all go through
 * the cluster mutation routes, which the backend gates behind an admin session
 * — a member sees the failure in the snackbar rather than a silent no-op.
 */
@HiltViewModel
class ReviewViewModel @Inject constructor(
    private val repository: KindredRepository,
) : ViewModel() {

    data class ReviewUiState(
        val queue: List<ClusterSummary> = emptyList(),
        val index: Int = 0,
        val nameSuggestions: List<NamedCluster> = emptyList(),
        val faces: List<String> = emptyList(),
        val remainingFaces: Int = 0,
        val draftName: String = "",
        val isLoading: Boolean = true,
        val isSaving: Boolean = false,
        val snackbar: String? = null,
        val finished: Boolean = false,
    ) {
        val current: ClusterSummary? get() = queue.getOrNull(index)
        val position: Int get() = (index + 1).coerceAtMost(queue.size)
        val progress: Float get() = if (queue.isEmpty()) 0f else position.toFloat() / queue.size
    }

    private val _uiState = MutableStateFlow(ReviewUiState())
    val uiState: StateFlow<ReviewUiState> = _uiState.asStateFlow()

    private var category: String = "people"

    fun load(category: String) {
        this.category = category
        viewModelScope.launch {
            val summary = repository.getClusters(category).getOrNull()
            val named = repository.getNamedClusters(category).getOrNull().orEmpty()
            val unnamed = summary?.clusters.orEmpty().filter { it.label.isNullOrBlank() }
                .sortedByDescending { it.photoCount }

            _uiState.value = ReviewUiState(
                queue = unnamed,
                index = 0,
                nameSuggestions = named.take(8),
                isLoading = false,
                finished = unnamed.isEmpty(),
            )
            loadFaces()
        }
    }

    private fun loadFaces() {
        val cluster = _uiState.value.current ?: return
        viewModelScope.launch {
            val items = repository.getClusterDetail(category, cluster.id).getOrNull()?.items.orEmpty()
            _uiState.update { state ->
                state.copy(
                    faces = items.take(4).mapNotNull { it.chip ?: it.thumbUrl },
                    remainingFaces = (items.size - 4).coerceAtLeast(0),
                )
            }
        }
    }

    fun updateName(value: String) {
        _uiState.update { it.copy(draftName = value) }
    }

    fun saveName() {
        val cluster = _uiState.value.current ?: return
        val name = _uiState.value.draftName.trim()
        if (name.isEmpty()) return
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true) }
            repository.labelCluster(category, cluster.id, name)
                .onSuccess { advance("Named $name") }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            isSaving = false,
                            snackbar = error.message ?: "Could not save that name",
                        )
                    }
                }
        }
    }

    fun mergeInto(target: NamedCluster) {
        val cluster = _uiState.value.current ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true) }
            repository.mergeClusters(category, cluster.id, target.id)
                .onSuccess { advance("Merged into ${target.label ?: "that person"}") }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(isSaving = false, snackbar = error.message ?: "Could not merge")
                    }
                }
        }
    }

    fun notAPerson() {
        val cluster = _uiState.value.current ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true) }
            repository.dismissCluster(category, cluster.id)
                .onSuccess { advance("Dismissed") }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(isSaving = false, snackbar = error.message ?: "Could not dismiss")
                    }
                }
        }
    }

    fun skip() = advance(null)

    private fun advance(message: String?) {
        _uiState.update { state ->
            val next = state.index + 1
            state.copy(
                index = next,
                draftName = "",
                faces = emptyList(),
                remainingFaces = 0,
                isSaving = false,
                snackbar = message,
                finished = next >= state.queue.size,
            )
        }
        loadFaces()
    }

    fun dismissSnackbar() {
        _uiState.update { it.copy(snackbar = null) }
    }
}
