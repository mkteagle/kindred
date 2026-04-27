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

    // MARK: - Stats

    suspend fun getStats(): Result<Stats> {
        if (isDemo) return Result.success(DemoDataProvider.getStats())
        return runCatching { api.getStats() }
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

    // MARK: - Search

    suspend fun search(query: String, limit: Int = 50): Result<List<SearchResult>> {
        if (isDemo) return Result.success(DemoDataProvider.searchDemoPhotos(query))
        return runCatching { api.search(query, limit) }
    }

    // MARK: - Timeline

    suspend fun getTimeline(): Result<TimelineResponse> {
        if (isDemo) return Result.success(DemoDataProvider.getTimeline())
        return runCatching { api.getTimeline() }
    }

    // MARK: - Together

    suspend fun getPhotosTogether(
        clusterIds: String,
        limit: Int = 100,
    ): Result<TogetherResponse> {
        if (isDemo) {
            // Demo mode: return empty together response
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
