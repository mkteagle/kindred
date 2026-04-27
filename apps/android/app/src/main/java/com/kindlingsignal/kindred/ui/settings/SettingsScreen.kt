package com.kindlingsignal.kindred.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.ui.components.KindredEyebrow
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Settings screen — placeholder for Phase 1.
 * Provides a "Try the demo" button and basic structure.
 */
@Composable
fun SettingsScreen(
    onEnterDemo: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(KindredColors.Paper)
            .statusBarsPadding()
            .padding(horizontal = 20.dp),
    ) {
        // Title
        Text(
            text = "Settings",
            style = KindredType.Title,
            color = KindredColors.Ash,
            modifier = Modifier.padding(top = 6.dp, bottom = 14.dp),
        )

        // Settings group
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(KindredShape.RadiusMD)
                .background(KindredColors.Card)
                .border(1.dp, KindredColors.Line, KindredShape.RadiusMD),
        ) {
            // Server URL
            SettingsRow(
                title = "Server",
                subtitle = "api.kindredphotos.app",
            )

            Divider()

            // Version
            SettingsRow(
                title = "Version",
                subtitle = "1.0.0 (Phase 1)",
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Demo mode section
        KindredEyebrow(
            text = "Developer",
            modifier = Modifier.padding(bottom = 8.dp),
        )

        if (!DemoDataProvider.isActive) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(KindredShape.RadiusMD)
                    .background(KindredColors.Card)
                    .border(1.dp, KindredColors.Line, KindredShape.RadiusMD)
                    .clickable { onEnterDemo() }
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Outlined.PlayCircle,
                    contentDescription = null,
                    tint = KindredColors.Forest,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Try the demo",
                        style = KindredType.Label,
                        color = KindredColors.Ash,
                    )
                    Text(
                        text = "Explore with sample data, no account needed",
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
        } else {
            Text(
                text = "Demo mode is active. Use the banner below to exit.",
                style = KindredType.Body,
                color = KindredColors.Mist,
            )
        }

        Spacer(modifier = Modifier.weight(1f))

        // Footer
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 120.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "Kindling Signal",
                style = KindredType.Micro,
                color = KindredColors.Muted,
            )
            Text(
                text = "v1.0.0",
                style = KindredType.Micro,
                color = KindredColors.Muted,
            )
        }
    }
}

@Composable
private fun SettingsRow(
    title: String,
    subtitle: String? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = KindredType.Label,
                color = KindredColors.Ash,
            )
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    style = KindredType.Meta,
                    color = KindredColors.Mist,
                )
            }
        }
    }
}

@Composable
private fun Divider() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 14.dp)
            .height(0.5.dp)
            .background(KindredColors.Line),
    )
}
