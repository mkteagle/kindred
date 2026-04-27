package com.kindlingsignal.kindred.data.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * DataStore-backed session storage for auth state.
 * Stores session token, user info, and base URL configuration.
 */
@Singleton
class SessionManager @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) {
    companion object {
        private val KEY_SESSION_TOKEN = stringPreferencesKey("session_token")
        private val KEY_USERNAME = stringPreferencesKey("username")
        private val KEY_DISPLAY_NAME = stringPreferencesKey("display_name")
        private val KEY_ROLE = stringPreferencesKey("role")
        private val KEY_USER_ID = stringPreferencesKey("user_id")
        private val KEY_BASE_URL = stringPreferencesKey("base_url")
        private val KEY_AVATAR_URL = stringPreferencesKey("avatar_url")
        private val KEY_DEMO_MODE = booleanPreferencesKey("demo_mode")
    }

    private val _isLoggedIn = MutableStateFlow(false)
    val isLoggedIn: StateFlow<Boolean> = _isLoggedIn.asStateFlow()

    private val _isDemoMode = MutableStateFlow(false)
    val isDemoMode: StateFlow<Boolean> = _isDemoMode.asStateFlow()

    private val _baseUrl = MutableStateFlow("")
    val baseUrl: StateFlow<String> = _baseUrl.asStateFlow()

    private val _sessionToken = MutableStateFlow<String?>(null)
    val sessionToken: StateFlow<String?> = _sessionToken.asStateFlow()

    private val _username = MutableStateFlow<String?>(null)
    val username: StateFlow<String?> = _username.asStateFlow()

    private val _displayName = MutableStateFlow<String?>(null)
    val displayName: StateFlow<String?> = _displayName.asStateFlow()

    private val _role = MutableStateFlow<String?>(null)
    val role: StateFlow<String?> = _role.asStateFlow()

    private val _userId = MutableStateFlow<String?>(null)
    val userId: StateFlow<String?> = _userId.asStateFlow()

    private val _avatarUrl = MutableStateFlow<String?>(null)
    val avatarUrl: StateFlow<String?> = _avatarUrl.asStateFlow()

    /**
     * Load persisted session state from DataStore.
     * Must be called on app startup (e.g., from Application.onCreate).
     */
    suspend fun initialize() {
        val prefs = dataStore.data.first()
        val token = prefs[KEY_SESSION_TOKEN]
        val url = prefs[KEY_BASE_URL] ?: ""
        val demo = prefs[KEY_DEMO_MODE] ?: false

        _baseUrl.value = url
        _sessionToken.value = token
        _username.value = prefs[KEY_USERNAME]
        _displayName.value = prefs[KEY_DISPLAY_NAME]
        _role.value = prefs[KEY_ROLE]
        _userId.value = prefs[KEY_USER_ID]
        _avatarUrl.value = prefs[KEY_AVATAR_URL]
        _isDemoMode.value = demo
        _isLoggedIn.value = token != null
    }

    /**
     * Whether the user has configured a backend URL (first-run check).
     */
    val hasBaseUrl: Flow<Boolean> = dataStore.data.map { prefs ->
        !prefs[KEY_BASE_URL].isNullOrBlank()
    }

    /**
     * Save a successful login session.
     */
    suspend fun saveSession(
        token: String,
        userId: String,
        username: String,
        displayName: String?,
        role: String,
        avatarUrl: String? = null,
    ) {
        dataStore.edit { prefs ->
            prefs[KEY_SESSION_TOKEN] = token
            prefs[KEY_USER_ID] = userId
            prefs[KEY_USERNAME] = username
            if (displayName != null) prefs[KEY_DISPLAY_NAME] = displayName
            prefs[KEY_ROLE] = role
            if (avatarUrl != null) prefs[KEY_AVATAR_URL] = avatarUrl
            prefs[KEY_DEMO_MODE] = false
        }
        _sessionToken.value = token
        _userId.value = userId
        _username.value = username
        _displayName.value = displayName
        _role.value = role
        _avatarUrl.value = avatarUrl
        _isDemoMode.value = false
        _isLoggedIn.value = true
    }

    /**
     * Set the backend base URL. Call before login.
     */
    suspend fun setBaseUrl(url: String) {
        val normalized = url.trimEnd('/')
        dataStore.edit { prefs ->
            prefs[KEY_BASE_URL] = normalized
        }
        _baseUrl.value = normalized
    }

    /**
     * Enter demo mode (no network needed).
     */
    suspend fun enterDemoMode() {
        dataStore.edit { prefs ->
            prefs[KEY_DEMO_MODE] = true
        }
        _isDemoMode.value = true
    }

    /**
     * Sign out: clear session token and user info. Keeps base URL.
     */
    suspend fun logout() {
        dataStore.edit { prefs ->
            prefs.remove(KEY_SESSION_TOKEN)
            prefs.remove(KEY_USERNAME)
            prefs.remove(KEY_DISPLAY_NAME)
            prefs.remove(KEY_ROLE)
            prefs.remove(KEY_USER_ID)
            prefs.remove(KEY_AVATAR_URL)
            prefs[KEY_DEMO_MODE] = false
        }
        _sessionToken.value = null
        _username.value = null
        _displayName.value = null
        _role.value = null
        _userId.value = null
        _avatarUrl.value = null
        _isDemoMode.value = false
        _isLoggedIn.value = false
    }
}
