package com.kindlingsignal.kindred

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import com.kindlingsignal.kindred.data.auth.FlickrAuthManager
import com.kindlingsignal.kindred.data.auth.SessionManager
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.ui.navigation.KindredNavigation
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Single Activity for the Kindred Photos Android app.
 * Uses Jetpack Compose for all UI via KindredNavigation.
 * Handles deep links for Flickr OAuth callback.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var sessionManager: SessionManager

    @Inject
    lateinit var flickrAuthManager: FlickrAuthManager

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        // Initialize session from DataStore
        lifecycleScope.launch {
            sessionManager.initialize()

            // Sync DemoDataProvider with persisted demo mode
            if (sessionManager.isDemoMode.value) {
                DemoDataProvider.activate()
            }
        }

        enableEdgeToEdge()

        // Handle deep link on cold start
        intent?.let { handleDeepLink(it) }

        setContent {
            KindredTheme {
                KindredNavigation()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    /**
     * Handle deep links for Flickr OAuth callback.
     * Expected: kindred://auth/callback?flickr_user_id=...&oauth_token=...&oauth_secret=...
     */
    private fun handleDeepLink(intent: Intent) {
        val uri = intent.data ?: return
        if (uri.scheme == FlickrAuthManager.CALLBACK_SCHEME &&
            uri.host == FlickrAuthManager.CALLBACK_HOST &&
            uri.path == FlickrAuthManager.CALLBACK_PATH
        ) {
            lifecycleScope.launch {
                flickrAuthManager.handleCallback(uri)
            }
        }
    }
}
