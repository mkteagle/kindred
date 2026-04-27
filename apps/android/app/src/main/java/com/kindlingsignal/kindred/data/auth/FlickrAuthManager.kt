package com.kindlingsignal.kindred.data.auth

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages the Flickr OAuth 1.0a flow for admin users.
 *
 * Flow:
 * 1. Opens Chrome Custom Tab to {baseUrl}/auth/flickr which initiates OAuth
 * 2. Flickr redirects back to kindred://auth/callback with tokens
 * 3. handleCallback() extracts the tokens and logs in via /auth/flickr-login
 *
 * Note: The backend handles the full OAuth dance (request token, authorize,
 * access token). The mobile app just opens the URL and receives the callback.
 */
@Singleton
class FlickrAuthManager @Inject constructor(
    private val sessionManager: SessionManager,
) {
    companion object {
        const val CALLBACK_SCHEME = "kindred"
        const val CALLBACK_HOST = "auth"
        const val CALLBACK_PATH = "/callback"
        const val CALLBACK_URL = "$CALLBACK_SCHEME://$CALLBACK_HOST$CALLBACK_PATH"
    }

    private val _isAuthenticating = MutableStateFlow(false)
    val isAuthenticating: StateFlow<Boolean> = _isAuthenticating.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /**
     * Start the Flickr OAuth flow by opening a Chrome Custom Tab.
     * The backend's /auth/flickr endpoint handles the OAuth dance.
     */
    fun startFlickrAuth(context: Context) {
        val baseUrl = sessionManager.baseUrl.value
        if (baseUrl.isBlank()) {
            _error.value = "No server configured. Please set up your server first."
            return
        }

        _isAuthenticating.value = true
        _error.value = null

        val authUrl = "$baseUrl/auth/flickr?callback=$CALLBACK_URL"
        val customTabsIntent = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()

        try {
            customTabsIntent.launchUrl(context, Uri.parse(authUrl))
        } catch (e: Exception) {
            // Fallback to regular browser
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(authUrl))
            context.startActivity(intent)
        }
    }

    /**
     * Handle the OAuth callback deep link.
     * Expected URL: kindred://auth/callback?flickr_user_id=...&oauth_token=...&oauth_secret=...
     */
    suspend fun handleCallback(uri: Uri): Boolean {
        val flickrUserId = uri.getQueryParameter("flickr_user_id")
        val oauthToken = uri.getQueryParameter("oauth_token")
        val oauthSecret = uri.getQueryParameter("oauth_secret")

        if (flickrUserId == null) {
            _error.value = "Missing Flickr user ID in callback"
            _isAuthenticating.value = false
            return false
        }

        // The actual API call is done by the repository/viewmodel
        // Store the extracted params so they can be used
        _flickrUserId.value = flickrUserId
        _flickrOauthToken.value = oauthToken
        _flickrOauthSecret.value = oauthSecret
        _isAuthenticating.value = false
        return true
    }

    fun clearAuth() {
        _isAuthenticating.value = false
        _error.value = null
        _flickrUserId.value = null
        _flickrOauthToken.value = null
        _flickrOauthSecret.value = null
    }

    // Temporary storage for callback params (consumed by ViewModel)
    private val _flickrUserId = MutableStateFlow<String?>(null)
    val flickrUserId: StateFlow<String?> = _flickrUserId.asStateFlow()

    private val _flickrOauthToken = MutableStateFlow<String?>(null)
    val flickrOauthToken: StateFlow<String?> = _flickrOauthToken.asStateFlow()

    private val _flickrOauthSecret = MutableStateFlow<String?>(null)
    val flickrOauthSecret: StateFlow<String?> = _flickrOauthSecret.asStateFlow()
}
