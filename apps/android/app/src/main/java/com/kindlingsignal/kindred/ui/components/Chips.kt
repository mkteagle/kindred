package com.kindlingsignal.kindred.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * The Kindred filter chip: 32dp tall, 8dp radius. Selected is a terracotta
 * fill with `#14150f` ink and a leading check; unselected is a 1dp hairline
 * outline.
 *
 * `ANDROID.md` pins the radius at 8dp for chips specifically, so this does not
 * take the Material shape scale that cards and sheets do — hence a hand-rolled
 * chip rather than `FilterChip`, whose ink, height and shape would all need
 * overriding anyway.
 *
 * Height is a *minimum*, so the chip grows with the system font scale instead
 * of clipping its label.
 */
@Composable
fun KindredFilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    /** Shows a trailing chevron — the "Taken 2026 ▾" menu chip. */
    hasMenu: Boolean = false,
) {
    val colors = KindredTheme.colors
    Row(
        modifier = modifier
            .clip(KindredShape.Chip)
            .then(
                if (selected) Modifier.background(colors.terracotta)
                else Modifier.border(1.dp, colors.hairlineStrong, KindredShape.Chip)
            )
            .clickable(role = Role.Tab, onClick = onClick)
            .defaultMinSize(minHeight = 32.dp)
            .padding(horizontal = 13.dp, vertical = 7.dp)
            .semantics { this.selected = selected },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (selected) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = null,
                tint = colors.onAccentInk,
                modifier = Modifier.size(14.dp),
            )
        }
        Text(
            text = label,
            style = KindredType.ButtonSmall,
            color = if (selected) colors.onAccentInk else colors.inkSecondary,
        )
        if (hasMenu) {
            Icon(
                imageVector = Icons.Filled.KeyboardArrowDown,
                contentDescription = null,
                tint = if (selected) colors.onAccentInk else colors.inkSecondary,
                modifier = Modifier.size(14.dp),
            )
        }
    }
}

/**
 * A person chip — 34dp, a 26dp avatar and a name. Used as a search scope and,
 * in the viewer, to say who is in the photo.
 */
@Composable
fun KindredPersonChip(
    name: String,
    avatarUrl: String?,
    modifier: Modifier = Modifier,
    filled: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val colors = KindredTheme.colors
    Row(
        modifier = modifier
            .clip(CircleShape)
            .then(
                if (filled) Modifier.background(colors.fillStrong)
                else Modifier.border(1.dp, colors.hairlineStrong, CircleShape)
            )
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .defaultMinSize(minHeight = 34.dp)
            .padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 4.dp)
            .semantics { contentDescription = name },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        KindredAvatar(
            url = avatarUrl,
            contentDescription = null,
            size = 26.dp,
            initial = name,
        )
        Text(
            text = name,
            style = KindredType.body(13, androidx.compose.ui.text.font.FontWeight.SemiBold),
            color = colors.inkPrimary,
        )
    }
}

/** A mono tag chip — "campfire", the object labels under the viewer stage. */
@Composable
fun KindredTagChip(
    label: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = label,
        style = KindredType.MetaSmall,
        color = KindredTheme.colors.inkSecondary,
        modifier = modifier
            .clip(CircleShape)
            .background(KindredTheme.colors.fill)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    )
}
