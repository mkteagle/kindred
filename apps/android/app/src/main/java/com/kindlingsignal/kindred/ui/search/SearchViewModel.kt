package com.kindlingsignal.kindred.ui.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.api.MediaUrls
import com.kindlingsignal.kindred.data.model.DateField
import com.kindlingsignal.kindred.data.model.MediaFilter
import com.kindlingsignal.kindred.data.model.NamedCluster
import com.kindlingsignal.kindred.data.model.SearchResult
import com.kindlingsignal.kindred.data.model.YearBucket
import com.kindlingsignal.kindred.data.repository.KindredRepository
import com.kindlingsignal.kindred.ui.components.MosaicTile
import com.kindlingsignal.kindred.util.formatDuration
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val repository: KindredRepository,
    private val mediaUrls: MediaUrls,
) : ViewModel() {

    data class SearchUiState(
        val query: String = "",
        val media: MediaFilter = MediaFilter.ALL,
        val dateField: DateField = DateField.TAKEN,
        val year: Int? = null,
        val years: List<YearBucket> = emptyList(),
        val people: List<NamedCluster> = emptyList(),
        val selectedPersonId: String? = null,
        val results: List<MosaicTile> = emptyList(),
        val resultCount: Int = 0,
        val isLoading: Boolean = false,
        val error: String? = null,
        val hasSearched: Boolean = false,
    ) {
        /** "Taken 2026 ▾" / "Added ▾" — the chip's own label. */
        val dateChipLabel: String
            get() = listOfNotNull(dateField.label, year?.toString()).joinToString(" ")
    }

    private val _uiState = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null

    init {
        viewModelScope.launch {
            val years = repository.getLibraryYears().getOrNull().orEmpty()
            val people = repository.getNamedClusters("people").getOrNull().orEmpty()
            _uiState.update { it.copy(years = years, people = people.take(8)) }
        }
    }

    fun updateQuery(value: String) {
        _uiState.update { it.copy(query = value) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300) // debounce the keystrokes, not the facets
            runSearch()
        }
    }

    fun setMedia(media: MediaFilter) {
        _uiState.update { it.copy(media = media) }
        searchNow()
    }

    fun setDateField(field: DateField) {
        _uiState.update { it.copy(dateField = field) }
        searchNow()
    }

    fun setYear(year: Int?) {
        _uiState.update { it.copy(year = year) }
        searchNow()
    }

    fun togglePerson(cluster: NamedCluster) {
        _uiState.update {
            it.copy(selectedPersonId = if (it.selectedPersonId == cluster.id) null else cluster.id)
        }
        searchNow()
    }

    fun clear() {
        searchJob?.cancel()
        _uiState.update {
            SearchUiState(years = it.years, people = it.people)
        }
    }

    fun searchNow() {
        searchJob?.cancel()
        searchJob = viewModelScope.launch { runSearch() }
    }

    private suspend fun runSearch() {
        val state = _uiState.value
        // With no text and no facets there is nothing to ask for; showing the
        // whole library under a search bar would misrepresent it as a result.
        if (state.query.isBlank() && state.selectedPersonId == null &&
            state.year == null && state.media == MediaFilter.ALL
        ) {
            _uiState.update { it.copy(results = emptyList(), resultCount = 0, hasSearched = false) }
            return
        }

        _uiState.update { it.copy(isLoading = true, error = null) }
        repository.search(
            query = state.query,
            media = state.media,
            dateField = state.dateField,
            dateFrom = state.year?.let { "$it-01-01" },
            dateTo = state.year?.let { "$it-12-31" },
            clusterId = state.selectedPersonId,
            category = state.selectedPersonId?.let { "people" },
        ).onSuccess { results ->
            _uiState.update {
                it.copy(
                    results = results.map(::toTile),
                    resultCount = results.size,
                    isLoading = false,
                    hasSearched = true,
                )
            }
        }.onFailure { error ->
            _uiState.update {
                it.copy(
                    results = emptyList(),
                    resultCount = 0,
                    isLoading = false,
                    hasSearched = true,
                    error = error.message ?: "Search failed",
                )
            }
        }
    }

    private fun toTile(result: SearchResult) = MosaicTile(
        id = result.photoId,
        imageUrl = result.thumbUrl?.takeIf { it.isNotBlank() } ?: mediaUrls.thumb(result.photoId),
        label = result.photoTitle?.takeIf { it.isNotBlank() } ?: "Photo",
        isVideo = result.isVideo,
        durationLabel = formatDuration(result.durationSeconds),
    )
}
