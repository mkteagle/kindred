package com.kindlingsignal.kindred

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/**
 * Application class for Kindred Photos.
 * Annotated with @HiltAndroidApp to enable Hilt dependency injection.
 */
@HiltAndroidApp
class KindredApp : Application()
