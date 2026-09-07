package com.kindlingsignal.kindred.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import coil.compose.AsyncImage
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.ui.theme.KindredTheme

/**
 * Every photo in the app goes through here.
 *
 * Three jobs: resolve `demo://` ids to the bundled drawables so demo mode works
 * with no server, paint the tile placeholder underneath so a loading grid is a
 * quiet field rather than a flash of background, and keep the content
 * description honest — a decorative tile inside a labelled parent passes null
 * and is cleared from the accessibility tree instead of announcing "image".
 */
@Composable
fun KindredImage(
    url: String?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
) {
    val placeholder = KindredTheme.colors.tilePlaceholder
    val semantics = if (contentDescription == null) {
        Modifier.clearAndSetSemantics { }
    } else {
        Modifier
    }

    Box(modifier = modifier.background(placeholder).then(semantics)) {
        val demoRes = url?.takeIf { DemoDataProvider.isDemoUrl(it) }
            ?.let { DemoDataProvider.drawableForDemoUrl(it) }

        when {
            demoRes != null -> Image(
                painter = painterResource(id = demoRes),
                contentDescription = contentDescription,
                modifier = Modifier.fillMaxSize(),
                contentScale = contentScale,
            )

            !url.isNullOrBlank() -> AsyncImage(
                model = url,
                contentDescription = contentDescription,
                modifier = Modifier.fillMaxSize(),
                contentScale = contentScale,
            )

            // No URL yet (no server configured, or a row with no NAS copy):
            // the placeholder ground above is the whole rendering.
            else -> Unit
        }
    }
}
