package com.kindlingsignal.kindred.ui.search

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.data.model.SearchResult
import com.kindlingsignal.kindred.ui.components.DemoAwareImage
import com.kindlingsignal.kindred.ui.components.KindredEyebrow
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Search screen with search input, results grid, and empty state.
 * Matches iOS SearchView.
 */
@Composable
fun SearchScreen(
    onPhotoClick: (index: Int, urls: List<String>, titles: List<String>) -> Unit = { _, _, _ -> },
    modifier: Modifier = Modifier,
) {
    var query by remember { mutableStateOf(TextFieldValue("")) }

    val results = remember(query.text) {
        if (query.text.isNotEmpty() && DemoDataProvider.isActive) {
            DemoDataProvider.searchDemoPhotos(query.text)
        } else {
            emptyList()
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(KindredColors.Paper)
            .statusBarsPadding(),
    ) {
        // Page header
        Column(
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .padding(top = 10.dp, bottom = 4.dp),
        ) {
            KindredEyebrow(text = "Search")
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "What are you looking for?",
                style = KindredType.H2,
                color = KindredColors.Ash,
            )
        }

        // Search input
        SearchInput(
            query = query,
            onQueryChange = { query = it },
            onClear = {
                query = TextFieldValue("")
            },
        )

        // Content
        if (query.text.isNotEmpty() && results.isEmpty()) {
            // No results state
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = "No results for \"${query.text}\"",
                        style = KindredType.H3,
                        color = KindredColors.Ash,
                    )
                    Text(
                        text = "Try a different search term.",
                        style = KindredType.Body,
                        color = KindredColors.Mist,
                    )
                }
            }
        } else if (results.isNotEmpty()) {
            // Results grid
            SearchResultsGrid(
                results = results,
                onPhotoClick = { index ->
                    val urls = results.map { it.thumbUrl ?: it.photoUrl }
                    val titles = results.map { it.photoTitle ?: "Photo" }
                    onPhotoClick(index, urls, titles)
                },
            )
        } else {
            // Empty / hint state
            EmptySearchState()
        }
    }
}

@Composable
private fun SearchInput(
    query: TextFieldValue,
    onQueryChange: (TextFieldValue) -> Unit,
    onClear: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(top = 14.dp)
            .shadow(
                elevation = 11.dp,
                shape = KindredShape.RadiusSM,
                ambientColor = KindredColors.CardShadow,
                spotColor = KindredColors.CardShadow,
            )
            .clip(KindredShape.RadiusSM)
            .background(KindredColors.Card)
            .border(1.dp, KindredColors.LineDark, KindredShape.RadiusSM)
            .padding(horizontal = 14.dp)
            .height(46.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            imageVector = Icons.Outlined.Search,
            contentDescription = null,
            tint = KindredColors.Mist,
            modifier = Modifier.size(16.dp),
        )

        Box(modifier = Modifier.weight(1f)) {
            if (query.text.isEmpty()) {
                Text(
                    text = "People, places, or things\u2026",
                    style = KindredType.Body,
                    color = KindredColors.Mist,
                )
            }
            BasicTextField(
                value = query,
                onValueChange = onQueryChange,
                textStyle = KindredType.Body.copy(color = KindredColors.Ash),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (query.text.isNotEmpty()) {
            Icon(
                imageVector = Icons.Filled.Close,
                contentDescription = "Clear",
                tint = KindredColors.Mist,
                modifier = Modifier
                    .size(18.dp)
                    .clickable { onClear() },
            )
        } else {
            Text(
                text = "VOICE",
                style = KindredType.Micro,
                color = KindredColors.Pine,
            )
        }
    }
}

@Composable
private fun SearchResultsGrid(
    results: List<SearchResult>,
    onPhotoClick: (Int) -> Unit,
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        contentPadding = PaddingValues(top = 16.dp, bottom = 120.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // Results count eyebrow
        item(span = { GridItemSpan(maxLineSpan) }) {
            KindredEyebrow(
                text = "${results.size} results",
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
            )
        }

        items(results.size) { index ->
            val result = results[index]
            Box(
                modifier = Modifier
                    .aspectRatio(1f)
                    .clip(KindredShape.RadiusXS)
                    .clickable { onPhotoClick(index) },
            ) {
                DemoAwareImage(
                    url = result.thumbUrl ?: result.photoUrl,
                    contentDescription = result.photoTitle ?: "Photo",
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )

                // Photo title overlay at bottom
                if (result.photoTitle != null) {
                    Text(
                        text = result.photoTitle,
                        style = KindredType.mono(9),
                        color = KindredColors.Paper,
                        maxLines = 1,
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .fillMaxWidth()
                            .background(KindredColors.Ash.copy(alpha = 0.6f))
                            .padding(horizontal = 6.dp, vertical = 4.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun EmptySearchState() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(modifier = Modifier.weight(0.3f))

        Icon(
            imageVector = Icons.Outlined.Search,
            contentDescription = null,
            tint = KindredColors.Pine.copy(alpha = 0.4f),
            modifier = Modifier.size(44.dp),
        )

        Text(
            text = "Search your photos",
            style = KindredType.H3,
            color = KindredColors.Ash,
        )

        Text(
            text = "Try names, places, or things\u2026",
            style = KindredType.Body,
            color = KindredColors.Mist,
        )

        Spacer(modifier = Modifier.weight(0.7f))
    }
}
