package com.kindlingsignal.kindred.data.api

import com.kindlingsignal.kindred.data.model.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit interface for the Kindred backend API.
 * Base URL is configured dynamically via SessionManager.
 */
interface KindredApi {

    // MARK: - Health

    @GET("health")
    suspend fun healthCheck(): HealthResponse

    // MARK: - Auth

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse

    @POST("auth/register")
    suspend fun register(@Body request: RegisterRequest): RegisterResponse

    @POST("auth/flickr-login")
    suspend fun flickrLogin(@Body request: FlickrLoginRequest): LoginResponse

    @POST("auth/logout")
    suspend fun logout(): Response<Unit>

    @GET("auth/me")
    suspend fun getMe(): MeResponse

    // MARK: - Data

    @GET("stats")
    suspend fun getStats(): Stats

    @GET("clusters/{category}/summary")
    suspend fun getClusterSummary(
        @Path("category") category: String,
    ): ClustersSummaryResponse

    @GET("clusters/{category}/{clusterId}")
    suspend fun getClusterDetail(
        @Path("category") category: String,
        @Path("clusterId") clusterId: String,
    ): ClusterDetail

    @GET("search")
    suspend fun search(
        @Query("q") query: String,
        @Query("limit") limit: Int = 50,
    ): List<SearchResult>

    @GET("timeline")
    suspend fun getTimeline(): TimelineResponse

    @GET("photos/together")
    suspend fun getPhotosTogether(
        @Query("people") clusterIds: String,
        @Query("limit") limit: Int = 100,
    ): TogetherResponse

    // MARK: - Upload

    @Multipart
    @POST("photos/upload")
    suspend fun uploadPhoto(
        @Part photo: MultipartBody.Part,
        @Part("title") title: RequestBody? = null,
        @Part("description") description: RequestBody? = null,
    ): UploadResponse
}
