package com.kindlingsignal.kindred.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * Material3 color scheme mapped to Kindred brand colors.
 */
private val KindredLightColorScheme = lightColorScheme(
    primary = KindredColors.Ember,
    onPrimary = KindredColors.Paper,
    primaryContainer = KindredColors.EmberSoft,
    onPrimaryContainer = KindredColors.Ash,

    secondary = KindredColors.Gold,
    onSecondary = KindredColors.Ash,
    secondaryContainer = KindredColors.Canvas,
    onSecondaryContainer = KindredColors.Pine,

    tertiary = KindredColors.Forest,
    onTertiary = KindredColors.Paper,
    tertiaryContainer = KindredColors.MossMist,
    onTertiaryContainer = KindredColors.Forest,

    background = KindredColors.Paper,
    onBackground = KindredColors.Ash,

    surface = KindredColors.Card,
    onSurface = KindredColors.Ash,
    surfaceVariant = KindredColors.Canvas,
    onSurfaceVariant = KindredColors.Pine,

    outline = KindredColors.Line,
    outlineVariant = KindredColors.LineDark,

    error = KindredColors.Rosehip,
    onError = KindredColors.Paper,
)

/**
 * Direct color access — use `KindredTheme.colors.ember` etc.
 * This mirrors the iOS `KindredTheme.ember` pattern.
 */
data class KindredColorTokens(
    val paper: androidx.compose.ui.graphics.Color = KindredColors.Paper,
    val ash: androidx.compose.ui.graphics.Color = KindredColors.Ash,
    val canvas: androidx.compose.ui.graphics.Color = KindredColors.Canvas,
    val card: androidx.compose.ui.graphics.Color = KindredColors.Card,
    val ember: androidx.compose.ui.graphics.Color = KindredColors.Ember,
    val emberSoft: androidx.compose.ui.graphics.Color = KindredColors.EmberSoft,
    val gold: androidx.compose.ui.graphics.Color = KindredColors.Gold,
    val pine: androidx.compose.ui.graphics.Color = KindredColors.Pine,
    val mist: androidx.compose.ui.graphics.Color = KindredColors.Mist,
    val muted: androidx.compose.ui.graphics.Color = KindredColors.Muted,
    val forest: androidx.compose.ui.graphics.Color = KindredColors.Forest,
    val sage: androidx.compose.ui.graphics.Color = KindredColors.Sage,
    val lichen: androidx.compose.ui.graphics.Color = KindredColors.Lichen,
    val rosehip: androidx.compose.ui.graphics.Color = KindredColors.Rosehip,
    val slateBlue: androidx.compose.ui.graphics.Color = KindredColors.SlateBlue,
    val line: androidx.compose.ui.graphics.Color = KindredColors.Line,
    val lineDark: androidx.compose.ui.graphics.Color = KindredColors.LineDark,
    val cardShadow: androidx.compose.ui.graphics.Color = KindredColors.CardShadow,
)

val LocalKindredColors = staticCompositionLocalOf { KindredColorTokens() }

/**
 * Kindred theme composable — wraps Material3 with brand tokens.
 */
@Composable
fun KindredTheme(
    content: @Composable () -> Unit,
) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            window.statusBarColor = KindredColors.Paper.toArgb()
            window.navigationBarColor = KindredColors.Paper.toArgb()
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = true
                isAppearanceLightNavigationBars = true
            }
        }
    }

    CompositionLocalProvider(LocalKindredColors provides KindredColorTokens()) {
        MaterialTheme(
            colorScheme = KindredLightColorScheme,
            content = content,
        )
    }
}

/**
 * Theme accessor — `KindredTheme.colors.ember`, `KindredTheme.type.H1`, etc.
 */
object KindredTheme {
    val colors: KindredColorTokens
        @Composable
        get() = LocalKindredColors.current

    val type: KindredType
        get() = KindredType

    val shape: KindredShape
        get() = KindredShape
}
