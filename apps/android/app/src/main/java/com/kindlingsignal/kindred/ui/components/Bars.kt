package com.kindlingsignal.kindred.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * The standard top app bar: a menu or back icon, a 20sp Space Grotesk title,
 * and trailing actions. Every icon-only button here takes an explicit content
 * description — nothing in this bar is safe to leave unlabelled.
 */
@Composable
fun KindredTopAppBar(
    title: String,
    modifier: Modifier = Modifier,
    navigationIcon: ImageVector? = null,
    navigationLabel: String? = null,
    onNavigationClick: (() -> Unit)? = null,
    trailingMeta: String? = null,
    actions: @Composable () -> Unit = {},
) {
    val colors = KindredTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (navigationIcon != null && onNavigationClick != null) {
            IconButton(onClick = onNavigationClick) {
                Icon(
                    imageVector = navigationIcon,
                    contentDescription = navigationLabel ?: "Navigate up",
                    tint = colors.inkPrimary,
                    modifier = Modifier.size(21.dp),
                )
            }
        } else {
            Spacer(Modifier.width(8.dp))
        }

        Text(
            text = title,
            style = KindredType.AppBarTitle,
            color = colors.inkPrimary,
            modifier = Modifier.semantics { heading() },
        )

        if (trailingMeta != null) {
            Spacer(Modifier.weight(1f))
            KindredMeta(trailingMeta, small = false, modifier = Modifier.padding(end = 12.dp))
        } else {
            Spacer(Modifier.weight(1f))
        }

        Row(verticalAlignment = Alignment.CenterVertically) { actions() }
    }
}

/** A labelled icon-only action for the app bars. */
@Composable
fun KindredIconAction(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: androidx.compose.ui.graphics.Color = KindredTheme.colors.inkSecondary,
) {
    IconButton(onClick = onClick, modifier = modifier) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = tint,
            modifier = Modifier.size(20.dp),
        )
    }
}

/** The overflow (vertical ellipsis) action, spelled out once. */
@Composable
fun KindredOverflowAction(onClick: () -> Unit, modifier: Modifier = Modifier) {
    KindredIconAction(Icons.Filled.MoreVert, "More options", onClick, modifier)
}

/** The menu (hamburger) navigation icon, spelled out once. */
val KindredMenuIcon: ImageVector get() = Icons.Filled.Menu

/** The back navigation icon, mirrored for RTL. */
val KindredBackIcon: ImageVector get() = Icons.AutoMirrored.Filled.ArrowBack

/**
 * The contextual app bar for multi-select: a terracotta wash, a close ×, the
 * count, and terracotta actions. It replaces the top app bar in place rather
 * than stacking, which is the Material pattern, and slides down so the
 * transition reads as a mode change.
 */
@Composable
fun SelectionAppBar(
    count: Int,
    onClose: () -> Unit,
    onShare: () -> Unit,
    onFavorite: () -> Unit,
    onDelete: () -> Unit,
    onOverflow: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KindredTheme.colors
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.terracottaWash)
            .windowInsetsPadding(WindowInsets.statusBars),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onClose) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Leave selection",
                    tint = colors.terracotta,
                    modifier = Modifier.size(21.dp),
                )
            }
            Text(
                text = "$count",
                style = KindredType.TitleMedium,
                color = colors.terracotta,
                modifier = Modifier.semantics {
                    contentDescription = if (count == 1) "1 photo selected"
                    else "$count photos selected"
                },
            )
            Spacer(Modifier.weight(1f))
            KindredIconAction(
                icon = Icons.Filled.Share,
                contentDescription = "Share selected",
                onClick = onShare,
                tint = colors.terracotta,
            )
            KindredIconAction(
                icon = Icons.Filled.FavoriteBorder,
                contentDescription = "Favorite selected",
                onClick = onFavorite,
                tint = colors.terracotta,
            )
            KindredIconAction(
                icon = Icons.Filled.Delete,
                contentDescription = "Delete selected",
                onClick = onDelete,
                tint = colors.terracotta,
            )
            KindredIconAction(
                icon = Icons.Filled.MoreVert,
                contentDescription = "More actions for selection",
                onClick = onOverflow,
                tint = colors.terracotta,
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(colors.terracottaEdge)
        )
    }
}

/**
 * The extended FAB for Upload: 56dp tall, 18dp radius, terracotta with
 * `#14150f` ink. Collapses to a round FAB in the tablet rail, where there is
 * no room for the label.
 */
@Composable
fun UploadFab(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    expanded: Boolean = true,
) {
    val colors = KindredTheme.colors
    if (expanded) {
        ExtendedFloatingActionButton(
            onClick = onClick,
            containerColor = colors.terracotta,
            contentColor = colors.onAccentInk,
            shape = KindredShape.Large,
            modifier = modifier.defaultMinSize(minHeight = 56.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.Add,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(9.dp))
            Text(text = "Upload", style = KindredType.Button)
        }
    } else {
        FloatingActionButton(
            onClick = onClick,
            containerColor = colors.terracotta,
            contentColor = colors.onAccentInk,
            shape = KindredShape.Medium,
            modifier = modifier.size(width = 56.dp, height = 52.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.Add,
                contentDescription = "Upload",
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

/**
 * The docked search bar on Home: 52dp tall, 26dp radius, a terracotta
 * magnifier and the placeholder "Search the way you remember it".
 *
 * It is a button, not a field: tapping it moves to the Search destination
 * where the bar takes its active state, which is how Material's docked search
 * bar behaves and what screen 6 of the handoff shows.
 */
@Composable
fun DockedSearchBar(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Search the way you remember it",
) {
    val colors = KindredTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(KindredShape.Pill)
            .background(colors.fill)
            .clickable(role = Role.Button, onClick = onClick)
            .defaultMinSize(minHeight = 52.dp)
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .semantics { contentDescription = "Search photos" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            imageVector = Icons.Outlined.Search,
            contentDescription = null,
            tint = colors.terracotta,
            modifier = Modifier.size(18.dp),
        )
        Text(
            text = placeholder,
            style = KindredType.body(14),
            color = colors.inkMeta,
        )
    }
}

/**
 * A 40dp pill button. Filled is the terracotta primary; outlined is the
 * hairline secondary. Used for "Slideshow" / "Together with…" and the sheet
 * footers.
 */
@Composable
fun KindredPillButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    filled: Boolean = true,
    danger: Boolean = false,
    minHeight: androidx.compose.ui.unit.Dp = 40.dp,
    contentDescription: String? = null,
) {
    val colors = KindredTheme.colors
    val shape = KindredShape.Pill
    Box(
        modifier = modifier
            .clip(shape)
            .then(
                when {
                    danger -> Modifier
                        .background(colors.dangerFill)
                        .border(1.dp, colors.dangerBorder, shape)

                    filled -> Modifier.background(colors.terracotta)
                    else -> Modifier.border(1.dp, colors.hairlineStrong, shape)
                }
            )
            .clickable(role = Role.Button, onClick = onClick)
            .defaultMinSize(minHeight = minHeight)
            .padding(horizontal = 18.dp, vertical = 10.dp)
            .then(
                if (contentDescription != null) {
                    Modifier.semantics { this.contentDescription = contentDescription }
                } else Modifier
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = if (filled && !danger) KindredType.Button
            else KindredType.body(14, androidx.compose.ui.text.font.FontWeight.Bold),
            color = when {
                danger -> colors.dangerInk
                filled -> colors.onAccentInk
                else -> colors.inkPrimary
            },
        )
    }
}

/**
 * Crossfades the standard bar out and the contextual bar in when a selection
 * starts, so the mode change is legible rather than an abrupt swap.
 */
@Composable
fun SwappableAppBar(
    selectionActive: Boolean,
    standard: @Composable () -> Unit,
    contextual: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.fillMaxWidth()) {
        AnimatedVisibility(
            visible = !selectionActive,
            enter = fadeIn(),
            exit = fadeOut(),
        ) { standard() }
        AnimatedVisibility(
            visible = selectionActive,
            enter = fadeIn() + slideInVertically { -it / 2 },
            exit = fadeOut() + slideOutVertically { -it / 2 },
        ) { contextual() }
    }
}
