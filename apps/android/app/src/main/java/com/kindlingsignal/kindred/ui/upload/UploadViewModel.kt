package com.kindlingsignal.kindred.ui.upload

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.sync.PhotoSyncManager
import com.kindlingsignal.kindred.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class UploadViewModel @Inject constructor(
    private val photoSyncManager: PhotoSyncManager,
) : ViewModel() {

    val syncState: StateFlow<PhotoSyncManager.SyncState> = photoSyncManager.syncState
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = PhotoSyncManager.SyncState(),
        )

    /**
     * Start a one-time sync.
     */
    fun startSync(context: Context) {
        viewModelScope.launch {
            photoSyncManager.sync()
        }
        // Also enqueue via WorkManager so it survives activity death
        SyncWorker.enqueueOneTimeSync(context)
    }

    /**
     * Stop the current sync.
     */
    fun stopSync() {
        photoSyncManager.stopSync()
    }

    /**
     * Toggle auto-sync and schedule/cancel periodic work.
     */
    fun toggleAutoSync(context: Context, enabled: Boolean) {
        viewModelScope.launch {
            photoSyncManager.setAutoSync(enabled)
            if (enabled) {
                SyncWorker.schedulePeriodicSync(context)
            } else {
                SyncWorker.cancelPeriodicSync(context)
            }
        }
    }
}
