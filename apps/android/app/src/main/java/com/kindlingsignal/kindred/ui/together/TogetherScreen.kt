package com.kindlingsignal.kindred.ui.together

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.ui.components.DemoAwareImage
import com.kindlingsignal.kindred.ui.components.KindredAvatar
import com.kindlingsignal.kindred.ui.components.KindredEyebrow
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight

/**
 * Together feature screen — pick people to find photos where they appear together.
 * Matches iOS TogetherPickerView.
 */
@Composable
fun TogetherScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val peopleClusters = remember {
        if (DemoDataProvider.isActive) {
            DemoDataProvider.getClusterSummary("people").clusters
                .sortedByDescending { it.photoCount }
        } else emptyList()
    }

    var selectedIds by remember { mutableStateOf(setOf<String>()) }
    var searchQuery by remember { mutableStateOf(TextFieldValue("")) }

    val filteredPeople = remember(peopleClusters, searchQuery.text) {
        if (searchQuery.text.isEmpty()) peopleClusters
        else peopleClusters.filter {
            (it.label ?: "").contains(searchQuery.text, ignoreCase = true)
        }
    }

    val canSearch = selectedIds.size >= 2

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(KindredColors.Paper),
    ) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(4),
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(horizontal = 16.dp),
            contentPadding = PaddingValues(bottom = 120.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Top bar
            item(span = { GridItemSpan(maxLineSpan) }) {
                TopBar(
                    selectedCount = selectedIds.size,
                    totalCount = peopleClusters.size,
                    onBack = onBack,
                )
            }

            // Header section
            item(span = { GridItemSpan(maxLineSpan) }) {
                HeaderSection()
            }

            // Selected chips
            if (selectedIds.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    SelectedChipsRow(
                        clusters = peopleClusters,
                        selectedIds = selectedIds,
                        onRemove = { id -> selectedIds = selectedIds - id },
                        showHint = selectedIds.size < 2,
                    )
                }
            }

            // Search bar
            item(span = { GridItemSpan(maxLineSpan) }) {
                SearchBar(
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                )
            }

            // "HOUSEHOLD" eyebrow
            item(span = { GridItemSpan(maxLineSpan) }) {
                KindredEyebrow(
                    text = "Household \u00b7 ${peopleClusters.size} named",
                    color = KindredColors.Pine,
                    modifier = Modifier.padding(vertical = 4.dp),
                )
            }

            // People grid (4 columns)
            items(filteredPeople, key = { it.id }) { person ->
                val isSelected = selectedIds.contains(person.id)
                PersonTile(
                    person = person,
                    isSelected = isSelected,
                    onClick = {
                        selectedIds = if (isSelected) {
                            selectedIds - person.id
                        } else {
                            selectedIds + person.id
                        }
                    },
                )
            }

            // Recent pairings section
            if (peopleClusters.size >= 2) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    RecentPairingsSection(
                        clusters = peopleClusters,
                        onSelect = { ids -> selectedIds = ids },
                    )
                }
            }
        }

        // Sticky CTA at bottom
        StickyCTA(
            canSearch = canSearch,
            selectedCount = selectedIds.size,
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

@Composable
private fun TopBar(
    selectedCount: Int,
    totalCount: Int,
    onBack: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(34.dp)
                .clip(CircleShape)
                .background(KindredColors.Card)
                .border(1.dp, KindredColors.Line, CircleShape)
                .clickable { onBack() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = KindredColors.Ash,
                modifier = Modifier.size(14.dp),
            )
        }

        Spacer(modifier = Modifier.weight(1f))

        Text(
            text = "Together",
            style = KindredType.display(16),
            color = KindredColors.Ash,
        )

        Spacer(modifier = Modifier.weight(1f))

        Text(
            text = "$selectedCount / $totalCount",
            style = KindredType.mono(10),
            color = KindredColors.Mist,
        )
    }
}

@Composable
private fun HeaderSection() {
    Column(
        modifier = Modifier.padding(horizontal = 4.dp),
    ) {
        KindredEyebrow(text = "Find photos with\u2026")

        Spacer(modifier = Modifier.height(6.dp))

        Text(
            text = "Pick the people\nin the picture.",
            style = KindredType.display(28),
            color = KindredColors.Ash,
        )

        Spacer(modifier = Modifier.height(10.dp))

        Text(
            text = "Choose two or more \u2014 Kindred will surface every photo where they all appear together.",
            style = KindredType.Caption,
            color = KindredColors.Pine,
        )
    }
}

@Composable
private fun SelectedChipsRow(
    clusters: List<ClusterSummary>,
    selectedIds: Set<String>,
    onRemove: (String) -> Unit,
    showHint: Boolean,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(KindredColors.Ember.copy(alpha = 0.08f))
            .border(1.dp, KindredColors.Ember.copy(alpha = 0.2f), RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        selectedIds.forEach { id ->
            val cluster = clusters.firstOrNull { it.id == id } ?: return@forEach
            Row(
                modifier = Modifier
                    .padding(end = 8.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(KindredColors.Card)
                    .border(1.dp, KindredColors.LineDark, RoundedCornerShape(999.dp))
                    .padding(start = 4.dp, end = 10.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                KindredAvatar(
                    url = cluster.avatar ?: cluster.thumbUrl,
                    size = 22.dp,
                    borderWidth = 0.dp,
                )
                Text(
                    text = cluster.label?.split(" ")?.firstOrNull() ?: "?",
                    style = KindredType.display(12),
                    color = KindredColors.Ash,
                )
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Remove",
                    tint = KindredColors.Mist,
                    modifier = Modifier
                        .size(14.dp)
                        .clickable { onRemove(id) },
                )
            }
        }

        Spacer(modifier = Modifier.weight(1f))

        if (showHint) {
            Text(
                text = "+ ANY ONE MORE",
                style = KindredType.mono(10),
                color = KindredColors.Ember,
            )
        }
    }
}

@Composable
private fun SearchBar(
    query: TextFieldValue,
    onQueryChange: (TextFieldValue) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(KindredShape.RadiusSM)
            .background(KindredColors.Card)
            .border(1.dp, KindredColors.Line, KindredShape.RadiusSM)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            imageVector = Icons.Outlined.Search,
            contentDescription = null,
            tint = KindredColors.Mist,
            modifier = Modifier.size(14.dp),
        )

        Box(modifier = Modifier.weight(1f)) {
            if (query.text.isEmpty()) {
                Text(
                    text = "Search the household\u2026",
                    style = KindredType.Caption,
                    color = KindredColors.Mist,
                )
            }
            BasicTextField(
                value = query,
                onValueChange = onQueryChange,
                textStyle = KindredType.Caption.copy(color = KindredColors.Ash),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (query.text.isNotEmpty()) {
            Icon(
                imageVector = Icons.Filled.Close,
                contentDescription = "Clear",
                tint = KindredColors.Mist,
                modifier = Modifier
                    .size(14.dp)
                    .clickable { onQueryChange(TextFieldValue("")) },
            )
        }
    }
}

@Composable
private fun PersonTile(
    person: ClusterSummary,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .clickable { onClick() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box {
            // Avatar with selection border
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .shadow(
                        elevation = if (isSelected) 8.dp else 4.dp,
                        shape = CircleShape,
                        ambientColor = if (isSelected) KindredColors.Ember.copy(alpha = 0.2f) else KindredColors.CardShadow,
                        spotColor = if (isSelected) KindredColors.Ember.copy(alpha = 0.2f) else KindredColors.CardShadow,
                    )
                    .clip(CircleShape)
                    .border(
                        width = if (isSelected) 2.5.dp else 1.5.dp,
                        color = if (isSelected) KindredColors.Ember else KindredColors.Line,
                        shape = CircleShape,
                    ),
            ) {
                DemoAwareImage(
                    url = person.avatar ?: person.thumbUrl,
                    contentDescription = person.label,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
            }

            // Checkmark badge
            if (isSelected) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .offset(x = 2.dp, y = 2.dp)
                        .size(22.dp)
                        .clip(CircleShape)
                        .background(KindredColors.Ember)
                        .border(2.dp, Color.White, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Check,
                        contentDescription = "Selected",
                        tint = Color.White,
                        modifier = Modifier.size(10.dp),
                    )
                }
            }
        }

        Text(
            text = person.label?.split(" ")?.firstOrNull() ?: "?",
            style = KindredType.display(12),
            color = KindredColors.Ash,
            maxLines = 1,
        )

        Text(
            text = "${person.photoCount}",
            style = KindredType.mono(9),
            color = KindredColors.Mist,
        )
    }
}

@Composable
private fun RecentPairingsSection(
    clusters: List<ClusterSummary>,
    onSelect: (Set<String>) -> Unit,
) {
    // Build suggested pairings from top clusters
    val pairings = remember(clusters) {
        val top = clusters.take(6)
        val pairs = mutableListOf<Pair<ClusterSummary, ClusterSummary>>()
        for (i in top.indices) {
            for (j in (i + 1) until top.size) {
                pairs.add(top[i] to top[j])
                if (pairs.size >= 3) return@remember pairs
            }
        }
        pairs
    }

    if (pairings.isEmpty()) return

    Column(
        modifier = Modifier.padding(top = 8.dp),
    ) {
        KindredEyebrow(
            text = "Recent pairings",
            color = KindredColors.Pine,
            modifier = Modifier.padding(vertical = 8.dp),
        )

        pairings.forEach { (a, b) ->
            PairingRow(
                personA = a,
                personB = b,
                onClick = { onSelect(setOf(a.id, b.id)) },
            )
        }
    }
}

@Composable
private fun PairingRow(
    personA: ClusterSummary,
    personB: ClusterSummary,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .clip(KindredShape.RadiusSM)
            .background(KindredColors.Card)
            .border(1.dp, KindredColors.Line, KindredShape.RadiusSM)
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Stacked avatars
        Box(modifier = Modifier.width(44.dp)) {
            KindredAvatar(
                url = personA.avatar ?: personA.thumbUrl,
                size = 28.dp,
                borderWidth = 2.dp,
            )
            KindredAvatar(
                url = personB.avatar ?: personB.thumbUrl,
                size = 28.dp,
                borderWidth = 2.dp,
                modifier = Modifier.offset(x = 16.dp),
            )
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            Text(
                text = "${personA.label ?: "?"} & ${personB.label ?: "?"}",
                style = KindredType.display(13),
                color = KindredColors.Ash,
            )
            Text(
                text = "Tap to find shared photos",
                style = KindredType.mono(9),
                color = KindredColors.Mist,
            )
        }

        Text(
            text = "\u203a",
            style = KindredType.mono(11),
            color = KindredColors.Mist,
        )
    }
}

@Composable
private fun StickyCTA(
    canSearch: Boolean,
    selectedCount: Int,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
    ) {
        // Gradient fade
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(30.dp)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            KindredColors.Paper.copy(alpha = 0f),
                            KindredColors.Paper.copy(alpha = 0.95f),
                        ),
                    ),
                ),
        )

        // CTA button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 22.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(
                    if (canSearch) KindredColors.Ash
                    else KindredColors.Ash.copy(alpha = 0.1f)
                )
                .shadow(
                    elevation = if (canSearch) 16.dp else 0.dp,
                    shape = RoundedCornerShape(12.dp),
                    ambientColor = KindredColors.CardShadow,
                    spotColor = KindredColors.CardShadow,
                )
                .clickable(enabled = canSearch) { /* TODO: search together */ }
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .background(KindredColors.Paper.copy(alpha = 0.95f).takeIf { false } ?: Color.Transparent),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = "Show photos together",
                    style = KindredType.display(14),
                    color = if (canSearch) KindredColors.Paper else KindredColors.Mist,
                )
                if (canSearch) {
                    Text(
                        text = "SEARCHING $selectedCount PEOPLE",
                        style = KindredType.mono(9),
                        color = KindredColors.Paper.copy(alpha = 0.6f),
                    )
                }
            }

            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(
                        if (canSearch) KindredColors.Ember
                        else KindredColors.Ash.copy(alpha = 0.2f)
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                    contentDescription = "Search",
                    tint = Color.White,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
    }
}
