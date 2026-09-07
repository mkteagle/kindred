package com.kindlingsignal.kindred.ui.people

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.components.KindredBackIcon
import com.kindlingsignal.kindred.ui.components.KindredEmptyState
import com.kindlingsignal.kindred.ui.components.KindredFilterChip
import com.kindlingsignal.kindred.ui.components.KindredImage
import com.kindlingsignal.kindred.ui.components.KindredMeta
import com.kindlingsignal.kindred.ui.components.KindredPillButton
import com.kindlingsignal.kindred.ui.components.KindredTopAppBar
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType
import com.kindlingsignal.kindred.util.formatCount

/**
 * Screen 10 — Review / naming.
 *
 * The one place Material's own field style wins, per `ANDROID.md`: a filled
 * text field with 14dp top corners, a 2dp terracotta underline and a floating
 * "Name" label. Everything around it is Kindred's — the mono progress counter,
 * the 172dp circular cover, the reuse-a-name chips and the bottom action bar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewScreen(
    category: String,
    onBack: () -> Unit,
    snackbarHostState: SnackbarHostState,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: ReviewViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val colors = KindredTheme.colors

    LaunchedEffect(category) { viewModel.load(category) }

    state.snackbar?.let { message ->
        LaunchedEffect(message) {
            snackbarHostState.showSnackbar(message)
            viewModel.dismissSnackbar()
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(contentPadding),
    ) {
        KindredTopAppBar(
            title = "Review",
            navigationIcon = KindredBackIcon,
            navigationLabel = "Back",
            onNavigationClick = onBack,
            trailingMeta = if (state.queue.isEmpty()) null
            else "${state.position} of ${formatCount(state.queue.size)}",
        )

        LinearProgressIndicator(
            progress = { state.progress },
            color = colors.terracotta,
            trackColor = colors.hairline,
            drawStopIndicator = { },
            gapSize = 0.dp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp)
                .height(3.dp)
                .semantics {
                    contentDescription = "Group ${state.position} of ${state.queue.size}"
                },
        )

        val cluster = state.current
        if (cluster == null) {
            KindredEmptyState(
                title = if (state.isLoading) "Gathering groups" else "Everyone has a name",
                body = if (state.isLoading) "One moment." else "Nothing is waiting to be reviewed.",
                modifier = Modifier.weight(1f),
            )
            return@Column
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(8.dp))
            KindredImage(
                url = cluster.avatar ?: cluster.thumbUrl ?: cluster.photoUrl,
                contentDescription = "The face being reviewed",
                modifier = Modifier
                    .size(172.dp)
                    .clip(CircleShape),
            )
            Spacer(Modifier.height(12.dp))
            // TODO: the handoff's "first seen June 2019" needs a date range on
            // the cluster; only the photo count is available today.
            KindredMeta("${formatCount(cluster.photoCount)} photos")

            Spacer(Modifier.height(18.dp))
            Text(
                text = "Who is this?",
                style = KindredType.TitleLarge,
                color = colors.inkPrimary,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.height(14.dp))

            TextField(
                value = state.draftName,
                onValueChange = viewModel::updateName,
                label = { Text("Name", style = KindredType.MetaSmall) },
                placeholder = {
                    Text("Name this person", style = KindredType.body(16), color = colors.inkMeta)
                },
                singleLine = true,
                shape = KindredShape.FilledField,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(
                    onDone = { viewModel.saveName() },
                ),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = colors.fill,
                    unfocusedContainerColor = colors.fill,
                    focusedIndicatorColor = colors.terracotta,
                    unfocusedIndicatorColor = colors.hairlineStrong,
                    cursorColor = colors.terracotta,
                    focusedLabelColor = colors.terracotta,
                    unfocusedLabelColor = colors.inkMeta,
                    focusedTextColor = colors.inkPrimary,
                    unfocusedTextColor = colors.inkPrimary,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            if (state.nameSuggestions.isNotEmpty()) {
                Spacer(Modifier.height(14.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScrollable(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.nameSuggestions.forEach { suggestion ->
                        val label = suggestion.label ?: return@forEach
                        KindredFilterChip(
                            label = label,
                            selected = false,
                            onClick = { viewModel.updateName(label) },
                        )
                    }
                }
            }

            if (state.faces.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    state.faces.forEach { face ->
                        KindredImage(
                            url = face,
                            contentDescription = null,
                            modifier = Modifier
                                .size(54.dp)
                                .clip(KindredShape.Chip),
                        )
                    }
                    if (state.remainingFaces > 0) {
                        Box(
                            modifier = Modifier
                                .size(54.dp)
                                .clip(KindredShape.Chip)
                                .background(colors.fillStrong)
                                .semantics {
                                    contentDescription =
                                        "${state.remainingFaces} more faces in this group"
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = "+${formatCount(state.remainingFaces)}",
                                style = KindredType.MetaSmall,
                                color = colors.inkMeta,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(24.dp))
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.chrome)
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            KindredPillButton(
                label = "Save name",
                onClick = viewModel::saveName,
                minHeight = 48.dp,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KindredPillButton(
                    label = "Merge into…",
                    onClick = {
                        // Merging needs a target; the reuse chips are the
                        // shortest path to one, so an empty draft sends the
                        // reader back to them rather than opening a picker with
                        // nothing chosen.
                        state.nameSuggestions
                            .firstOrNull { it.label.equals(state.draftName.trim(), true) }
                            ?.let(viewModel::mergeInto)
                    },
                    filled = false,
                    minHeight = 44.dp,
                    modifier = Modifier.weight(1f),
                    contentDescription = "Merge this group into the person named above",
                )
                KindredPillButton(
                    label = "Not a person",
                    onClick = viewModel::notAPerson,
                    filled = false,
                    danger = true,
                    minHeight = 44.dp,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/** Chips scroll sideways rather than wrapping, as the handoff draws them. */
@Composable
private fun Modifier.horizontalScrollable(): Modifier =
    this.horizontalScroll(rememberScrollState())
