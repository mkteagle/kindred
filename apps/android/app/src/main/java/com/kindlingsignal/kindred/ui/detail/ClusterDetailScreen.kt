package com.kindlingsignal.kindred.ui.detail

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.data.model.Detection
import com.kindlingsignal.kindred.ui.components.DemoAwareImage
import com.kindlingsignal.kindred.ui.components.KindredAvatar
import com.kindlingsignal.kindred.ui.components.KindredEyebrow
import com.kindlingsignal.kindred.ui.components.KindredStatCard
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Cluster detail screen showing the profile header, stats, and photo grid.
 * Matches iOS ClusterDetailView.
 */
@Composable
fun ClusterDetailScreen(
    category: String,
    clusterId: String,
    onBack: () -> Unit,
    onPhotoClick: (index: Int, photos: List<Detection>) -> Unit = { _, _ -> },
    modifier: Modifier = Modifier,
    viewModel: ClusterDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(category, clusterId) {
        viewModel.load(category, clusterId)
    }

    val cluster = uiState.cluster
    val detections = uiState.detections

    if (cluster == null) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .background(KindredColors.Paper),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "Cluster not found",
                style = KindredType.Body,
                color = KindredColors.Mist,
            )
        }
        return
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(KindredColors.Paper)
            .statusBarsPadding(),
    ) {
        // Top bar with back button + title
        TopBar(
            title = cluster.label ?: "Unnamed",
            onBack = onBack,
        )

        // Content in a scrollable grid
        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                bottom = 120.dp,
            ),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            // Profile header spans full width
            item(span = { GridItemSpan(maxLineSpan) }) {
                ProfileHeader(cluster = cluster)
            }

            // Stats row spans full width
            item(span = { GridItemSpan(maxLineSpan) }) {
                StatsRow(cluster = cluster)
            }

            // "ALL PHOTOS" eyebrow spans full width
            item(span = { GridItemSpan(maxLineSpan) }) {
                KindredEyebrow(
                    text = "All photos",
                    modifier = Modifier
                        .padding(horizontal = 4.dp)
                        .padding(top = 20.dp, bottom = 6.dp),
                )
            }

            // Photo grid — 3 columns
            items(detections, key = { it.id }) { detection ->
                val index = detections.indexOf(detection)
                DemoAwareImage(
                    url = detection.thumbUrl ?: detection.photoUrl,
                    contentDescription = detection.photoTitle ?: "Photo",
                    modifier = Modifier
                        .aspectRatio(1f)
                        .clip(KindredShape.RadiusXS)
                        .clickable { onPhotoClick(index, detections) },
                    contentScale = ContentScale.Crop,
                )
            }
        }
    }
}

@Composable
private fun TopBar(
    title: String,
    onBack: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Back button
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
                modifier = Modifier.size(16.dp),
            )
        }

        Spacer(modifier = Modifier.width(12.dp))

        Text(
            text = title,
            style = KindredType.display(16),
            color = KindredColors.Ash,
        )
    }
}

@Composable
private fun ProfileHeader(
    cluster: ClusterSummary,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp)
            .padding(top = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Avatar
        KindredAvatar(
            url = cluster.avatar ?: cluster.thumbUrl,
            size = 78.dp,
            borderWidth = 3.dp,
        )

        Column(
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            // Name
            Text(
                text = cluster.label ?: "Unnamed",
                style = KindredType.display(24),
                color = KindredColors.Ash,
            )

            // Meta line
            Text(
                text = "${cluster.photoCount} photos \u00b7 ${cluster.detCount} detections",
                style = KindredType.Meta,
                color = KindredColors.Mist,
                modifier = Modifier.padding(top = 6.dp),
            )

            // Confirmed badge
            if (cluster.label != null) {
                Row(
                    modifier = Modifier
                        .padding(top = 6.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(KindredColors.Forest.copy(alpha = 0.12f))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Text(
                        text = "\u25CF",
                        style = KindredType.mono(8),
                        color = KindredColors.Forest,
                    )
                    Text(
                        text = "CONFIRMED",
                        style = KindredType.Micro,
                        color = KindredColors.Forest,
                    )
                }
            }
        }
    }
}

@Composable
private fun StatsRow(
    cluster: ClusterSummary,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        KindredStatCard(
            value = "${cluster.photoCount}",
            label = "Photos",
            modifier = Modifier.weight(1f),
        )
        KindredStatCard(
            value = "${cluster.detCount}",
            label = "Detections",
            modifier = Modifier.weight(1f),
        )
    }
}
