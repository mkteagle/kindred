package com.kindlingsignal.kindred.ui.search

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Search screen with search input and results placeholder.
 * Full implementation will come in Phase 2; this provides the shell
 * and matches the Kindred design language.
 */
@Composable
fun SearchScreen(
    modifier: Modifier = Modifier,
) {
    var query by remember { mutableStateOf(TextFieldValue("")) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(KindredColors.Paper)
            .statusBarsPadding()
            .padding(horizontal = 20.dp),
    ) {
        // Title
        Text(
            text = "Search",
            style = KindredType.Title,
            color = KindredColors.Ash,
            modifier = Modifier.padding(top = 6.dp, bottom = 14.dp),
        )

        // Search input
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(KindredShape.RadiusSM)
                .background(KindredColors.Canvas)
                .border(1.dp, KindredColors.LineDark, KindredShape.RadiusSM)
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.Search,
                contentDescription = null,
                tint = KindredColors.Mist,
                modifier = Modifier.size(18.dp),
            )
            Box(modifier = Modifier.weight(1f)) {
                if (query.text.isEmpty()) {
                    Text(
                        text = "Search people, pets, places...",
                        style = KindredType.Body,
                        color = KindredColors.Mist,
                    )
                }
                BasicTextField(
                    value = query,
                    onValueChange = { query = it },
                    textStyle = KindredType.Body.copy(color = KindredColors.Ash),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        // Empty / hint state
        if (query.text.isEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Search,
                    contentDescription = null,
                    tint = KindredColors.Pine.copy(alpha = 0.3f),
                    modifier = Modifier.size(48.dp),
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Find anyone in your library",
                    style = KindredType.H3,
                    color = KindredColors.Ash,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Search by name, or try describing a scene.",
                    style = KindredType.Body,
                    color = KindredColors.Mist,
                )
            }
        }
    }
}
