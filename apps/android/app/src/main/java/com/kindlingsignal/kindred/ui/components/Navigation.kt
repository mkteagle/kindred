package com.kindlingsignal.kindred.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType

/** The four top-level destinations, shared by the bottom bar and the rail. */
enum class KindredDestination(
    val label: String,
    val icon: ImageVector,
    val selectedIcon: ImageVector,
) {
    HOME("Home", Icons.Outlined.Home, Icons.Filled.Home),
    LIBRARY("Library", Icons.Outlined.GridView, Icons.Filled.GridView),
    SEARCH("Search", Icons.Outlined.Search, Icons.Filled.Search),
    SETTINGS("Settings", Icons.Outlined.Settings, Icons.Filled.Settings),
}

/**
 * The bottom navigation bar: Material 3's `NavigationBar` with the pill
 * indicator, recoloured to Kindred's chrome and terracotta.
 *
 * Material's own indicator is the 62×32 pill the handoff asks for, so this
 * takes the component rather than redrawing it — `ANDROID.md` says Material
 * conventions win for navigation.
 */
@Composable
fun KindredNavigationBar(
    selected: KindredDestination,
    onSelect: (KindredDestination) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KindredTheme.colors
    Column(modifier = modifier.fillMaxWidth()) {
        KindredHairline()
        NavigationBar(
            containerColor = colors.chrome,
            tonalElevation = 0.dp,
            modifier = Modifier.fillMaxWidth(),
        ) {
            KindredDestination.entries.forEach { destination ->
                val active = destination == selected
                NavigationBarItem(
                    selected = active,
                    onClick = { onSelect(destination) },
                    icon = {
                        Icon(
                            imageVector = if (active) destination.selectedIcon else destination.icon,
                            // The label below carries the name, so the icon is
                            // decorative and must not be announced twice.
                            contentDescription = null,
                            modifier = Modifier.size(21.dp),
                        )
                    },
                    label = {
                        Text(
                            text = destination.label,
                            style = if (active) KindredType.NavLabel
                            else KindredType.body(11, androidx.compose.ui.text.font.FontWeight.Medium),
                        )
                    },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = colors.terracotta,
                        selectedTextColor = colors.terracotta,
                        indicatorColor = colors.terracottaPill,
                        unselectedIconColor = colors.inkMeta,
                        unselectedTextColor = colors.inkMeta,
                    ),
                )
            }
        }
    }
}

/**
 * The tablet navigation rail: the mark at the top, the upload FAB below it,
 * then the same four destinations with pill indicators.
 *
 * `ANDROID.md` screen 12 swaps the bottom bar for this at tablet widths; the
 * caller decides which to show from the current window width, so a fold or a
 * rotation moves between them without losing state.
 */
@Composable
fun KindredNavigationRail(
    selected: KindredDestination,
    onSelect: (KindredDestination) -> Unit,
    onUpload: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = KindredTheme.colors
    NavigationRail(
        containerColor = colors.bg,
        modifier = modifier
            .fillMaxHeight()
            .width(92.dp)
            .background(colors.bg),
        header = {
            Spacer(Modifier.height(4.dp))
            KindredMark(size = 22.dp)
            Spacer(Modifier.height(14.dp))
            UploadFab(onClick = onUpload, expanded = false)
            Spacer(Modifier.height(10.dp))
        },
    ) {
        Spacer(Modifier.height(4.dp))
        KindredDestination.entries.forEach { destination ->
            val active = destination == selected
            NavigationRailItem(
                selected = active,
                onClick = { onSelect(destination) },
                icon = {
                    Icon(
                        imageVector = if (active) destination.selectedIcon else destination.icon,
                        contentDescription = null,
                        modifier = Modifier.size(21.dp),
                    )
                },
                label = {
                    Text(
                        text = destination.label,
                        style = if (active) KindredType.NavLabel
                        else KindredType.body(11, androidx.compose.ui.text.font.FontWeight.Medium),
                    )
                },
                colors = NavigationRailItemDefaults.colors(
                    selectedIconColor = colors.terracotta,
                    selectedTextColor = colors.terracotta,
                    indicatorColor = colors.terracottaPill,
                    unselectedIconColor = colors.inkMeta,
                    unselectedTextColor = colors.inkMeta,
                ),
            )
        }
        Spacer(
            Modifier
                .weight(1f)
                .windowInsetsPadding(WindowInsets.navigationBars)
        )
    }
}

/** A 1dp vertical hairline, the rail's right edge. */
@Composable
fun KindredVerticalHairline(modifier: Modifier = Modifier) {
    Spacer(
        modifier = modifier
            .fillMaxHeight()
            .width(1.dp)
            .background(KindredTheme.colors.hairlineSoft)
    )
}

/**
 * The Kindred mark, drawn as the reversed logo would be: a forest-to-terracotta
 * petal on the dark chrome.
 *
 * TODO: replace with `uploads/logo.svg` from the design bundle once the vector
 * asset is added to `res/drawable`; the handoff ships SVG, which Android cannot
 * load directly, and the conversion is a design-asset task rather than a code
 * one.
 */
@Composable
fun KindredMark(
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 20.dp,
) {
    val colors = KindredTheme.colors
    Column(
        modifier = modifier.size(width = size, height = size * 1.1f),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(
            Modifier
                .size(width = size * 0.8f, height = size * 0.55f)
                .background(colors.terracotta, androidx.compose.foundation.shape.RoundedCornerShape(
                    topStartPercent = 50, topEndPercent = 50, bottomStartPercent = 50, bottomEndPercent = 10,
                ))
        )
        Spacer(
            Modifier
                .padding(top = 1.dp)
                .size(width = size * 0.16f, height = size * 0.45f)
                .background(colors.inkPrimary)
        )
    }
}
