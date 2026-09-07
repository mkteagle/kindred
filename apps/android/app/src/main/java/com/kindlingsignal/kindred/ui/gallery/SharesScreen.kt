package com.kindlingsignal.kindred.ui.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.compose.material3.Text
import com.kindlingsignal.kindred.data.model.Share
import com.kindlingsignal.kindred.data.repository.KindredRepository
import com.kindlingsignal.kindred.ui.components.KindredBackIcon
import com.kindlingsignal.kindred.ui.components.KindredEmptyState
import com.kindlingsignal.kindred.ui.components.KindredMeta
import com.kindlingsignal.kindred.ui.components.KindredTopAppBar
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SharesViewModel @Inject constructor(
    private val repository: KindredRepository,
) : ViewModel() {

    data class SharesUiState(
        val shares: List<Share> = emptyList(),
        val isLoading: Boolean = true,
        val error: String? = null,
    )

    private val _uiState = MutableStateFlow(SharesUiState())
    val uiState: StateFlow<SharesUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.getShares()
                .onSuccess { _uiState.value = SharesUiState(shares = it, isLoading = false) }
                .onFailure {
                    _uiState.value = SharesUiState(
                        isLoading = false,
                        error = it.message ?: "Could not load shares",
                    )
                }
        }
    }
}

/**
 * The live shares, read-only.
 *
 * Revoking is deliberately not offered here: `DELETE /shares/{id}` breaks the
 * link immediately and for good, and a one-tap destructive action with no
 * confirmation is the wrong shape for a screen reached from a settings row.
 */
@Composable
fun SharesScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: SharesViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val colors = KindredTheme.colors

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = contentPadding,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item("bar") {
            KindredTopAppBar(
                title = "Shared links",
                navigationIcon = KindredBackIcon,
                navigationLabel = "Back",
                onNavigationClick = onBack,
            )
        }

        if (state.shares.isEmpty()) {
            item("empty") {
                KindredEmptyState(
                    title = if (state.isLoading) "Checking your shares" else "Nothing shared",
                    body = state.error ?: "Links you create appear here until you revoke them.",
                )
            }
        }

        items(state.shares, key = { it.id }) { share ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(KindredShape.Large)
                    .background(colors.fillSoft)
                    .border(1.dp, colors.hairline, KindredShape.Large)
                    .padding(16.dp)
                    .semantics(mergeDescendants = true) { },
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = share.label ?: share.albumName ?: "Shared photos",
                    style = KindredType.CardTitle,
                    color = colors.inkPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                share.photoCount?.let { KindredMeta("$it photos") }
                share.url?.let {
                    KindredMeta(it, color = colors.terracotta)
                }
            }
        }

        item("tail") { Spacer(Modifier.height(120.dp)) }
    }
}
