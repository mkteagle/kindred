package com.kindlingsignal.kindred.ui.people

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.data.model.Detection
import com.kindlingsignal.kindred.data.repository.KindredRepository
import com.kindlingsignal.kindred.ui.components.MosaicTile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PersonDetailViewModel @Inject constructor(
    private val repository: KindredRepository,
) : ViewModel() {

    data class PersonUiState(
        val name: String = "",
        val coverUrl: String? = null,
        val photoCount: Int = 0,
        val recent: List<MosaicTile> = emptyList(),
        val isLoading: Boolean = true,
        val error: String? = null,
    )

    private val _uiState = MutableStateFlow(PersonUiState())
    val uiState: StateFlow<PersonUiState> = _uiState.asStateFlow()

    fun load(category: String, clusterId: String) {
        viewModelScope.launch {
            val summary = repository.getClusters(category).getOrNull()
                ?.clusters?.firstOrNull { it.id == clusterId }
            val detail = repository.getClusterDetail(category, clusterId)

            val items = detail.getOrNull()?.items.orEmpty()
            _uiState.value = PersonUiState(
                name = summary?.label ?: "Unnamed",
                coverUrl = items.firstOrNull()?.photoUrl
                    ?: summary?.photoUrl ?: summary?.thumbUrl ?: summary?.avatar,
                photoCount = summary?.photoCount ?: items.size,
                recent = items.take(12).map(::toTile),
                isLoading = false,
                error = detail.exceptionOrNull()?.message.takeIf { items.isEmpty() },
            )
        }
    }

    private fun toTile(detection: Detection) = MosaicTile(
        id = detection.photoId,
        imageUrl = detection.thumbUrl ?: detection.photoUrl,
        label = detection.photoTitle?.takeIf { it.isNotBlank() } ?: "Photo",
    )
}
