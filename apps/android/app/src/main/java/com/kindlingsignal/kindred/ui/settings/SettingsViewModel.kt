package com.kindlingsignal.kindred.ui.settings

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.auth.SessionManager
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.data.repository.KindredRepository
import com.kindlingsignal.kindred.data.sync.PhotoSyncManager
import com.kindlingsignal.kindred.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val sessionManager: SessionManager,
    private val repository: KindredRepository,
    private val photoSyncManager: PhotoSyncManager,
) : ViewModel() {

    data class SettingsUiState(
        val username: String = "",
        val displayName: String = "",
        val role: String = "member",
        val avatarUrl: String? = null,
        val isDemoMode: Boolean = false,
        val isLoggedIn: Boolean = false,
        val serverUrl: String = "",
    )

    val uiState: StateFlow<SettingsUiState> = combine(
        combine(sessionManager.username, sessionManager.displayName, sessionManager.role) { u, d, r ->
            Triple(u, d, r)
        },
        combine(sessionManager.avatarUrl, sessionManager.isDemoMode, sessionManager.isLoggedIn) { a, dm, li ->
            Triple(a, dm, li)
        },
        sessionManager.baseUrl,
    ) { userInfo, stateInfo, baseUrl ->
        SettingsUiState(
            username = userInfo.first ?: "you",
            displayName = userInfo.second ?: userInfo.first ?: "Signed in",
            role = userInfo.third ?: "member",
            avatarUrl = stateInfo.first,
            isDemoMode = stateInfo.second,
            isLoggedIn = stateInfo.third,
            serverUrl = baseUrl,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = SettingsUiState(),
    )

    val syncState: StateFlow<PhotoSyncManager.SyncState> = photoSyncManager.syncState
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = PhotoSyncManager.SyncState(),
        )

    private val _backendOnline = MutableStateFlow<Boolean?>(null)
    val backendOnline: StateFlow<Boolean?> = _backendOnline.asStateFlow()

    private val _favoritesCount = MutableStateFlow(0)
    val favoritesCount: StateFlow<Int> = _favoritesCount.asStateFlow()

    private val _shareCount = MutableStateFlow(0)
    val shareCount: StateFlow<Int> = _shareCount.asStateFlow()

    /**
     * Wi-Fi-only backup is a WorkManager constraint rather than a server
     * setting, so it lives here beside the auto-sync toggle it qualifies.
     */
    private val _wifiOnly = MutableStateFlow(true)
    val wifiOnly: StateFlow<Boolean> = _wifiOnly.asStateFlow()

    init {
        checkBackendStatus()
        viewModelScope.launch {
            photoSyncManager.initialize()
            repository.getFavoritesCount().onSuccess { _favoritesCount.value = it }
            repository.getShares().onSuccess { _shareCount.value = it.size }
        }
    }

    fun checkBackendStatus() {
        viewModelScope.launch {
            _backendOnline.value = repository.healthCheck().isSuccess
        }
    }

    fun setBackupEnabled(context: Context, enabled: Boolean) {
        viewModelScope.launch {
            photoSyncManager.setAutoSync(enabled)
            if (enabled) SyncWorker.schedulePeriodicSync(context)
            else SyncWorker.cancelPeriodicSync(context)
        }
    }

    fun setWifiOnly(context: Context, enabled: Boolean) {
        _wifiOnly.value = enabled
        // Reschedule so the new network constraint takes effect immediately
        // rather than at the next natural run.
        if (syncState.value.autoSyncEnabled) {
            SyncWorker.cancelPeriodicSync(context)
            SyncWorker.schedulePeriodicSync(context)
        }
    }

    fun enterDemoMode() {
        viewModelScope.launch {
            DemoDataProvider.activate()
            sessionManager.enterDemoMode()
        }
    }

    fun signOut(onSignedOut: () -> Unit) {
        viewModelScope.launch {
            repository.logout()
            DemoDataProvider.deactivate()
            sessionManager.logout()
            onSignedOut()
        }
    }
}
