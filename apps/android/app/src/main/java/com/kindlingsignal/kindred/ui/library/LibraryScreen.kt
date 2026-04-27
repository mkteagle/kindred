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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.data.model.ClusterCategory
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.ui.components.MasonryClusterCard
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Library screen with People/Pets/Vehicles chip tabs and a masonry grid.
 * Matches iOS LibraryView.
 */
@Composable
fun LibraryScreen(
    modifier: Modifier = Modifier,
) {
    var selectedCategory by rememberSaveable { mutableStateOf(ClusterCategory.PEOPLE) }

    val clusters = remember(selectedCategory) {
        if (DemoDataProvider.isActive) {
            DemoDataProvider.getClusterSummary(selectedCategory.apiName).clusters
                .sortedByDescending { it.photoCount }
        } else {
            emptyList()
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
                val photoCount = when (selectedCategory) {
                    ClusterCategory.PEOPLE -> stats?.people?.photos
                    ClusterCategory.PETS -> stats?.pets?.photos
                    ClusterCategory.VEHICLES -> stats?.vehicles?.photos
                } ?: 0
                Text(
                    text = "$photoCount photos",
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
                        text = "No ${selectedCategory.displayName.lowercase()} yet",
                        style = KindredType.H3,
                        color = KindredColors.Ash,
                    )
                    Text(
                        text = "Sync your library to get started.",
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
                    )
                }
            }
        }
    }
}

/**
 * Category chip — active state uses Ash background, inactive uses Card.
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
                .clip(androidx.compose.foundation.shape.RoundedCornerShape(999.dp))
                .background(
                    if (isActive) KindredColors.Paper.copy(alpha = 0.18f)
                    else KindredColors.Forest.copy(alpha = 0.1f)
                )
                .padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}
