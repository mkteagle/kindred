package com.kindlingsignal.kindred.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.data.model.TimelineMonth
import com.kindlingsignal.kindred.ui.components.*
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType
import com.kindlingsignal.kindred.util.formatTimelineMonth
import com.kindlingsignal.kindred.util.greetingTimeOfDay

/**
 * Home screen — scrollable feed matching the iOS HomeView.
 * Sections: greeting, memory wall, together link, worth finding,
 * people row, on-this-day card.
 */
@Composable
fun HomeScreen(
    onTogetherClick: () -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val clusters = uiState.clusters
    val timeline = uiState.timeline

    val scrollState = rememberScrollState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(KindredColors.Paper)
            .verticalScroll(scrollState)
            .statusBarsPadding(),
    ) {
        // App bar
        KindredTopBar()

        // Greeting block
        GreetingBlock()

        // Memory wall scatter
        MemoryWallScatter(timeline = timeline)

        // Together link
        TogetherLink(clusters = clusters, onClick = onTogetherClick)

        // Worth finding again
        WorthFindingSection(clusters = clusters)

        // People row
        PeopleRow(clusters = clusters)

        // On this day card
        OnThisDayCard(timeline = timeline)

        // Bottom spacer (tab bar + demo banner clearance)
        Spacer(modifier = Modifier.height(120.dp))
    }
}

// MARK: - Greeting Block

@Composable
private fun GreetingBlock() {
    Column(
        modifier = Modifier
            .padding(horizontal = 20.dp)
            .padding(top = 14.dp, bottom = 6.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        KindredEyebrow(
            text = greetingTimeOfDay(),
            color = KindredColors.Gold,
        )
        Text(
            text = "A quieter view\nof your week.",
            style = KindredType.display(34),
            color = KindredColors.Ash,
            lineHeight = KindredType.display(34).lineHeight,
        )
    }
}

// MARK: - Memory Wall Scatter

@Composable
private fun MemoryWallScatter(
    timeline: List<TimelineMonth>,
) {
    val recentPhotos = remember(timeline) {
        timeline.flatMap { it.photos }
            .mapNotNull { it.thumbUrl }
            .take(4)
    }

    val recentCount = timeline.firstOrNull()?.count ?: 0

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            .height(195.dp)
            .padding(horizontal = 14.dp)
            .padding(top = 16.dp, bottom = 4.dp),
    ) {
        val w = maxWidth

        if (recentPhotos.size >= 4) {
            // Scattered photo items
            ScatterPhoto(url = recentPhotos[0], x = w * 0.20f, y = 50.dp, size = w * 0.28f, rotation = -8f, zIndex = 1f)
            ScatterPhoto(url = recentPhotos[1], x = w * 0.72f, y = 30.dp, size = w * 0.30f, rotation = 6f, zIndex = 2f)
            ScatterPhoto(url = recentPhotos[2], x = w * 0.42f, y = 100.dp, size = w * 0.34f, rotation = -1f, zIndex = 5f)
            ScatterPhoto(url = recentPhotos[3], x = w * 0.75f, y = 110.dp, size = w * 0.26f, rotation = 4f, zIndex = 3f)
        } else {
            // Placeholder rectangles
            listOf(
                ScatterConfig(0.20f, 50.dp, 0.28f, -8f),
                ScatterConfig(0.72f, 30.dp, 0.30f, 6f),
                ScatterConfig(0.42f, 100.dp, 0.34f, -1f),
                ScatterConfig(0.75f, 110.dp, 0.26f, 4f),
            ).forEachIndexed { i, cfg ->
                Box(
                    modifier = Modifier
                        .offset(x = w * cfg.xFraction - (w * cfg.sizeFraction / 2), y = cfg.y - (w * cfg.sizeFraction * 1.25f / 2))
                        .graphicsLayer { rotationZ = cfg.rotation }
                        .shadow(14.dp, KindredShape.Card)
                        .size(w * cfg.sizeFraction, w * cfg.sizeFraction * 1.25f)
                        .clip(RoundedCornerShape(4.dp))
                        .background(KindredColors.Canvas),
                )
            }
        }

        // "THIS WEEK" badge
        Column(
            modifier = Modifier
                .offset(x = w * 0.72f - 50.dp, y = 125.dp)
                .shadow(11.dp, RoundedCornerShape(6.dp))
                .clip(RoundedCornerShape(6.dp))
                .background(KindredColors.Paper.copy(alpha = 0.94f))
                .border(1.dp, KindredColors.Line, RoundedCornerShape(6.dp))
                .padding(horizontal = 10.dp, vertical = 6.dp),
        ) {
            Text(
                text = "THIS WEEK",
                style = KindredType.mono(8).copy(letterSpacing = KindredType.Eyebrow.letterSpacing),
                color = KindredColors.Gold,
            )
            Spacer(modifier = Modifier.height(1.dp))
            Text(
                text = "$recentCount new moments",
                style = KindredType.display(12),
                color = KindredColors.Ash,
            )
        }
    }
}

@Composable
private fun BoxWithConstraintsScope.ScatterPhoto(
    url: String,
    x: Dp,
    y: Dp,
    size: Dp,
    rotation: Float,
    zIndex: Float,
) {
    val photoHeight = size * 1.25f
    Box(
        modifier = Modifier
            .offset(x = x - size / 2, y = y - photoHeight / 2)
            .graphicsLayer {
                rotationZ = rotation
                this.shadowElevation = 14f
            }
            .padding(5.dp)
            .shadow(14.dp, RoundedCornerShape(4.dp))
            .clip(RoundedCornerShape(4.dp))
            .background(KindredColors.Card.copy(alpha = 0.95f)),
    ) {
        DemoAwareImage(
            url = url,
            contentDescription = null,
            modifier = Modifier.size(size - 10.dp, photoHeight - 10.dp),
            contentScale = ContentScale.Crop,
        )
    }
}

private data class ScatterConfig(
    val xFraction: Float,
    val y: Dp,
    val sizeFraction: Float,
    val rotation: Float,
)

// MARK: - Together Link

@Composable
private fun TogetherLink(
    clusters: List<ClusterSummary>,
    onClick: () -> Unit = {},
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(top = 16.dp)
            .shadow(8.dp, KindredShape.RadiusMD, ambientColor = KindredColors.CardShadow, spotColor = KindredColors.CardShadow)
            .clip(KindredShape.RadiusMD)
            .background(KindredColors.Card)
            .border(1.dp, KindredColors.Line, KindredShape.RadiusMD)
            .clickable { onClick() }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Stacked avatar preview
        Box(
            modifier = Modifier.width(60.dp),
        ) {
            clusters.take(3).forEachIndexed { index, cluster ->
                KindredAvatar(
                    url = cluster.avatar ?: cluster.thumbUrl,
                    size = 32.dp,
                    borderWidth = 2.dp,
                    modifier = Modifier.offset(x = (index * 14).dp),
                )
            }
        }

        Spacer(modifier = Modifier.width(12.dp))

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = "Together",
                style = KindredType.CardTitle,
                color = KindredColors.Ash,
            )
            Text(
                text = "Find photos with multiple people",
                style = KindredType.Meta,
                color = KindredColors.Mist,
            )
        }

        Icon(
            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = KindredColors.Ember,
            modifier = Modifier.size(16.dp),
        )
    }
}

// MARK: - Worth Finding Again

@Composable
private fun WorthFindingSection(
    clusters: List<ClusterSummary>,
) {
    Column {
        KindredSectionHeader(
            eyebrow = "For you",
            title = "Worth finding again",
            trailingText = "See all \u2192",
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .padding(top = 14.dp, bottom = 8.dp),
        )

        LazyRow(
            contentPadding = PaddingValues(start = 20.dp, end = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(clusters.take(6)) { cluster ->
                ClusterCard(
                    cluster = cluster,
                    cardWidth = 200.dp,
                    imageHeight = 130.dp,
                )
            }
        }
    }
}

// MARK: - People Row

@Composable
private fun PeopleRow(
    clusters: List<ClusterSummary>,
) {
    Column {
        KindredSectionHeader(
            eyebrow = "People",
            title = "You keep coming back to",
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .padding(top = 22.dp, bottom = 8.dp),
        )

        LazyRow(
            contentPadding = PaddingValues(start = 20.dp, end = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            items(clusters.take(8)) { cluster ->
                Column(
                    modifier = Modifier.width(60.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    KindredAvatar(
                        url = cluster.avatar ?: cluster.thumbUrl,
                        size = 56.dp,
                    )
                    Text(
                        text = cluster.label?.split(" ")?.firstOrNull() ?: "?",
                        style = KindredType.Name,
                        color = KindredColors.Ash,
                        maxLines = 1,
                    )
                    Text(
                        text = "${cluster.photoCount}",
                        style = KindredType.Micro,
                        color = KindredColors.Mist,
                    )
                }
            }
        }
    }
}

// MARK: - On This Day Card

@Composable
private fun OnThisDayCard(
    timeline: List<TimelineMonth>,
) {
    val oldMonth = timeline.lastOrNull() ?: return

    val year = oldMonth.month.split("-").firstOrNull() ?: "2022"
    val monthFormatted = formatTimelineMonth(oldMonth.month)
    val title = "Moments from\n$monthFormatted"
    val photos = oldMonth.photos.take(3)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(top = 24.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(KindredColors.Canvas)
            .border(1.dp, KindredColors.Line, RoundedCornerShape(16.dp))
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        KindredEyebrow(
            text = "On this day \u00b7 $year",
            color = KindredColors.Ember,
        )

        Text(
            text = title,
            style = KindredType.H2,
            color = KindredColors.Ash,
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Thumbnail row
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                photos.forEach { photo ->
                    DemoAwareImage(
                        url = photo.thumbUrl,
                        contentDescription = photo.photoTitle,
                        modifier = Modifier
                            .size(52.dp)
                            .clip(RoundedCornerShape(6.dp)),
                        contentScale = ContentScale.Crop,
                    )
                }
            }

            Spacer(modifier = Modifier.weight(1f))

            // Action buttons
            Column(
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                // Play button
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(KindredColors.Ember)
                        .clickable { /* TODO: play memory */ }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.PlayArrow,
                        contentDescription = null,
                        tint = KindredColors.Paper,
                        modifier = Modifier.size(12.dp),
                    )
                    Text(
                        text = "Play",
                        style = KindredType.body(12, FontWeight.Bold),
                        color = KindredColors.Paper,
                    )
                }

                // Open button
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(KindredColors.Card)
                        .border(1.dp, KindredColors.Line, RoundedCornerShape(8.dp))
                        .clickable { /* TODO: open photo */ }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Open",
                        style = KindredType.body(12, FontWeight.Bold),
                        color = KindredColors.Ash,
                    )
                }
            }
        }
    }
}
