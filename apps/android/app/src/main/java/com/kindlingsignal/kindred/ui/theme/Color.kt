package com.kindlingsignal.kindred.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Kindred palette — ported verbatim from the shared design handoff
 * (`design_handoff_kindred_apps/README.md`, "Shared foundations").
 *
 * Mobile ships dark first. Every value here is a literal from the handoff; do
 * not re-derive shades. Screens should consume `MaterialTheme.colorScheme` or
 * `KindredTheme.colors` rather than referencing this object directly.
 */
object KindredColors {

    // MARK: - Brand

    /** Logo stem, avatar gradients. */
    val Forest = Color(0xFF495645)

    /** The single accent: active tab, FAB, primary buttons, selection, scrubber. */
    val Terracotta = Color(0xFFCC7F61)

    /** Secondary accent, gradients, "since" eyebrows. */
    val Amber = Color(0xFFD59851)

    /** Success / upload complete. */
    val Sage = Color(0xFF8FA085)

    /** Text weight of sage — used for "Uploaded · analyzing" style copy. */
    val SageInk = Color(0xFFA8BB9C)

    /** Text and glyphs on terracotta/amber — never white. */
    val OnAccentInk = Color(0xFF14150F)

    // MARK: - Danger

    val DangerBorder = Color(0x59B73E57) // rgba(183,62,87,.35)
    val DangerFill = Color(0x1FB73E57)   // rgba(183,62,87,.12)
    val DangerInk = Color(0xFFE08095)

    // MARK: - Dark surfaces

    /** App background. */
    val Bg = Color(0xFF0C0E0C)

    /** Mobile bars (top app bar, navigation bar, viewer action bar). */
    val Chrome = Color(0xFA171A16) // rgba(23,26,22,.98)

    /** Bottom sheets. */
    val Sheet = Color(0xFF191C17)

    /** Photo viewer stage. */
    val ViewerStage = Color(0xFF080908)

    /** Tile placeholder while a photo loads. */
    val TilePlaceholder = Color(0xFF191C18)

    // MARK: - Hairlines and fills (translucent ink over the dark ground)

    val HairlineSoft = Color(0x14F1F1EC)   // rgba(241,241,236,.08)
    val Hairline = Color(0x1AF1F1EC)       // rgba(241,241,236,.10)
    val HairlineStrong = Color(0x29F1F1EC) // rgba(241,241,236,.16)

    val FillSoft = Color(0x0DF1F1EC)   // rgba(241,241,236,.05)
    val Fill = Color(0x12F1F1EC)       // rgba(241,241,236,.07)
    val FillStrong = Color(0x1CF1F1EC) // rgba(241,241,236,.11)

    // MARK: - Ink

    val InkPrimary = Color(0xFFF1F1EC)
    val InkSecondary = Color(0xFFCFD0C9)
    val InkBody = Color(0xFFB6B8B0)
    val InkMeta = Color(0xFF9BA095)

    // MARK: - Accent washes

    /** Navigation pill and contextual app bar ground. */
    val TerracottaPill = Color(0x38CC7F61) // rgba(204,127,97,.22)
    val TerracottaWash = Color(0x29CC7F61) // rgba(204,127,97,.16)
    val TerracottaEdge = Color(0x4DCC7F61) // rgba(204,127,97,.30)

    /** Cover badges and on-photo chips. */
    val OnPhotoScrim = Color(0xC20C0E0C) // rgba(12,14,12,.76)

    // MARK: - Opaque approximations
    //
    // Material 3 blends its own elevation tints behind component surfaces, so
    // the container roles need opaque colours. These are the translucent inks
    // above pre-composited over `Bg` so a Material surface and a hand-drawn
    // Kindred surface land on the same pixel value.

    val SurfaceFill = Color(0xFF171917)      // FillSoft over Bg
    val SurfaceFillStrong = Color(0xFF1F221E) // FillStrong over Bg
    val OutlineOpaque = Color(0xFF313230)     // HairlineStrong over Bg
    val OutlineSoftOpaque = Color(0xFF1F221F) // HairlineSoft over Bg
}
