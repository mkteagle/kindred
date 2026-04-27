package com.kindlingsignal.kindred.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Top app bar showing the Kindred logo/name and bell icon.
 * Matches iOS KindredAppBar.
 */
@Composable
fun KindredTopBar(
    onBellTap: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Logo + title
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // Placeholder logo circle (ember colored K)
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(7.dp))
                    .background(KindredColors.Ember),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "K",
                    style = KindredType.display(16),
                    color = KindredColors.Card,
                )
            }

            Text(
                text = "Kindred",
                style = KindredType.Title,
                color = KindredColors.Ash,
            )
        }

        Spacer(modifier = Modifier.weight(1f))

        // Bell icon
        Box(
            modifier = Modifier
                .size(34.dp)
                .clip(CircleShape)
                .background(KindredColors.Card)
                .border(1.dp, KindredColors.Line, CircleShape)
                .clickable { onBellTap() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Outlined.Notifications,
                contentDescription = "Notifications",
                tint = KindredColors.Pine,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}
