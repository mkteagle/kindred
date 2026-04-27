package com.kindlingsignal.kindred.data.sync

import android.content.ContentUris
import android.content.Context
import android.provider.MediaStore
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringSetPreferencesKey
import com.kindlingsignal.kindred.data.repository.KindredRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages photo upload/sync from device to the Kindred backend.
 * Reads device photos via MediaStore, tracks which have been uploaded,
 * and uploads new ones via KindredRepository.
 */
@Singleton
class PhotoSyncManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repository: KindredRepository,
    private val dataStore: DataStore<Preferences>,
) {
    companion object {
        private val KEY_UPLOADED_URIS = stringSetPreferencesKey("uploaded_photo_uris")
        private val KEY_AUTO_SYNC = booleanPreferencesKey("auto_sync_enabled")
    }

    data class SyncState(
        val isSyncing: Boolean = false,
        val totalToSync: Int = 0,
        val syncedCount: Int = 0,
        val progress: Float = 0f,
        val lastError: String? = null,
        val autoSyncEnabled: Boolean = false,
    )

    private val _syncState = MutableStateFlow(SyncState())
    val syncState: StateFlow<SyncState> = _syncState.asStateFlow()

    /**
     * Load saved sync preferences.
     */
    suspend fun initialize() {
        val prefs = dataStore.data.first()
        val autoSync = prefs[KEY_AUTO_SYNC] ?: false
        _syncState.value = _syncState.value.copy(autoSyncEnabled = autoSync)
    }

    /**
     * Toggle auto-sync preference.
     */
    suspend fun setAutoSync(enabled: Boolean) {
        dataStore.edit { prefs ->
            prefs[KEY_AUTO_SYNC] = enabled
        }
        _syncState.value = _syncState.value.copy(autoSyncEnabled = enabled)
    }

    /**
     * Get the set of already-uploaded photo URIs.
     */
    private suspend fun getUploadedUris(): Set<String> {
        val prefs = dataStore.data.first()
        return prefs[KEY_UPLOADED_URIS] ?: emptySet()
    }

    /**
     * Mark a photo URI as uploaded.
     */
    private suspend fun markUploaded(uri: String) {
        dataStore.edit { prefs ->
            val current = prefs[KEY_UPLOADED_URIS] ?: emptySet()
            prefs[KEY_UPLOADED_URIS] = current + uri
        }
    }

    /**
     * Data class for a device photo to upload.
     */
    data class DevicePhoto(
        val id: Long,
        val uri: String,
        val displayName: String,
        val mimeType: String,
        val size: Long,
    )

    /**
     * Query device photos from MediaStore.
     */
    suspend fun getDevicePhotos(): List<DevicePhoto> = withContext(Dispatchers.IO) {
        val photos = mutableListOf<DevicePhoto>()
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.MIME_TYPE,
            MediaStore.Images.Media.SIZE,
        )

        val sortOrder = "${MediaStore.Images.Media.DATE_ADDED} DESC"

        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            null,
            null,
            sortOrder,
        )?.use { cursor ->
            val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE)
            val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)

            while (cursor.moveToNext()) {
                val id = cursor.getLong(idColumn)
                val name = cursor.getString(nameColumn)
                val mime = cursor.getString(mimeColumn)
                val size = cursor.getLong(sizeColumn)
                val contentUri = ContentUris.withAppendedId(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    id,
                )

                photos.add(
                    DevicePhoto(
                        id = id,
                        uri = contentUri.toString(),
                        displayName = name,
                        mimeType = mime,
                        size = size,
                    ),
                )
            }
        }

        photos
    }

    /**
     * Run a full sync: find unuploaded photos and upload them.
     */
    suspend fun sync(): Result<Int> = withContext(Dispatchers.IO) {
        if (_syncState.value.isSyncing) {
            return@withContext Result.failure(IllegalStateException("Sync already in progress"))
        }

        _syncState.value = _syncState.value.copy(
            isSyncing = true,
            lastError = null,
            syncedCount = 0,
        )

        try {
            val allPhotos = getDevicePhotos()
            val uploadedUris = getUploadedUris()
            val toUpload = allPhotos.filter { it.uri !in uploadedUris }

            _syncState.value = _syncState.value.copy(
                totalToSync = toUpload.size,
                progress = 0f,
            )

            if (toUpload.isEmpty()) {
                _syncState.value = _syncState.value.copy(isSyncing = false)
                return@withContext Result.success(0)
            }

            var uploaded = 0
            var lastError: String? = null

            for (photo in toUpload) {
                try {
                    val bytes = readPhotoBytes(photo)
                    if (bytes != null) {
                        val result = repository.uploadPhoto(
                            photoBytes = bytes,
                            filename = photo.displayName,
                            mimeType = photo.mimeType,
                            title = photo.displayName.substringBeforeLast('.'),
                        )

                        if (result.isSuccess) {
                            markUploaded(photo.uri)
                            uploaded++
                        } else {
                            lastError = result.exceptionOrNull()?.message
                        }
                    }
                } catch (e: Exception) {
                    lastError = e.message
                }

                _syncState.value = _syncState.value.copy(
                    syncedCount = uploaded,
                    progress = if (toUpload.isNotEmpty()) uploaded.toFloat() / toUpload.size else 1f,
                    lastError = lastError,
                )
            }

            _syncState.value = _syncState.value.copy(isSyncing = false)
            Result.success(uploaded)
        } catch (e: Exception) {
            _syncState.value = _syncState.value.copy(
                isSyncing = false,
                lastError = e.message,
            )
            Result.failure(e)
        }
    }

    /**
     * Stop the current sync.
     */
    fun stopSync() {
        _syncState.value = _syncState.value.copy(isSyncing = false)
    }

    /**
     * Read photo bytes from ContentResolver.
     */
    private fun readPhotoBytes(photo: DevicePhoto): ByteArray? {
        return try {
            val uri = android.net.Uri.parse(photo.uri)
            context.contentResolver.openInputStream(uri)?.use { stream ->
                stream.readBytes()
            }
        } catch (e: IOException) {
            null
        }
    }

    /**
     * Get count of photos that need uploading.
     */
    suspend fun getPendingCount(): Int {
        val allPhotos = getDevicePhotos()
        val uploadedUris = getUploadedUris()
        return allPhotos.count { it.uri !in uploadedUris }
    }

    /**
     * Get total uploaded count.
     */
    suspend fun getUploadedCount(): Int {
        return getUploadedUris().size
    }
}
