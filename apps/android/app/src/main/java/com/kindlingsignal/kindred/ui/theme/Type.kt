package com.kindlingsignal.kindred.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.kindlingsignal.kindred.R

/**
 * Kindred typography, per the shared handoff:
 *
 * - **Space Grotesk** 600/700 — screen titles, names, big numbers. Tight
 *   leading (.94–1.05), letter-spacing −.01/−.02em.
 * - **Instrument Sans** 400–800 — everything else.
 * - **IBM Plex Mono** 400–600 — counts, metadata, durations, keyboard hints.
 *   The mono eyebrow (10–11sp, 600, uppercase, tracking .18em, terracotta)
 *   sits above section titles and is required.
 *
 * Sizes are `sp` throughout so system font scaling is respected.
 *
 * Only four font files ship with the app (Space Grotesk Bold, Instrument Sans
 * Regular + Medium, IBM Plex Mono SemiBold). Space Grotesk is registered at
 * both 600 and 700 so the two title weights resolve without synthesis;
 * Instrument Sans 600–800 resolves to Medium plus Compose's synthetic weight,
 * which is the closest approximation available without shipping more faces.
 */

val SpaceGroteskFamily = FontFamily(
    Font(R.font.space_grotesk_bold, FontWeight.SemiBold),
    Font(R.font.space_grotesk_bold, FontWeight.Bold),
)

val InstrumentSansFamily = FontFamily(
    Font(R.font.instrument_sans_regular, FontWeight.Normal),
    Font(R.font.instrument_sans_medium, FontWeight.Medium),
)

val IBMPlexMonoFamily = FontFamily(
    Font(R.font.ibm_plex_mono_semibold, FontWeight.SemiBold),
)

/** Trim the extra leading Compose adds so the tight design leading survives. */
private val TightLeading = LineHeightStyle(
    alignment = LineHeightStyle.Alignment.Center,
    trim = LineHeightStyle.Trim.None,
)

/**
 * Named Kindred type styles. Screens should prefer `MaterialTheme.typography`
 * where a Material component reads it, and these where the design names a
 * specific Kindred role (eyebrow, meta, tile caption).
 */
object KindredType {

    // MARK: - Space Grotesk (titles, names, numbers)

    /** 30sp screen title — Home's "A quieter view of your week." */
    val ScreenTitle = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 30.sp,
        lineHeight = 29.sp, // .96 leading
        letterSpacing = (-0.02).em,
        lineHeightStyle = TightLeading,
    )

    /** 32sp person name on the person detail cover. */
    val PersonName = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 32.sp,
        lineHeight = 34.sp,
        letterSpacing = (-0.02).em,
        lineHeightStyle = TightLeading,
    )

    /** 21sp — sheet titles, tablet day headers, stat card numbers. */
    val TitleLarge = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 21.sp,
        lineHeight = 25.sp,
        letterSpacing = (-0.01).em,
    )

    /** 20sp top app bar title. */
    val AppBarTitle = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 24.sp,
        letterSpacing = (-0.01).em,
    )

    /** 18sp — contextual app bar count, "Review". */
    val TitleMedium = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp,
        lineHeight = 22.sp,
        letterSpacing = (-0.01).em,
    )

    /** 16sp day header. */
    val DayHeader = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 20.sp,
        letterSpacing = (-0.01).em,
    )

    /** 15sp — card titles, video poster titles, section headings. */
    val CardTitle = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        lineHeight = 19.sp,
        letterSpacing = (-0.01).em,
    )

    /** 13sp face-grid name. */
    val Name = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        lineHeight = 16.sp,
    )

    // MARK: - Instrument Sans (body, labels, buttons)

    val Body = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 21.sp,
    )

    val BodySmall = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 20.sp,
    )

    /** 14sp/600 — settings row titles, search-bar placeholder. */
    val Label = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 18.sp,
    )

    /** 15sp/800 — the primary pill buttons ("Upload all", "Save name"). */
    val ButtonLarge = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 15.sp,
        lineHeight = 19.sp,
    )

    /** 14sp/800 — FAB label, "Slideshow". */
    val Button = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 14.sp,
        lineHeight = 18.sp,
    )

    /** 13sp/700 — filter chips, "Review". */
    val ButtonSmall = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
        lineHeight = 17.sp,
    )

    /** 11sp/700 — navigation bar labels, viewer action labels. */
    val NavLabel = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 11.sp,
        lineHeight = 14.sp,
    )

    // MARK: - IBM Plex Mono (counts, metadata, eyebrows)

    /** The mono eyebrow. Uppercase it at the call site via `KindredEyebrow`. */
    val Eyebrow = TextStyle(
        fontFamily = IBMPlexMonoFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 10.sp,
        lineHeight = 13.sp,
        letterSpacing = 0.18.em,
    )

    /** 11sp mono — person detail stats, "38 named", "1 of 705". */
    val Meta = TextStyle(
        fontFamily = IBMPlexMonoFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.05.em,
    )

    /** 10sp mono — day subtitles, durations, file sizes, hint copy. */
    val MetaSmall = TextStyle(
        fontFamily = IBMPlexMonoFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 10.sp,
        lineHeight = 15.sp,
        letterSpacing = 0.05.em,
    )

    /** 9sp mono — face-grid counts, on-photo chips. */
    val Micro = TextStyle(
        fontFamily = IBMPlexMonoFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 9.sp,
        lineHeight = 12.sp,
        letterSpacing = 0.05.em,
    )

    // MARK: - Escape hatches

    /** Display font at an arbitrary size. */
    fun display(size: Int, weight: FontWeight = FontWeight.Bold) = TextStyle(
        fontFamily = SpaceGroteskFamily,
        fontWeight = weight,
        fontSize = size.sp,
        lineHeight = (size + 4).sp,
        letterSpacing = (-0.01).em,
    )

    /** Body font at an arbitrary size and weight. */
    fun body(size: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(
        fontFamily = InstrumentSansFamily,
        fontWeight = weight,
        fontSize = size.sp,
        lineHeight = (size + 5).sp,
    )

    /** Mono font at an arbitrary size. */
    fun mono(size: Int, tracking: TextUnit = 0.05.em) = TextStyle(
        fontFamily = IBMPlexMonoFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = size.sp,
        lineHeight = (size + 5).sp,
        letterSpacing = tracking,
    )
}

/**
 * The Material 3 type scale, expressed in Kindred's faces so any Material
 * component that reads `MaterialTheme.typography` is already on-brand.
 */
val KindredTypography = Typography(
    displayLarge = KindredType.ScreenTitle,
    displayMedium = KindredType.PersonName,
    displaySmall = KindredType.TitleLarge,

    headlineLarge = KindredType.TitleLarge,
    headlineMedium = KindredType.AppBarTitle,
    headlineSmall = KindredType.TitleMedium,

    titleLarge = KindredType.AppBarTitle,
    titleMedium = KindredType.DayHeader,
    titleSmall = KindredType.CardTitle,

    bodyLarge = KindredType.Body,
    bodyMedium = KindredType.BodySmall,
    bodySmall = KindredType.MetaSmall,

    labelLarge = KindredType.Button,
    labelMedium = KindredType.ButtonSmall,
    labelSmall = KindredType.NavLabel,
)
