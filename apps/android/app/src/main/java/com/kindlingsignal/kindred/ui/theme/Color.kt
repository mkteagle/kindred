package com.kindlingsignal.kindred.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Kindred brand palette — warm, editorial, family-photo-first.
 * Tokens lifted from the web app globals.css (source of truth).
 */
object KindredColors {
    // Brand Palette
    val Paper = Color(0xFFFBF4E7)       // Primary surface / backgrounds
    val Ash = Color(0xFF2A201B)          // Primary ink / text
    val Ash2 = Color(0xFF4A281A)         // Deep charcoal brown

    val Canvas = Color(0xFFF7EBD4)       // Secondary surface / panels
    val Card = Color(0xFFFFFDF8)         // Card surface — warm white

    val Ember = Color(0xFFC9551C)        // Primary accent — CTAs, badges
    val EmberSoft = Color(0xFFF28A4B)    // Secondary accent
    val Terracotta = Color(0xFFA84A1D)   // Eyebrow alt

    val Gold = Color(0xFFE9B85D)         // Beeswax glow, secondary CTA

    val Pine = Color(0xFF6D3C24)         // Secondary text / walnut
    val Mist = Color(0xFF7D553F)         // Tertiary text
    val Muted = Color(0xFF946F5B)        // Muted captions

    val Forest = Color(0xFF2F4A36)       // Success, confirmed states
    val Sage = Color(0xFF4A6B4F)         // Data accent
    val Lichen = Color(0xFF7A9072)       // Soft fills
    val MossMist = Color(0xFFCFD8B8)     // Tint background

    val Rosehip = Color(0xFFA4324C)      // Danger / dismiss
    val SlateBlue = Color(0xFF3B6582)    // Info / links

    // Semantic
    val Line = Color(0x1E4A281A)         // Hairline borders (12% opacity)
    val LineDark = Color(0x334A281A)     // Stronger borders (20% opacity)
    val CardShadow = Color(0x1E6D3C24)   // Card shadow (12% opacity)
    val CardShadowHeavy = Color(0x296D3C24) // Heavy shadow (16% opacity)
}
