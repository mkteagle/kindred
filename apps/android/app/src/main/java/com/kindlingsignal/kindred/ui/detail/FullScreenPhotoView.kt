package com.kindlingsignal.kindred.ui.detail

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.data.model.Detection
import com.kindlingsignal.kindred.ui.components.DemoAwareImage
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Full-screen photo viewer with swipe navigation between photos.
 * Black background, tap to toggle chrome, photo counter.
 * Matches iOS FullScreenPhotoView.
 */
@Composable
fun FullScreenPhotoView(
    photos: List<Detection>,
    initialIndex: Int = 0,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val pagerState = rememberPagerState(
        initialPage = initialIndex,
        pageCount = { photos.size },
    )
    var showChrome by remember { mutableStateOf(true) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
            .systemBarsPadding(),
    ) {
        // Photo pager
        HorizontalPager(
            state = pagerState,
            modifier = Modifier
                .fillMaxSize()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) { showChrome = !showChrome },
        ) { page ->
            val photo = photos[page]
            DemoAwareImage(
                url = photo.photoUrl,
                contentDescription = photo.photoTitle ?: "Photo",
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
            )
        }

        // Chrome overlay — top bar
        AnimatedVisibility(
            visible = showChrome,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.5f))
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Back button
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.15f))
                        .clickable { onDismiss() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Close",
                        tint = Color.White,
                        modifier = Modifier.size(16.dp),
                    )
                }

                Spacer(modifier = Modifier.width(12.dp))

                // Photo title
                Column(modifier = Modifier.weight(1f)) {
                    val currentPhoto = photos.getOrNull(pagerState.currentPage)
                    Text(
                        text = currentPhoto?.photoTitle ?: "Photo",
                        style = KindredType.CardTitle,
                        color = Color.White,
                        maxLines = 1,
                    )
                }

                // Counter
                Text(
                    text = "${pagerState.currentPage + 1} / ${photos.size}",
                    style = KindredType.mono(10),
                    color = Color.White.copy(alpha = 0.7f),
                )
            }
        }
    }
}

/**
 * Simpler variant for search results and timeline photos,
 * using url strings instead of Detection objects.
 */
@Composable
fun FullScreenPhotoViewSimple(
    photoUrls: List<String>,
    photoTitles: List<String>,
    initialIndex: Int = 0,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val pagerState = rememberPagerState(
        initialPage = initialIndex,
        pageCount = { photoUrls.size },
    )
    var showChrome by remember { mutableStateOf(true) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
            .systemBarsPadding(),
    ) {
        HorizontalPager(
            state = pagerState,
            modifier = Modifier
                .fillMaxSize()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) { showChrome = !showChrome },
        ) { page ->
            DemoAwareImage(
                url = photoUrls[page],
                contentDescription = photoTitles.getOrNull(page) ?: "Photo",
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
            )
        }

        AnimatedVisibility(
            visible = showChrome,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.5f))
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.15f))
                        .clickable { onDismiss() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Close",
                        tint = Color.White,
                        modifier = Modifier.size(16.dp),
                    )
                }

                Spacer(modifier = Modifier.width(12.dp))

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = photoTitles.getOrNull(pagerState.currentPage) ?: "Photo",
                        style = KindredType.CardTitle,
                        color = Color.White,
                        maxLines = 1,
                    )
                }

                Text(
                    text = "${pagerState.currentPage + 1} / ${photoUrls.size}",
                    style = KindredType.mono(10),
                    color = Color.White.copy(alpha = 0.7f),
                )
            }
        }
    }
}
