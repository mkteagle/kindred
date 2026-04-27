package com.kindlingsignal.kindred.ui.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.model.SearchResult
import com.kindlingsignal.kindred.data.repository.KindredRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val repository: KindredRepository,
) : ViewModel() {

    data class SearchUiState(
        val query: String = "",
        val results: List<SearchResult> = emptyList(),
        val isLoading: Boolean = false,
        val error: String? = null,
    )

    private val _uiState = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null

    /**
     * Update the search query with debouncing (300ms delay).
     */
    fun updateQuery(query: String) {
        _uiState.value = _uiState.value.copy(query = query)
        searchJob?.cancel()

        if (query.isBlank()) {
            _uiState.value = _uiState.value.copy(results = emptyList(), isLoading = false, error = null)
            return
        }

        searchJob = viewModelScope.launch {
            delay(300) // debounce
            performSearch(query)
        }
    }

    /**
     * Perform search immediately (no debounce).
     */
    fun searchNow() {
        val query = _uiState.value.query
        if (query.isBlank()) return
        searchJob?.cancel()
        viewModelScope.launch {
            performSearch(query)
        }
    }

    private suspend fun performSearch(query: String) {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        val result = repository.search(query)
        result.onSuccess { results ->
            _uiState.value = _uiState.value.copy(
                results = results,
                isLoading = false,
            )
        }.onFailure { e ->
            _uiState.value = _uiState.value.copy(
                results = emptyList(),
                isLoading = false,
                error = e.message ?: "Search failed",
            )
        }
    }

    fun clearSearch() {
        searchJob?.cancel()
        _uiState.value = SearchUiState()
    }
}
