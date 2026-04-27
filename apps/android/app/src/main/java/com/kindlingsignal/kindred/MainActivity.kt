package com.kindlingsignal.kindred

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.ui.navigation.KindredNavigation
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import dagger.hilt.android.AndroidEntryPoint

/**
 * Single Activity for the Kindred Photos Android app.
 * Uses Jetpack Compose for all UI via KindredNavigation.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        // Start in demo mode for Phase 1 (no login flow yet)
        DemoDataProvider.activate()

        enableEdgeToEdge()

        setContent {
            KindredTheme {
                KindredNavigation()
            }
        }
    }
}
