package com.kindlingsignal.kindred.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Kindred avatar — circular image with white border and shadow.
 * Matches iOS KindredAvatar.
 */
@Composable
fun KindredAvatar(
    url: String?,
    size: Dp = 56.dp,
    borderWidth: Dp = 2.dp,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .size(size)
            .shadow(
                elevation = 7.dp,
                shape = CircleShape,
                ambientColor = KindredColors.CardShadow,
                spotColor = KindredColors.CardShadow,
            )
            .clip(CircleShape)
            .border(borderWidth, KindredColors.Card, CircleShape),
    ) {
        DemoAwareImage(
            url = url,
            contentDescription = "Avatar",
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop,
        )
    }
}

/**
 * Eyebrow label — mono uppercase text. The brand's signature micro-label.
 * Matches iOS KindredEyebrow.
 */
@Composable
fun KindredEyebrow(
    text: String,
    modifier: Modifier = Modifier,
    color: androidx.compose.ui.graphics.Color = KindredColors.Ember,
) {
    Text(
        text = text.uppercase(),
        style = KindredType.Eyebrow,
        color = color,
        modifier = modifier,
    )
}

/**
 * Section header with eyebrow + title + optional trailing text.
 * Matches iOS KindredSectionHeader.
 */
@Composable
fun KindredSectionHeader(
    eyebrow: String,
    title: String,
    modifier: Modifier = Modifier,
    trailingText: String? = null,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            KindredEyebrow(text = eyebrow)
            if (trailingText != null) {
                Text(
                    text = trailingText,
                    style = KindredType.Meta,
                    color = KindredColors.Pine,
                )
            }
        }
        Text(
            text = title,
            style = KindredType.H2,
            color = KindredColors.Ash,
        )
    }
}

/**
 * Stat card — value + label in a bordered box.
 * Matches iOS KindredStatCard.
 */
@Composable
fun KindredStatCard(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .clip(KindredShape.RadiusSM)
            .background(KindredColors.Card)
            .border(1.dp, KindredColors.Line, KindredShape.RadiusSM)
            .padding(10.dp),
    ) {
        Text(
            text = value,
            style = KindredType.display(18),
            color = KindredColors.Ash,
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = label.uppercase(),
            style = KindredType.Micro.copy(letterSpacing = KindredType.Eyebrow.letterSpacing),
            color = KindredColors.Mist,
        )
    }
}
