package com.kindlingsignal.kindred.ui.upload

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kindlingsignal.kindred.data.model.Album
import com.kindlingsignal.kindred.data.repository.KindredRepository
import com.kindlingsignal.kindred.data.sync.PhotoSyncManager
import com.kindlingsignal.kindred.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class UploadViewModel @Inject constructor(
    private val photoSyncManager: PhotoSyncManager,
    private val repository: KindredRepository,
) : ViewModel() {

    val syncState: StateFlow<PhotoSyncManager.SyncState> = photoSyncManager.syncState
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = PhotoSyncManager.SyncState(),
        )

    val queue: StateFlow<List<PhotoSyncManager.QueueItem>> = photoSyncManager.queue
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList(),
        )

    private val _albums = MutableStateFlow<List<Album>>(emptyList())
    val albums: StateFlow<List<Album>> = _albums.asStateFlow()

    private val _selectedAlbum = MutableStateFlow<Album?>(null)
    val selectedAlbum: StateFlow<Album?> = _selectedAlbum.asStateFlow()

    private val _pendingCount = MutableStateFlow(0)
    val pendingCount: StateFlow<Int> = _pendingCount.asStateFlow()

    init {
        viewModelScope.launch {
            repository.getAlbums().onSuccess { _albums.value = it }
        }
        refreshPendingCount()
    }

    fun refreshPendingCount() {
        viewModelScope.launch {
            _pendingCount.value = runCatching { photoSyncManager.getPendingCount() }.getOrDefault(0)
        }
    }

    fun selectAlbum(album: Album?) {
        _selectedAlbum.update { album }
    }

    /**
     * Start the batch. Enqueued through WorkManager too, so an upload survives
     * the sheet being dismissed or the process being killed mid-batch.
     *
     * `POST /photos/upload` takes no album, so a chosen album is applied after
     * the batch with `POST /albums/{ref}/photos` — which is the same route the
     * web library's selection bar uses, so an album filled this way is
     * indistinguishable from one filled at upload time.
     */
    fun startSync(context: Context) {
        viewModelScope.launch {
            photoSyncManager.sync()
            val album = _selectedAlbum.value?.reference
            if (album != null) {
                val ids = photoSyncManager.queue.value.mapNotNull { it.photoId }
                if (ids.isNotEmpty()) repository.addPhotosToAlbum(album, ids)
            }
            refreshPendingCount()
        }
        SyncWorker.enqueueOneTimeSync(context)
    }

    fun stopSync() {
        photoSyncManager.stopSync()
    }

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
