package com.kindlingsignal.kindred.util

import java.util.Calendar
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Greeting based on time of day — matches iOS HomeView logic.
 * Returns e.g. "Sunday evening", "Monday morning".
 */
fun greetingTimeOfDay(): String {
    val calendar = Calendar.getInstance()
    val dayFormat = SimpleDateFormat("EEEE", Locale.getDefault())
    val day = dayFormat.format(calendar.time)
    val hour = calendar.get(Calendar.HOUR_OF_DAY)

    val period = when (hour) {
        in 5..11 -> "morning"
        in 12..16 -> "afternoon"
        in 17..20 -> "evening"
        else -> "night"
    }

    return "$day $period"
}

/**
 * Format a timeline month string like "2022-08" into "August 2022".
 */
fun formatTimelineMonth(monthStr: String): String {
    val parts = monthStr.split("-")
    if (parts.size != 2) return monthStr
    val year = parts[0]
    val monthNum = parts[1].toIntOrNull() ?: return monthStr
    val monthNames = arrayOf(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    )
    val monthName = monthNames.getOrElse(monthNum - 1) { "Unknown" }
    return "$monthName $year"
}
