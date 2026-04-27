# Kindred Photos ProGuard rules

# Keep Retrofit interfaces
-keep,allowobfuscation interface com.kindlingsignal.kindred.data.api.KindredApi

# Keep data model classes (used by Gson)
-keep class com.kindlingsignal.kindred.data.model.** { *; }

# Gson
-keepattributes Signature
-keepattributes *Annotation*
-keep class com.google.gson.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# WorkManager + Hilt
-keep class * extends androidx.work.Worker
-keep class * extends androidx.work.ListenableWorker
