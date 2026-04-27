package com.kindlingsignal.kindred.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayCircleFilled
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Demo mode banner — shown at the bottom of the screen during demo mode.
 * "Demo mode · exploring with sample data" + "Sign out" button.
 * Matches iOS DemoModeBanner.
 */
@Composable
fun DemoModeBanner(
    onExit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .drawBehind {
                // Top border
                drawLine(
                    color = KindredColors.Forest.copy(alpha = 0.2f),
                    start = Offset(0f, 0f),
                    end = Offset(size.width, 0f),
                    strokeWidth = 0.5.dp.toPx(),
                )
            }
            .background(KindredColors.Forest.copy(alpha = 0.08f))
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .navigationBarsPadding(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Filled.PlayCircleFilled,
            contentDescription = null,
            tint = KindredColors.Forest,
            modifier = Modifier.size(14.dp),
        )

        Spacer(modifier = Modifier.width(8.dp))

        Text(
            text = "Demo mode",
            style = KindredType.Meta,
            color = KindredColors.Pine,
        )

        Spacer(modifier = Modifier.width(6.dp))

        Text(
            text = "\u00b7",
            color = KindredColors.Mist,
        )

        Spacer(modifier = Modifier.width(6.dp))

        Text(
            text = "exploring with sample data",
            style = KindredType.Meta,
            color = KindredColors.Mist,
        )

        Spacer(modifier = Modifier.weight(1f))

        Text(
            text = "Sign out",
            style = KindredType.body(12, androidx.compose.ui.text.font.FontWeight.Bold),
            color = KindredColors.Ember,
            modifier = Modifier.clickable { onExit() },
        )
    }
}
