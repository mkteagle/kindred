package com.kindlingsignal.kindred.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * The Material 3 colour scheme, expressed in Kindred's palette. Screens read
 * `MaterialTheme.colorScheme` (or `KindredTheme.colors` for the roles Material
 * has no name for) so nothing hardcodes a hex value.
 *
 * Dark only, per the shared handoff: "mobile and desktop ship dark first". A
 * light theme is unspecified for mobile, so there is deliberately no light
 * scheme here rather than an invented one.
 */
private val KindredDarkColorScheme = darkColorScheme(
    primary = KindredColors.Terracotta,
    onPrimary = KindredColors.OnAccentInk,
    primaryContainer = KindredColors.Terracotta,
    onPrimaryContainer = KindredColors.OnAccentInk,
    inversePrimary = KindredColors.Terracotta,

    secondary = KindredColors.Amber,
    onSecondary = KindredColors.OnAccentInk,
    secondaryContainer = KindredColors.SurfaceFillStrong,
    onSecondaryContainer = KindredColors.InkPrimary,

    tertiary = KindredColors.Sage,
    onTertiary = KindredColors.OnAccentInk,
    tertiaryContainer = KindredColors.Forest,
    onTertiaryContainer = KindredColors.InkPrimary,

    background = KindredColors.Bg,
    onBackground = KindredColors.InkPrimary,

    surface = KindredColors.Bg,
    onSurface = KindredColors.InkPrimary,
    surfaceVariant = KindredColors.SurfaceFill,
    onSurfaceVariant = KindredColors.InkSecondary,
    surfaceTint = Color.Transparent,

    surfaceContainerLowest = KindredColors.Bg,
    surfaceContainerLow = KindredColors.SurfaceFill,
    surfaceContainer = KindredColors.Sheet,
    surfaceContainerHigh = KindredColors.Sheet,
    surfaceContainerHighest = KindredColors.SurfaceFillStrong,

    inverseSurface = KindredColors.InkPrimary,
    inverseOnSurface = KindredColors.Bg,

    outline = KindredColors.OutlineOpaque,
    outlineVariant = KindredColors.OutlineSoftOpaque,

    error = KindredColors.DangerInk,
    onError = KindredColors.OnAccentInk,
    errorContainer = KindredColors.DangerFill,
    onErrorContainer = KindredColors.DangerInk,

    scrim = KindredColors.Bg,
)

/**
 * The Kindred roles Material 3 has no slot for: translucent hairlines and
 * fills, the four ink weights, the chrome and viewer grounds, the accent
 * washes. Everything here is a token from the handoff, so a screen never has
 * to spell out an `0x…` literal.
 */
data class KindredColorTokens(
    val forest: Color = KindredColors.Forest,
    val terracotta: Color = KindredColors.Terracotta,
    val amber: Color = KindredColors.Amber,
    val sage: Color = KindredColors.Sage,
    val sageInk: Color = KindredColors.SageInk,
    val onAccentInk: Color = KindredColors.OnAccentInk,

    val dangerBorder: Color = KindredColors.DangerBorder,
    val dangerFill: Color = KindredColors.DangerFill,
    val dangerInk: Color = KindredColors.DangerInk,

    val bg: Color = KindredColors.Bg,
    val chrome: Color = KindredColors.Chrome,
    val sheet: Color = KindredColors.Sheet,
    val viewerStage: Color = KindredColors.ViewerStage,
    val tilePlaceholder: Color = KindredColors.TilePlaceholder,

    val hairlineSoft: Color = KindredColors.HairlineSoft,
    val hairline: Color = KindredColors.Hairline,
    val hairlineStrong: Color = KindredColors.HairlineStrong,
    val fillSoft: Color = KindredColors.FillSoft,
    val fill: Color = KindredColors.Fill,
    val fillStrong: Color = KindredColors.FillStrong,

    val inkPrimary: Color = KindredColors.InkPrimary,
    val inkSecondary: Color = KindredColors.InkSecondary,
    val inkBody: Color = KindredColors.InkBody,
    val inkMeta: Color = KindredColors.InkMeta,

    val terracottaPill: Color = KindredColors.TerracottaPill,
    val terracottaWash: Color = KindredColors.TerracottaWash,
    val terracottaEdge: Color = KindredColors.TerracottaEdge,
    val onPhotoScrim: Color = KindredColors.OnPhotoScrim,
)

val LocalKindredColors = staticCompositionLocalOf { KindredColorTokens() }

/**
 * The app theme. Wraps Material 3 with Kindred's colour scheme, type scale and
 * shape scale, and paints the system bars to match the dark ground.
 */
@Composable
fun KindredTheme(
    content: @Composable () -> Unit,
) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            // Edge-to-edge: the bars are transparent and the content draws
            // under them, so only the icon tint needs setting.
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
        }
    }

    CompositionLocalProvider(LocalKindredColors provides KindredColorTokens()) {
        MaterialTheme(
            colorScheme = KindredDarkColorScheme,
            typography = KindredTypography,
            shapes = KindredShapes,
            content = content,
        )
    }
}

/** `KindredTheme.colors.terracotta`, `KindredTheme.type.Eyebrow`, … */
object KindredTheme {
    val colors: KindredColorTokens
        @Composable
        get() = LocalKindredColors.current

    val type: KindredType
        get() = KindredType

    val shape: KindredShape
        get() = KindredShape
}
