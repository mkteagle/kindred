package com.kindlingsignal.kindred.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * The mono eyebrow — 10sp, 600, uppercase, tracking .18em, terracotta. It sits
 * above section titles and the handoff calls it required, so it lives here
 * rather than being spelled out per screen.
 */
@Composable
fun KindredEyebrow(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = KindredTheme.colors.terracotta,
) {
    Text(
        text = text.uppercase(),
        style = KindredType.Eyebrow,
        color = color,
        modifier = modifier,
    )
}

/** Mono metadata — counts, durations, place names, "since" lines. */
@Composable
fun KindredMeta(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = KindredTheme.colors.inkMeta,
    small: Boolean = true,
) {
    Text(
        text = text,
        style = if (small) KindredType.MetaSmall else KindredType.Meta,
        color = color,
        modifier = modifier,
    )
}

/**
 * A day header: Space Grotesk date, mono subtitle, optional trailing
 * affordance. The whole row is one heading for TalkBack so the reader can jump
 * between days.
 */
@Composable
fun KindredDayHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.semantics(mergeDescendants = true) { heading() },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = title,
                style = KindredType.DayHeader,
                color = KindredTheme.colors.inkPrimary,
            )
            if (subtitle != null) {
                Spacer(Modifier.width(8.dp))
                KindredMeta(subtitle)
            }
        }
        if (trailing != null) {
            Spacer(Modifier.weight(1f))
            trailing()
        }
    }
}

/**
 * A 16dp-radius stat card: a big Space Grotesk number over a mono label.
 * Reads to TalkBack as one phrase ("47 new moments") rather than two fragments.
 */
@Composable
fun KindredStatCard(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .clip(KindredShape.Medium)
            .background(KindredTheme.colors.fillSoft)
            .border(1.dp, KindredTheme.colors.hairline, KindredShape.Medium)
            .padding(horizontal = 14.dp, vertical = 13.dp)
            .semantics(mergeDescendants = true) { },
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = value,
            style = KindredType.TitleLarge,
            color = KindredTheme.colors.inkPrimary,
        )
        KindredMeta(label)
    }
}

/**
 * A circular avatar. `initial` is drawn on the forest→terracotta gradient the
 * handoff specifies when there is no image.
 */
@Composable
fun KindredAvatar(
    url: String?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    initial: String? = null,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(
                Brush.linearGradient(
                    listOf(KindredTheme.colors.forest, KindredTheme.colors.terracotta),
                )
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (url.isNullOrBlank() && !initial.isNullOrBlank()) {
            Text(
                text = initial.take(1).uppercase(),
                style = KindredType.display((size.value / 2.5f).toInt().coerceAtLeast(11)),
                color = Color(0xFFF4F3EE),
                modifier = Modifier.clearAndSetSemantics { },
            )
        } else {
            KindredImage(
                url = url,
                contentDescription = contentDescription,
                modifier = Modifier.size(size),
            )
        }
    }
}

/** A 1dp hairline, the app's only divider. */
@Composable
fun KindredHairline(modifier: Modifier = Modifier, inset: Dp = 0.dp) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = inset)
            .height(1.dp)
            .background(KindredTheme.colors.hairlineSoft)
            .clearAndSetSemantics { },
    )
}

/**
 * The bottom-to-top scrim under on-photo text (video posters, person covers).
 * Transparent to 85% ground, per the handoff's cover treatment.
 */
@Composable
fun photoScrimBrush(): Brush = Brush.verticalGradient(
    0.45f to Color.Transparent,
    1f to KindredTheme.colors.bg.copy(alpha = 0.85f),
)

/** An on-photo chip ground: `rgba(12,14,12,.76)` behind mono 9–10sp. */
@Composable
fun KindredOnPhotoChip(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        style = KindredType.Micro,
        color = KindredTheme.colors.inkPrimary,
        modifier = modifier
            .clip(KindredShape.Chip)
            .background(KindredTheme.colors.onPhotoScrim)
            .padding(horizontal = 6.dp, vertical = 3.dp),
    )
}

/** Empty-state copy, centred, used wherever a list can legitimately be empty. */
@Composable
fun KindredEmptyState(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = title,
            style = KindredType.CardTitle,
            color = KindredTheme.colors.inkPrimary,
        )
        Text(
            text = body,
            style = MaterialTheme.typography.bodyMedium,
            color = KindredTheme.colors.inkBody,
        )
    }
}
