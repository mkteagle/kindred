package com.kindlingsignal.kindred.ui.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.model.ClusterCategory
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.data.model.Stats
import com.kindlingsignal.kindred.data.repository.KindredRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val repository: KindredRepository,
) : ViewModel() {

    data class LibraryUiState(
        val clusters: List<ClusterSummary> = emptyList(),
        val stats: Stats? = null,
        val selectedCategory: ClusterCategory = ClusterCategory.PEOPLE,
        val isLoading: Boolean = true,
        val error: String? = null,
    )

    private val _uiState = MutableStateFlow(LibraryUiState())
    val uiState: StateFlow<LibraryUiState> = _uiState.asStateFlow()

    init {
        loadStats()
        loadClusters(ClusterCategory.PEOPLE)
    }

    fun selectCategory(category: ClusterCategory) {
        if (category == _uiState.value.selectedCategory) return
        _uiState.value = _uiState.value.copy(selectedCategory = category)
        loadClusters(category)
    }

    private fun loadStats() {
        viewModelScope.launch {
            val result = repository.getStats()
            result.onSuccess { stats ->
                _uiState.value = _uiState.value.copy(stats = stats)
            }
        }
    }

    private fun loadClusters(category: ClusterCategory) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = repository.getClusters(category.apiName)
            result.onSuccess { response ->
                _uiState.value = _uiState.value.copy(
                    clusters = response.clusters.sortedByDescending { it.photoCount },
                    isLoading = false,
                )
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    clusters = emptyList(),
                    isLoading = false,
                    error = e.message ?: "Failed to load clusters",
                )
            }
        }
    }

    fun refresh() {
        loadStats()
        loadClusters(_uiState.value.selectedCategory)
    }
}
