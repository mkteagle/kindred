package com.kindlingsignal.kindred.ui.together

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.data.repository.KindredRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class TogetherViewModel @Inject constructor(
    private val repository: KindredRepository,
) : ViewModel() {

    private val _peopleClusters = MutableStateFlow<List<ClusterSummary>>(emptyList())
    val peopleClusters: StateFlow<List<ClusterSummary>> = _peopleClusters.asStateFlow()

    init {
        loadPeople()
    }

    private fun loadPeople() {
        viewModelScope.launch {
            val result = repository.getClusters("people")
            result.onSuccess { response ->
                _peopleClusters.value = response.clusters.sortedByDescending { it.photoCount }
            }
        }
    }
}
