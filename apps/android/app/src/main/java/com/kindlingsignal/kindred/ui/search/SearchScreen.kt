package com.kindlingsignal.kindred.ui.search

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.data.model.DateField
import com.kindlingsignal.kindred.data.model.MediaFilter
import com.kindlingsignal.kindred.ui.components.KindredBackIcon
import com.kindlingsignal.kindred.ui.components.KindredEmptyState
import com.kindlingsignal.kindred.ui.components.KindredFilterChip
import com.kindlingsignal.kindred.ui.components.KindredMeta
import com.kindlingsignal.kindred.ui.components.KindredPersonChip
import com.kindlingsignal.kindred.ui.components.MosaicTile
import com.kindlingsignal.kindred.ui.components.photoMosaic
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType
import com.kindlingsignal.kindred.util.formatCount

/**
 * Screen 6 — Search, in its active state.
 *
 * A full-width bar with a back chevron, the live query and a clear ×; scope
 * chips including the "Taken ▾" menu that switches between the taken and added
 * date fields and picks a year; people chips from the named clusters; a mono
 * result count; then the 3-up results.
 */
@Composable
fun SearchScreen(
    onBack: () -> Unit,
    onPhotoClick: (List<MosaicTile>, Int) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: SearchViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val colors = KindredTheme.colors
    val focusRequester = remember { FocusRequester() }
    var dateMenuOpen by remember { mutableStateOf(false) }

    // Screen 6 is the bar's active state: it opens focused, with the keyboard up.
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = contentPadding,
    ) {
        item("bar") {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .clip(KindredShape.Pill)
                    .background(colors.fillStrong)
                    .defaultMinSize(minHeight = 52.dp)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                IconButton(onClick = onBack, modifier = Modifier.size(32.dp)) {
                    Icon(
                        imageVector = KindredBackIcon,
                        contentDescription = "Leave search",
                        tint = colors.inkPrimary,
                        modifier = Modifier.size(19.dp),
                    )
                }
                BasicTextField(
                    value = state.query,
                    onValueChange = viewModel::updateQuery,
                    singleLine = true,
                    textStyle = KindredType.body(15).copy(color = colors.inkPrimary),
                    cursorBrush = SolidColor(colors.terracotta),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { viewModel.searchNow() }),
                    modifier = Modifier
                        .weight(1f)
                        .focusRequester(focusRequester)
                        .semantics { contentDescription = "Search the way you remember it" },
                    decorationBox = { field ->
                        if (state.query.isEmpty()) {
                            Text(
                                text = "Search the way you remember it",
                                style = KindredType.body(15),
                                color = colors.inkMeta,
                            )
                        }
                        field()
                    },
                )
                if (state.query.isNotEmpty()) {
                    IconButton(onClick = viewModel::clear, modifier = Modifier.size(32.dp)) {
                        Icon(
                            imageVector = Icons.Filled.Close,
                            contentDescription = "Clear the search",
                            tint = colors.inkMeta,
                            modifier = Modifier.size(17.dp),
                        )
                    }
                }
            }
        }

        item("scope-chips") {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                KindredFilterChip(
                    label = "All",
                    selected = state.media == MediaFilter.ALL && state.year == null,
                    onClick = {
                        viewModel.setMedia(MediaFilter.ALL)
                        viewModel.setYear(null)
                    },
                )

                Box {
                    KindredFilterChip(
                        label = state.dateChipLabel,
                        selected = state.year != null,
                        hasMenu = true,
                        onClick = { dateMenuOpen = true },
                    )
                    DropdownMenu(
                        expanded = dateMenuOpen,
                        onDismissRequest = { dateMenuOpen = false },
                        containerColor = colors.sheet,
                    ) {
                        DateField.entries.forEach { field ->
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        text = field.label,
                                        style = KindredType.Label,
                                        color = if (field == state.dateField) colors.terracotta
                                        else colors.inkPrimary,
                                    )
                                },
                                onClick = {
                                    viewModel.setDateField(field)
                                    dateMenuOpen = false
                                },
                            )
                        }
                        DropdownMenuItem(
                            text = {
                                Text("Any year", style = KindredType.Label, color = colors.inkBody)
                            },
                            onClick = {
                                viewModel.setYear(null)
                                dateMenuOpen = false
                            },
                        )
                        state.years.forEach { bucket ->
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        text = "${bucket.year} · ${formatCount(bucket.count)}",
                                        style = KindredType.Label,
                                        color = if (bucket.year == state.year) colors.terracotta
                                        else colors.inkPrimary,
                                    )
                                },
                                onClick = {
                                    viewModel.setYear(bucket.year)
                                    dateMenuOpen = false
                                },
                            )
                        }
                    }
                }

                KindredFilterChip(
                    label = "Videos",
                    selected = state.media == MediaFilter.VIDEO,
                    onClick = {
                        viewModel.setMedia(
                            if (state.media == MediaFilter.VIDEO) MediaFilter.ALL
                            else MediaFilter.VIDEO
                        )
                    },
                )
            }
        }

        if (state.people.isNotEmpty()) {
            item("people-chips") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.people.forEach { person ->
                        KindredPersonChip(
                            name = person.label ?: "Unnamed",
                            avatarUrl = person.avatar,
                            filled = person.id == state.selectedPersonId,
                            onClick = { viewModel.togglePerson(person) },
                        )
                    }
                }
            }
        }

        if (state.hasSearched) {
            item("count") {
                KindredMeta(
                    text = "${formatCount(state.resultCount)} results · best match first",
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                )
            }
        }

        if (state.results.isEmpty()) {
            item("empty") {
                KindredEmptyState(
                    title = when {
                        state.isLoading -> "Looking"
                        state.hasSearched -> "Nothing matched"
                        else -> "Search the way you remember it"
                    },
                    body = state.error ?: when {
                        state.hasSearched -> "Try a different word, or drop a filter."
                        else -> "A place, a person, a thing in the photo — or all three."
                    },
                )
            }
        } else {
            photoMosaic(
                tiles = state.results,
                keyPrefix = "search",
                rowHeight = 112.dp,
                onTileClick = { tile ->
                    onPhotoClick(state.results, state.results.indexOf(tile))
                },
            )
        }

        item("tail") { Spacer(Modifier.height(120.dp)) }
    }
}
