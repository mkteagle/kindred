package com.kindlingsignal.kindred.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

/**
 * Shape, per `ANDROID.md`.
 *
 * Android is the one platform that does **not** take the 8dp brand radius for
 * cards and sheets: it takes the Material shape scale (8/14/16/18/24/28dp), and
 * `ANDROID.md` says the platform convention wins here. Photo tiles still stay
 * tight at 4dp so the mosaic reads as one field — that is a Kindred rule that
 * holds on every platform.
 */
object KindredShape {
    /** Photo tiles — 4dp, tight. Never widen this. */
    val Tile = RoundedCornerShape(4.dp)

    /** Filter chips and the small mono affordances beside them. */
    val Chip = RoundedCornerShape(8.dp)

    /** Queue rows, the album row, the review text field's top corners. */
    val Small = RoundedCornerShape(14.dp)

    /** Stat cards, the review card, video poster cards, rail FAB. */
    val Medium = RoundedCornerShape(16.dp)

    /** Grouped settings surfaces and the extended FAB. */
    val Large = RoundedCornerShape(18.dp)

    /** Docked search bar, pill buttons. */
    val ExtraLarge = RoundedCornerShape(24.dp)

    /** Bottom sheet top corners. */
    val Sheet = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)

    /** Fully rounded — avatars, pills, the navigation indicator. */
    val Pill = RoundedCornerShape(percent = 50)

    /** The filled text field on the review screen: rounded top, flat bottom. */
    val FilledField = RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)
}

/** Raw radii for call sites that need a `Dp` rather than a `Shape`. */
object KindredRadius {
    val Tile = 4.dp
    val Chip = 8.dp
    val Small = 14.dp
    val Medium = 16.dp
    val Large = 18.dp
    val ExtraLarge = 24.dp
    val Sheet = 28.dp
}

/** The Material 3 shape scale, mapped onto Kindred's radii. */
val KindredShapes = Shapes(
    extraSmall = KindredShape.Chip,
    small = KindredShape.Small,
    medium = KindredShape.Medium,
    large = KindredShape.Large,
    extraLarge = KindredShape.ExtraLarge,
)
