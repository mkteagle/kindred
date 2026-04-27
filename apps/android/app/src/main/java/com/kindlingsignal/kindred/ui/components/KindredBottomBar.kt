package com.kindlingsignal.kindred.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Bottom navigation bar with 4 tabs: Home, Library, Search, Settings.
 * Matches iOS KindredTabBar.
 */
@Composable
fun KindredBottomBar(
    selectedTab: Int,
    onTabSelected: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tabs = listOf(
        TabItem(0, "Home", Icons.Outlined.Home, Icons.Filled.Home),
        TabItem(1, "Library", Icons.Outlined.GridView, Icons.Filled.GridView),
        TabItem(2, "Search", Icons.Outlined.Search, Icons.Outlined.Search),
        TabItem(3, "Settings", Icons.Outlined.Tune, Icons.Outlined.Tune),
    )

    Row(
        modifier = modifier
            .fillMaxWidth()
            .drawBehind {
                // Top border line
                drawLine(
                    color = KindredColors.Line,
                    start = Offset(0f, 0f),
                    end = Offset(size.width, 0f),
                    strokeWidth = 0.5.dp.toPx(),
                )
            }
            .background(KindredColors.Paper.copy(alpha = 0.94f))
            .padding(horizontal = 14.dp)
            .padding(top = 8.dp)
            .navigationBarsPadding(),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        tabs.forEach { tab ->
            val isActive = selectedTab == tab.id
            val tint by animateColorAsState(
                targetValue = if (isActive) KindredColors.Ember else KindredColors.Mist,
                label = "tabColor",
            )

            Column(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(999.dp))
                    .then(
                        if (isActive) Modifier.background(KindredColors.Ember.copy(alpha = 0.13f))
                        else Modifier
                    )
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { onTabSelected(tab.id) }
                    .padding(vertical = 6.dp, horizontal = 14.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(
                    imageVector = if (isActive) tab.activeIcon else tab.icon,
                    contentDescription = tab.label,
                    tint = tint,
                    modifier = Modifier.size(22.dp),
                )
                Spacer(modifier = Modifier.height(3.dp))
                Text(
                    text = tab.label,
                    style = KindredType.body(10, if (isActive) FontWeight.Bold else FontWeight.Medium),
                    color = tint,
                    letterSpacing = KindredType.Meta.letterSpacing,
                )
            }
        }
    }
}

private data class TabItem(
    val id: Int,
    val label: String,
    val icon: ImageVector,
    val activeIcon: ImageVector,
)
