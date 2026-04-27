package com.kindlingsignal.kindred.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/**
 * Kindred corner radii — matching iOS KindredTheme.radius* tokens.
 */
object KindredShape {
    val RadiusXS = RoundedCornerShape(6.dp)     // image thumbs
    val RadiusSM = RoundedCornerShape(8.dp)     // default — cards, buttons, inputs
    val RadiusMD = RoundedCornerShape(12.dp)    // grouped lists
    val RadiusLG = RoundedCornerShape(18.dp)    // modals
    val RadiusXL = RoundedCornerShape(22.dp)    // sheet tops
    val Radius2XL = RoundedCornerShape(28.dp)   // big features
    val Pill = RoundedCornerShape(999.dp)       // pills / capsules

    // Convenience
    val Card = RadiusSM
    val Button = RadiusSM
}

/**
 * Raw radius dp values for use with custom shapes.
 */
object KindredRadius {
    val XS = 6.dp
    val SM = 8.dp
    val MD = 12.dp
    val LG = 18.dp
    val XL = 22.dp
    val XXL = 28.dp
}
