package com.kindlingsignal.kindred.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.auth.SessionManager
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.data.repository.KindredRepository
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
) : ViewModel() {

    data class SettingsUiState(
        val username: String = "Demo User",
        val displayName: String = "Demo User",
        val role: String = "member",
        val avatarUrl: String? = null,
        val isDemoMode: Boolean = true,
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
            username = userInfo.first ?: "Demo User",
            displayName = userInfo.second ?: "Demo User",
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

    private val _backendOnline = MutableStateFlow<Boolean?>(null)
    val backendOnline: StateFlow<Boolean?> = _backendOnline.asStateFlow()

    init {
        checkBackendStatus()
    }

    fun checkBackendStatus() {
        viewModelScope.launch {
            val result = repository.healthCheck()
            _backendOnline.value = result.isSuccess
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
