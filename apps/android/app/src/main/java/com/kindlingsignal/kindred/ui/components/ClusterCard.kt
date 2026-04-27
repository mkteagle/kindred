package com.kindlingsignal.kindred.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.data.model.ClusterSummary
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Horizontal carousel cluster card — used in "Worth finding again".
 * Shows cover image + name + photo count, matching iOS memoryCard.
 */
@Composable
fun ClusterCard(
    cluster: ClusterSummary,
    cardWidth: Dp = 200.dp,
    imageHeight: Dp = 130.dp,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .width(cardWidth)
            .shadow(
                elevation = 14.dp,
                shape = KindredShape.RadiusSM,
                ambientColor = KindredColors.CardShadow,
                spotColor = KindredColors.CardShadow,
            )
            .clip(KindredShape.RadiusSM)
            .background(KindredColors.Card)
            .border(1.dp, KindredColors.Line, KindredShape.RadiusSM),
    ) {
        // Cover image
        DemoAwareImage(
            url = cluster.photoUrl ?: cluster.thumbUrl ?: cluster.avatar,
            contentDescription = cluster.label ?: "Cluster",
            modifier = Modifier
                .fillMaxWidth()
                .height(imageHeight),
            contentScale = ContentScale.Crop,
        )

        // Label + count
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            Text(
                text = cluster.label ?: "Unnamed",
                style = KindredType.CardTitle,
                color = KindredColors.Ash,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "${cluster.photoCount} photos",
                style = KindredType.Meta,
                color = KindredColors.Mist,
            )
        }
    }
}

/**
 * Masonry-style cluster card for the Library grid.
 * Shows cover photo with a floating badge + name below.
 */
@Composable
fun MasonryClusterCard(
    cluster: ClusterSummary,
    imageHeight: Dp = 150.dp,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .shadow(
                elevation = 11.dp,
                shape = KindredShape.RadiusSM,
                ambientColor = KindredColors.CardShadow,
                spotColor = KindredColors.CardShadow,
            )
            .clip(KindredShape.RadiusSM)
            .background(KindredColors.Card)
            .border(1.dp, KindredColors.Line, KindredShape.RadiusSM),
    ) {
        // Cover photo with badge
        Box {
            DemoAwareImage(
                url = cluster.photoUrl ?: cluster.thumbUrl ?: cluster.avatar,
                contentDescription = cluster.label ?: "Cluster",
                modifier = Modifier
                    .fillMaxWidth()
                    .height(imageHeight),
                contentScale = ContentScale.Crop,
            )

            // Photo count badge
            PhotoCountBadge(
                count = cluster.photoCount,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(8.dp),
            )
        }

        // Name
        Text(
            text = cluster.label ?: "Unnamed",
            style = KindredType.CardTitle,
            color = KindredColors.Ash,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        )
    }
}

/**
 * Photo count badge — dark capsule with count.
 */
@Composable
fun PhotoCountBadge(
    count: Int,
    modifier: Modifier = Modifier,
) {
    Text(
        text = "$count photos",
        style = KindredType.mono(9),
        color = KindredColors.Paper,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(KindredColors.Ash.copy(alpha = 0.76f))
            .padding(horizontal = 7.dp, vertical = 4.dp),
    )
}

/**
 * Image composable that handles demo:// URLs by showing bundled drawables,
 * and falls back to Coil AsyncImage for real URLs.
 */
@Composable
fun DemoAwareImage(
    url: String?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
) {
    if (url != null && DemoDataProvider.isDemoUrl(url)) {
        val drawableRes = DemoDataProvider.drawableForDemoUrl(url)
        if (drawableRes != null) {
            androidx.compose.foundation.Image(
                painter = painterResource(id = drawableRes),
                contentDescription = contentDescription,
                modifier = modifier,
                contentScale = contentScale,
            )
        } else {
            Box(
                modifier = modifier.background(KindredColors.Canvas),
            )
        }
    } else if (url != null) {
        AsyncImage(
            model = url,
            contentDescription = contentDescription,
            modifier = modifier,
            contentScale = contentScale,
        )
    } else {
        Box(
            modifier = modifier.background(KindredColors.Canvas),
        )
    }
}
