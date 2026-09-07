package com.kindlingsignal.kindred.data.repository

import com.kindlingsignal.kindred.data.api.KindredApi
import com.kindlingsignal.kindred.data.auth.SessionManager
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.data.model.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository that wraps KindredApi with error handling and demo mode support.
 * When demo mode is active, returns DemoDataProvider data (no network).
 * In real mode, makes API calls via Retrofit.
 */
@Singleton
class KindredRepository @Inject constructor(
    private val api: KindredApi,
    private val sessionManager: SessionManager,
) {
    private val isDemo: Boolean
        get() = sessionManager.isDemoMode.value

    // MARK: - Health

    suspend fun healthCheck(): Result<HealthResponse> = runCatching {
        api.healthCheck()
    }

    // MARK: - Auth

    suspend fun login(username: String, password: String): Result<LoginResponse> = runCatching {
        api.login(LoginRequest(username, password))
    }

    suspend fun register(
        inviteCode: String,
        username: String,
        displayName: String,
        password: String,
    ): Result<RegisterResponse> = runCatching {
        api.register(RegisterRequest(inviteCode, username, displayName, password))
    }

    suspend fun flickrLogin(
        flickrUserId: String,
        oauthToken: String?,
        oauthSecret: String?,
    ): Result<LoginResponse> = runCatching {
        api.flickrLogin(FlickrLoginRequest(flickrUserId, oauthToken, oauthSecret))
    }

    suspend fun logout(): Result<Unit> = runCatching {
        api.logout()
    }

    suspend fun getMe(): Result<MeResponse> = runCatching {
        api.getMe()
    }

    // MARK: - Stats and counts

    suspend fun getStats(): Result<Stats> {
        if (isDemo) return Result.success(DemoDataProvider.getStats())
        return runCatching { api.getStats() }
    }

    suspend fun getLibraryCounts(): Result<LibraryCounts> {
        if (isDemo) return Result.success(DemoDataProvider.getLibraryCounts())
        return runCatching { api.getLibraryCounts() }
    }

    suspend fun getLibraryYears(media: MediaFilter = MediaFilter.ALL): Result<List<YearBucket>> {
        if (isDemo) return Result.success(DemoDataProvider.getYears())
        return runCatching { api.getLibraryYears(media.apiValue).years }
    }

    // MARK: - Library gallery

    /**
     * One page of the mosaic. Pass the previous page's [LibraryPage.nextCursor]
     * to continue; keyset paging means page N costs the same as page 1.
     */
    suspend fun getLibraryPhotos(
        media: MediaFilter = MediaFilter.ALL,
        cursor: String? = null,
        dateFrom: String? = null,
        dateTo: String? = null,
        minDuration: Double? = null,
        limit: Int = 48,
    ): Result<LibraryPage> {
        if (isDemo) return Result.success(DemoDataProvider.getLibraryPage(media))
        return runCatching {
            api.getLibraryPhotos(
                media = media.apiValue,
                cursor = cursor,
                dateFrom = dateFrom,
                dateTo = dateTo,
                minDuration = minDuration,
                limit = limit,
            )
        }
    }

    // MARK: - Clusters

    suspend fun getClusters(category: String): Result<ClustersSummaryResponse> {
        if (isDemo) return Result.success(DemoDataProvider.getClusterSummary(category))
        return runCatching { api.getClusterSummary(category) }
    }

    suspend fun getClusterDetail(category: String, clusterId: String): Result<ClusterDetail> {
        if (isDemo) {
            val detections = DemoDataProvider.getClusterDetail(category, clusterId)
            return Result.success(ClusterDetail(clusterId = clusterId, items = detections))
        }
        return runCatching { api.getClusterDetail(category, clusterId) }
    }

    /** Named clusters — the "reuse a name" chips on the review screen. */
    suspend fun getNamedClusters(category: String = "people"): Result<List<NamedCluster>> {
        if (isDemo) return Result.success(DemoDataProvider.getNamedClusters())
        return runCatching { api.getNamedClusters(category).clusters }
    }

    /** Name a group. The backend requires an admin session. */
    suspend fun labelCluster(category: String, clusterId: String, name: String): Result<Unit> {
        if (isDemo) return Result.success(Unit)
        return runCatching {
            api.labelCluster(LabelClusterRequest(category, clusterId, name))
            Unit
        }
    }

    suspend fun mergeClusters(category: String, sourceId: String, targetId: String): Result<Unit> {
        if (isDemo) return Result.success(Unit)
        return runCatching {
            api.mergeClusters(MergeClustersRequest(category, sourceId, targetId))
            Unit
        }
    }

    suspend fun dismissCluster(category: String, clusterId: String): Result<Unit> {
        if (isDemo) return Result.success(Unit)
        return runCatching {
            api.dismissCluster(DismissClusterRequest(category, clusterId))
            Unit
        }
    }

    // MARK: - Single photo

    suspend fun getPhotoDetections(photoId: String): Result<PhotoDetectionsResponse> {
        if (isDemo) return Result.success(PhotoDetectionsResponse(photoId = photoId))
        return runCatching { api.getPhotoDetections(photoId) }
    }

    suspend fun getPhotoMetadata(photoId: String): Result<PhotoMetadata> {
        if (isDemo) return Result.success(PhotoMetadata(photoId = photoId))
        return runCatching { api.getPhotoMetadata(photoId) }
    }

    // MARK: - Search

    suspend fun search(
        query: String,
        media: MediaFilter = MediaFilter.ALL,
        dateField: DateField = DateField.TAKEN,
        dateFrom: String? = null,
        dateTo: String? = null,
        clusterId: String? = null,
        category: String? = null,
        albumId: String? = null,
        limit: Int = 60,
    ): Result<List<SearchResult>> {
        if (isDemo) return Result.success(DemoDataProvider.searchDemoPhotos(query))
        return runCatching {
            api.search(
                query = query,
                media = media.apiValue,
                dateField = dateField.apiValue,
                dateFrom = dateFrom,
                dateTo = dateTo,
                clusterId = clusterId,
                category = category,
                albumId = albumId,
                limit = limit,
            ).results
        }
    }

    // MARK: - Timeline

    suspend fun getTimeline(
        months: Int = 3,
        before: String? = null,
        media: MediaFilter = MediaFilter.ALL,
    ): Result<TimelineResponse> {
        if (isDemo) return Result.success(DemoDataProvider.getTimeline())
        return runCatching { api.getTimeline(months, before, media.apiValue) }
    }

    // MARK: - Favourites

    suspend fun getFavorites(
        media: MediaFilter = MediaFilter.ALL,
        cursor: String? = null,
    ): Result<LibraryPage> {
        if (isDemo) return Result.success(LibraryPage())
        return runCatching { api.getFavorites(media.apiValue, cursor) }
    }

    suspend fun getFavoritesCount(): Result<Int> {
        if (isDemo) return Result.success(0)
        return runCatching { api.getFavoritesCount().count }
    }

    /** Idempotent both ways, so a double tap is not an error. */
    suspend fun setFavorite(photoId: String, favorited: Boolean): Result<Boolean> {
        if (isDemo) return Result.success(favorited)
        return runCatching {
            if (favorited) api.addFavorite(photoId).favorited
            else api.removeFavorite(photoId).favorited
        }
    }

    // MARK: - Albums

    suspend fun getAlbums(): Result<List<Album>> {
        if (isDemo) return Result.success(DemoDataProvider.getAlbums())
        return runCatching { api.getAlbums().albums }
    }

    suspend fun addPhotosToAlbum(reference: String, photoIds: List<String>): Result<Unit> {
        if (isDemo) return Result.success(Unit)
        return runCatching {
            api.addPhotosToAlbum(reference, AlbumAddPhotosRequest(photoIds))
            Unit
        }
    }

    // MARK: - Shares

    suspend fun getShares(): Result<List<Share>> {
        if (isDemo) return Result.success(emptyList())
        return runCatching { api.getShares().shares }
    }

    // MARK: - Together

    suspend fun getPhotosTogether(
        clusterIds: String,
        limit: Int = 100,
    ): Result<TogetherResponse> {
        if (isDemo) {
            return Result.success(TogetherResponse(photos = emptyList(), count = 0, peopleCount = 0))
        }
        return runCatching { api.getPhotosTogether(clusterIds, limit) }
    }

    // MARK: - Upload

    suspend fun uploadPhoto(
        photoBytes: ByteArray,
        filename: String,
        mimeType: String,
        title: String? = null,
    ): Result<UploadResponse> = runCatching {
        val mediaType = mimeType.toMediaType()
        val requestBody = photoBytes.toRequestBody(mediaType)
        val photoPart = MultipartBody.Part.createFormData("photo", filename, requestBody)
        val titlePart = title?.toRequestBody("text/plain".toMediaType())
        api.uploadPhoto(photoPart, titlePart)
    }
}
