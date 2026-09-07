package com.kindlingsignal.kindred.util

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Greeting based on time of day — "Friday afternoon", the Home eyebrow.
 */
fun greetingTimeOfDay(): String {
    val calendar = Calendar.getInstance()
    val day = SimpleDateFormat("EEEE", Locale.getDefault()).format(calendar.time)
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
 * Format a timeline month key like "2022-08" into "August 2022".
 */
fun formatTimelineMonth(monthStr: String): String {
    val parts = monthStr.split("-")
    if (parts.size != 2) return monthStr
    val monthNum = parts[1].toIntOrNull() ?: return monthStr
    val monthNames = arrayOf(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    )
    return "${monthNames.getOrElse(monthNum - 1) { monthStr }} ${parts[0]}"
}

// MARK: - Dates from the API
//
// The backend sends `COALESCE(taken_at, created_at)` stringified by psycopg,
// which is "YYYY-MM-DD HH:MM:SS(.ffffff)(+ZZ)". `photos.taken_at` is null for
// almost the whole library today, so most of these are upload dates; the
// backfill that populates `taken_at` changes the value, not the format, so
// nothing here needs revisiting when it lands.

private val apiDateFormats = listOf(
    "yyyy-MM-dd HH:mm:ss.SSSSSSXXX",
    "yyyy-MM-dd HH:mm:ssXXX",
    "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXX",
    "yyyy-MM-dd'T'HH:mm:ssXXX",
    "yyyy-MM-dd HH:mm:ss.SSSSSS",
    "yyyy-MM-dd HH:mm:ss",
    "yyyy-MM-dd'T'HH:mm:ss",
    "yyyy-MM-dd",
)

fun parseApiDate(value: String?): Date? {
    if (value.isNullOrBlank()) return null
    for (pattern in apiDateFormats) {
        val parsed = runCatching {
            SimpleDateFormat(pattern, Locale.US).apply { isLenient = false }.parse(value)
        }.getOrNull()
        if (parsed != null) return parsed
    }
    return null
}

/** "2026-06-14" — the key days are grouped by. */
fun dayKey(value: String?): String? =
    parseApiDate(value)?.let { SimpleDateFormat("yyyy-MM-dd", Locale.US).format(it) }

/** "Saturday, 14 June" — the Home day header. */
fun formatDayLong(value: String?): String =
    parseApiDate(value)?.let { SimpleDateFormat("EEEE, d MMMM", Locale.getDefault()).format(it) }
        ?: "Undated"

/** "Sat 14 June" — the Library day header. */
fun formatDayShort(value: String?): String =
    parseApiDate(value)?.let { SimpleDateFormat("EEE d MMMM", Locale.getDefault()).format(it) }
        ?: "Undated"

/** "14 June 2026" — the viewer's top line. */
fun formatDateFull(value: String?): String =
    parseApiDate(value)?.let { SimpleDateFormat("d MMMM yyyy", Locale.getDefault()).format(it) }
        ?: "Undated"

/** "21:48" — the viewer's second line. */
fun formatTimeOfDay(value: String?): String? =
    parseApiDate(value)?.let { SimpleDateFormat("HH:mm", Locale.getDefault()).format(it) }

/** "0:42", "1:18", "1:02:04" — video durations in the mono metadata voice. */
fun formatDuration(seconds: Double?): String? {
    if (seconds == null || seconds <= 0) return null
    val total = seconds.toLong()
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s)
    else String.format(Locale.US, "%d:%02d", m, s)
}

/** "1,284,910" — counts in the mono voice, grouped for readability. */
fun formatCount(value: Int): String = String.format(Locale.getDefault(), "%,d", value)

/** The ISO date a year's worth of "this year" filtering starts from. */
fun startOfCurrentYear(): String {
    val year = Calendar.getInstance().get(Calendar.YEAR)
    return "$year-01-01"
}
