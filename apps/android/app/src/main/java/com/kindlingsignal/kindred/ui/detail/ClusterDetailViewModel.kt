package com.kindlingsignal.kindred.ui.detail

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.data.model.Detection
import com.kindlingsignal.kindred.data.repository.KindredRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ClusterDetailViewModel @Inject constructor(
    private val repository: KindredRepository,
) : ViewModel() {

    data class DetailUiState(
        val cluster: ClusterSummary? = null,
        val detections: List<Detection> = emptyList(),
        val isLoading: Boolean = true,
        val error: String? = null,
    )

    private val _uiState = MutableStateFlow(DetailUiState())
    val uiState: StateFlow<DetailUiState> = _uiState.asStateFlow()

    fun load(category: String, clusterId: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            // Load cluster summary to get the ClusterSummary info
            val summaryResult = repository.getClusters(category)
            val cluster = summaryResult.getOrNull()?.clusters?.firstOrNull { it.id == clusterId }

            // Load detail detections
            val detailResult = repository.getClusterDetail(category, clusterId)
            val detections = detailResult.getOrNull()?.items ?: emptyList()

            _uiState.value = DetailUiState(
                cluster = cluster,
                detections = detections,
                isLoading = false,
                error = if (cluster == null) "Cluster not found" else null,
            )
        }
    }
}
