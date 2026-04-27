package com.kindlingsignal.kindred.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.data.model.ClusterCategory
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.ui.components.MasonryClusterCard
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Library screen with search bar, People/Pets/Vehicles chip tabs, stats summary,
 * and masonry grid of ClusterCards.
 * Matches iOS LibraryView.
 */
@Composable
fun LibraryScreen(
    onClusterClick: (category: String, clusterId: String) -> Unit = { _, _ -> },
    modifier: Modifier = Modifier,
) {
    var selectedCategory by rememberSaveable { mutableStateOf(ClusterCategory.PEOPLE) }
    var searchQuery by remember { mutableStateOf(TextFieldValue("")) }

    val allClusters = remember(selectedCategory) {
        if (DemoDataProvider.isActive) {
            DemoDataProvider.getClusterSummary(selectedCategory.apiName).clusters
                .sortedByDescending { it.photoCount }
        } else {
            emptyList()
        }
    }

    val clusters = remember(allClusters, searchQuery.text) {
        if (searchQuery.text.isEmpty()) allClusters
        else allClusters.filter {
            (it.label ?: "").contains(searchQuery.text, ignoreCase = true)
        }
    }

    val stats = remember {
        if (DemoDataProvider.isActive) DemoDataProvider.getStats() else null
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(KindredColors.Paper)
            .statusBarsPadding(),
    ) {
        // Top bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text(
                    text = "Library",
                    style = KindredType.Title,
                    color = KindredColors.Ash,
                )
                val totalDetections = (stats?.people?.detections ?: 0) +
                        (stats?.pets?.detections ?: 0) +
                        (stats?.vehicles?.detections ?: 0)
                val totalPhotos = (stats?.people?.photos ?: 0) +
                        (stats?.pets?.photos ?: 0) +
                        (stats?.vehicles?.photos ?: 0)
                Text(
                    text = "$totalDetections detections across $totalPhotos photos",
                    style = KindredType.Meta,
                    color = KindredColors.Mist,
                )
            }

            Spacer(modifier = Modifier.weight(1f))

            // Filter button
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(KindredColors.Card)
                    .border(1.dp, KindredColors.Line, CircleShape)
                    .clickable { /* TODO: sort filter */ },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Outlined.FilterList,
                    contentDescription = "Filter",
                    tint = KindredColors.Pine,
                    modifier = Modifier.size(16.dp),
                )
            }
        }

        // Search bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 6.dp, bottom = 4.dp)
                .clip(KindredShape.RadiusSM)
                .background(KindredColors.Card)
                .border(1.dp, KindredColors.Line, KindredShape.RadiusSM)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.Search,
                contentDescription = null,
                tint = KindredColors.Mist,
                modifier = Modifier.size(16.dp),
            )
            Box(modifier = Modifier.weight(1f)) {
                if (searchQuery.text.isEmpty()) {
                    Text(
                        text = "Find a named person\u2026",
                        style = KindredType.Caption,
                        color = KindredColors.Mist,
                    )
                }
                BasicTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    textStyle = KindredType.Caption.copy(color = KindredColors.Ash),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (searchQuery.text.isNotEmpty()) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Clear",
                    tint = KindredColors.Mist,
                    modifier = Modifier
                        .size(16.dp)
                        .clickable { searchQuery = TextFieldValue("") },
                )
            }
        }

        // Chip filter row
        Row(
            modifier = Modifier
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ClusterCategory.entries.forEach { category ->
                val isActive = selectedCategory == category
                val groupCount = when (category) {
                    ClusterCategory.PEOPLE -> stats?.people?.groups
                    ClusterCategory.PETS -> stats?.pets?.groups
                    ClusterCategory.VEHICLES -> stats?.vehicles?.groups
                } ?: 0

                CategoryChip(
                    label = category.displayName,
                    count = groupCount,
                    isActive = isActive,
                    onClick = { selectedCategory = category },
                )
            }
        }

        // Masonry grid
        if (clusters.isEmpty()) {
            // Empty state
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Text(
                        text = if (searchQuery.text.isNotEmpty()) "No matches"
                        else "No ${selectedCategory.displayName.lowercase()} yet",
                        style = KindredType.H3,
                        color = KindredColors.Ash,
                    )
                    Text(
                        text = if (searchQuery.text.isNotEmpty()) "Try a different name."
                        else "Sync your library to get started.",
                        style = KindredType.Body,
                        color = KindredColors.Mist,
                    )
                }
            }
        } else {
            val heights = listOf(160, 120, 140, 170, 130, 150)

            LazyVerticalStaggeredGrid(
                columns = StaggeredGridCells.Fixed(2),
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 14.dp),
                contentPadding = PaddingValues(bottom = 120.dp),
                verticalItemSpacing = 10.dp,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(clusters, key = { it.id }) { cluster ->
                    val index = clusters.indexOf(cluster)
                    MasonryClusterCard(
                        cluster = cluster,
                        imageHeight = heights[index % heights.size].dp,
                        modifier = Modifier.clickable {
                            onClusterClick(selectedCategory.apiName, cluster.id)
                        },
                    )
                }
            }
        }
    }
}

/**
 * Category chip -- active state uses Ash background, inactive uses Card.
 * Matches iOS KindredChip.
 */
@Composable
private fun CategoryChip(
    label: String,
    count: Int,
    isActive: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .clip(KindredShape.RadiusSM)
            .background(if (isActive) KindredColors.Ash else KindredColors.Card)
            .border(
                1.dp,
                if (isActive) KindredColors.Ash else KindredColors.Line,
                KindredShape.RadiusSM,
            )
            .clickable { onClick() }
            .padding(horizontal = 13.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Text(
            text = label,
            style = KindredType.body(13, androidx.compose.ui.text.font.FontWeight.Bold),
            color = if (isActive) KindredColors.Paper else KindredColors.Pine,
        )

        Text(
            text = "$count",
            style = KindredType.mono(10),
            color = if (isActive) KindredColors.Gold else KindredColors.Pine,
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(
                    if (isActive) KindredColors.Paper.copy(alpha = 0.18f)
                    else KindredColors.Forest.copy(alpha = 0.1f)
                )
                .padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}
