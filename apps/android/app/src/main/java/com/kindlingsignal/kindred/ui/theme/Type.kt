package com.kindlingsignal.kindred.ui.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.kindlingsignal.kindred.R

/**
 * Kindred brand typography.
 * Display: Space Grotesk Bold
 * Body: Instrument Sans Regular/Medium
 * Mono: IBM Plex Mono SemiBold
 */

val SpaceGroteskFamily = FontFamily(
    Font(R.font.space_grotesk_bold, FontWeight.Bold),
)

val InstrumentSansFamily = FontFamily(
    Font(R.font.instrument_sans_regular, FontWeight.Normal),
    Font(R.font.instrument_sans_medium, FontWeight.Medium),
)

val IBMPlexMonoFamily = FontFamily(
    Font(R.font.ibm_plex_mono_semibold, FontWeight.SemiBold),
)

/**
 * Named type styles matching the iOS KindredTheme font tokens.
 */
object KindredType {
    // Display / Space Grotesk
    val H1 = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 30.sp,
        lineHeight = 34.sp,
    )
    val H2 = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 22.sp,
        lineHeight = 26.sp,
    )
    val H3 = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 24.sp,
    )
    val Title = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 18.sp,
        lineHeight = 22.sp,
    )
    val CardTitle = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 15.sp,
        lineHeight = 19.sp,
    )
    val Name = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
        lineHeight = 16.sp,
    )

    // Body / Instrument Sans
    val BodyLG = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 17.sp,
        lineHeight = 22.sp,
    )
    val Body = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 20.sp,
    )
    val Caption = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 17.sp,
    )
    val Button = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 15.sp,
        lineHeight = 20.sp,
    )
    val ButtonSM = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 18.sp,
    )
    val Label = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 18.sp,
    )

    // Mono / IBM Plex Mono
    val Eyebrow = TextStyle(
        fontFamily = IBMPlexMonoFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 10.sp,
        lineHeight = 13.sp,
        letterSpacing = 1.8.sp,
    )
    val Micro = TextStyle(
        fontFamily = IBMPlexMonoFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 9.sp,
        lineHeight = 12.sp,
    )
    val Meta = TextStyle(
        fontFamily = IBMPlexMonoFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 10.sp,
        lineHeight = 13.sp,
    )

    /** Display font at arbitrary size */
    fun display(size: Int) = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.Bold,
        fontSize = size.sp,
        lineHeight = (size + 4).sp,
    )

    /** Body font at arbitrary size and weight */
    fun body(size: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = weight,
        fontSize = size.sp,
        lineHeight = (size + 4).sp,
    )

    /** Mono font at arbitrary size */
    fun mono(size: Int) = TextStyle(
        fontFamily = IBMPlexMonoFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = size.sp,
        lineHeight = (size + 3).sp,
    )
}
