package com.kindlingsignal.kindred.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.data.model.TimelineMonth
import com.kindlingsignal.kindred.data.repository.KindredRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repository: KindredRepository,
) : ViewModel() {

    data class HomeUiState(
        val clusters: List<ClusterSummary> = emptyList(),
        val timeline: List<TimelineMonth> = emptyList(),
        val isLoading: Boolean = true,
        val error: String? = null,
    )

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    fun loadData() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            // Load clusters and timeline in parallel
            val clustersResult = repository.getClusters("people")
            val timelineResult = repository.getTimeline()

            val clusters = clustersResult.getOrNull()?.clusters
                ?.sortedByDescending { it.photoCount }
                ?: emptyList()
            val timeline = timelineResult.getOrNull()?.months ?: emptyList()

            val error = when {
                clustersResult.isFailure && timelineResult.isFailure ->
                    "Failed to load data: ${clustersResult.exceptionOrNull()?.message}"
                else -> null
            }

            _uiState.value = HomeUiState(
                clusters = clusters,
                timeline = timeline,
                isLoading = false,
                error = error,
            )
        }
    }

    fun refresh() {
        loadData()
    }
}
