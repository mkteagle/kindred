package com.kindlingsignal.kindred.ui.auth

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.auth.FlickrAuthManager
import com.kindlingsignal.kindred.data.auth.SessionManager
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.data.repository.KindredRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val repository: KindredRepository,
    private val sessionManager: SessionManager,
    private val flickrAuthManager: FlickrAuthManager,
) : ViewModel() {

    data class AuthUiState(
        val isLoggingIn: Boolean = false,
        val isFlickrLoggingIn: Boolean = false,
        val isDemoLoading: Boolean = false,
        val error: String? = null,
        val loginSuccess: Boolean = false,
    )

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    val isLoggedIn = sessionManager.isLoggedIn
    val isDemoMode = sessionManager.isDemoMode
    val hasBaseUrl = sessionManager.hasBaseUrl

    /**
     * Member login with username/password.
     */
    fun login(username: String, password: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoggingIn = true, error = null)

            val result = repository.login(username, password)
            result.onSuccess { response ->
                sessionManager.saveSession(
                    token = response.session,
                    userId = response.user.id,
                    username = response.user.username,
                    displayName = response.user.displayName,
                    role = response.user.role,
                    avatarUrl = response.user.avatarUrl,
                )
                DemoDataProvider.deactivate()
                _uiState.value = _uiState.value.copy(isLoggingIn = false, loginSuccess = true)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    isLoggingIn = false,
                    error = e.message ?: "Login failed",
                )
            }
        }
    }

    /**
     * Start Flickr OAuth flow (opens Chrome Custom Tab).
     */
    fun startFlickrLogin(context: Context) {
        _uiState.value = _uiState.value.copy(isFlickrLoggingIn = true, error = null)
        flickrAuthManager.startFlickrAuth(context)
    }

    /**
     * Complete Flickr login after OAuth callback.
     */
    fun completeFlickrLogin() {
        val flickrUserId = flickrAuthManager.flickrUserId.value ?: return
        val oauthToken = flickrAuthManager.flickrOauthToken.value
        val oauthSecret = flickrAuthManager.flickrOauthSecret.value

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isFlickrLoggingIn = true, error = null)

            val result = repository.flickrLogin(flickrUserId, oauthToken, oauthSecret)
            result.onSuccess { response ->
                sessionManager.saveSession(
                    token = response.session,
                    userId = response.user.id,
                    username = response.user.username,
                    displayName = response.user.displayName,
                    role = response.user.role,
                    avatarUrl = response.user.avatarUrl,
                )
                flickrAuthManager.clearAuth()
                DemoDataProvider.deactivate()
                _uiState.value = _uiState.value.copy(isFlickrLoggingIn = false, loginSuccess = true)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    isFlickrLoggingIn = false,
                    error = e.message ?: "Flickr login failed",
                )
            }
        }
    }

    /**
     * Register a new member with invite code.
     */
    fun register(inviteCode: String, username: String, displayName: String, password: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoggingIn = true, error = null)

            val result = repository.register(inviteCode, username, displayName, password)
            result.onSuccess { response ->
                sessionManager.saveSession(
                    token = response.session,
                    userId = response.user.id,
                    username = response.user.username,
                    displayName = response.user.displayName,
                    role = response.user.role,
                )
                DemoDataProvider.deactivate()
                _uiState.value = _uiState.value.copy(isLoggingIn = false, loginSuccess = true)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    isLoggingIn = false,
                    error = e.message ?: "Registration failed",
                )
            }
        }
    }

    /**
     * Enter demo mode.
     */
    fun enterDemo() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isDemoLoading = true)
            DemoDataProvider.activate()
            sessionManager.enterDemoMode()
            _uiState.value = _uiState.value.copy(isDemoLoading = false, loginSuccess = true)
        }
    }

    /**
     * Sign out.
     */
    fun signOut() {
        viewModelScope.launch {
            repository.logout()
            DemoDataProvider.deactivate()
            sessionManager.logout()
            _uiState.value = AuthUiState()
        }
    }

    /**
     * Validate and save server URL.
     */
    fun setServerUrl(url: String, onSuccess: () -> Unit) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoggingIn = true, error = null)

            sessionManager.setBaseUrl(url)

            // Validate with health check
            val result = repository.healthCheck()
            result.onSuccess {
                _uiState.value = _uiState.value.copy(isLoggingIn = false)
                onSuccess()
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    isLoggingIn = false,
                    error = "Could not connect to server: ${e.message}",
                )
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
