package com.kindlingsignal.kindred.data.api

import com.kindlingsignal.kindred.data.model.*
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Retrofit interface for the Kindred backend API.
 * Base URL: https://api.kindredphotos.app
 */
interface KindredApi {

    @GET("health")
    suspend fun healthCheck(): HealthResponse

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

    companion object {
        const val BASE_URL = "https://api.kindredphotos.app/"
    }
}
