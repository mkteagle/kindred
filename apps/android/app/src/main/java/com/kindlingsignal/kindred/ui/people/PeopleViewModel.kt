package com.kindlingsignal.kindred.ui.people

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.data.repository.KindredRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Backs both the People screen and the Animals screen — the two differ only in
 * the cluster category they read and the copy on the review card.
 */
@HiltViewModel
class PeopleViewModel @Inject constructor(
    private val repository: KindredRepository,
) : ViewModel() {

    data class PeopleUiState(
        val named: List<ClusterSummary> = emptyList(),
        val unnamedCount: Int = 0,
        val isLoading: Boolean = true,
        val isRefreshing: Boolean = false,
        val error: String? = null,
    )

    private val _uiState = MutableStateFlow(PeopleUiState())
    val uiState: StateFlow<PeopleUiState> = _uiState.asStateFlow()

    private var category: String = "people"

    fun load(category: String, refreshing: Boolean = false) {
        this.category = category
        viewModelScope.launch {
            _uiState.update {
                it.copy(isLoading = !refreshing, isRefreshing = refreshing, error = null)
            }
            repository.getClusters(category)
                .onSuccess { response ->
                    val (named, unnamed) = response.clusters.partition { !it.label.isNullOrBlank() }
                    _uiState.value = PeopleUiState(
                        named = named.sortedByDescending { it.photoCount },
                        unnamedCount = unnamed.size,
                        isLoading = false,
                        isRefreshing = false,
                    )
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            error = error.message ?: "Could not load groups",
                        )
                    }
                }
        }
    }

    fun refresh() = load(category, refreshing = true)
}
