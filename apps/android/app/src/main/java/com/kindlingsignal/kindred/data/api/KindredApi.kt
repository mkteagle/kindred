package com.kindlingsignal.kindred.data.api

import com.kindlingsignal.kindred.data.model.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit interface for the Kindred backend API.
 * Base URL is configured dynamically via SessionManager.
 *
 * Every method here maps to a route that exists in `backend/main.py`. Screens
 * that need something the backend does not offer carry a TODO naming the
 * endpoint that would close them rather than a speculative method here.
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

    // MARK: - Stats and counts

    @GET("stats")
    suspend fun getStats(): Stats

    @GET("library/counts")
    suspend fun getLibraryCounts(): LibraryCounts

    @GET("library/years")
    suspend fun getLibraryYears(
        @Query("media") media: String = "all",
    ): YearsResponse

    // MARK: - Library gallery (keyset paged)

    @GET("library/photos")
    suspend fun getLibraryPhotos(
        @Query("sort") sort: String = "newest",
        @Query("media") media: String = "all",
        @Query("cursor") cursor: String? = null,
        @Query("date_from") dateFrom: String? = null,
        @Query("date_to") dateTo: String? = null,
        @Query("min_duration") minDuration: Double? = null,
        @Query("limit") limit: Int = 48,
    ): LibraryPage

    // MARK: - Timeline

    @GET("timeline")
    suspend fun getTimeline(
        @Query("months") months: Int = 3,
        @Query("before") before: String? = null,
        @Query("media") media: String = "all",
    ): TimelineResponse

    // MARK: - Clusters (people, pets, vehicles)

    @GET("clusters/{category}/summary")
    suspend fun getClusterSummary(
        @Path("category") category: String,
        @Query("limit") limit: Int = 30,
        @Query("offset") offset: Int = 0,
        @Query("q") query: String = "",
    ): ClustersSummaryResponse

    @GET("clusters/{category}/{clusterId}")
    suspend fun getClusterDetail(
        @Path("category") category: String,
        @Path("clusterId") clusterId: String,
    ): ClusterDetail

    @GET("clusters/named")
    suspend fun getNamedClusters(
        @Query("category") category: String = "people",
    ): NamedClustersResponse

    /** Name a cluster. Admin-only server side. */
    @POST("clusters/label")
    suspend fun labelCluster(@Body request: LabelClusterRequest): Response<Unit>

    /** Fold one cluster into another — the review screen's "Merge into…". */
    @POST("clusters/merge")
    suspend fun mergeClusters(@Body request: MergeClustersRequest): Response<Unit>

    /** "Not a person": drops the group and remembers the face so it stops coming back. */
    @POST("clusters/dismiss")
    suspend fun dismissCluster(@Body request: DismissClusterRequest): Response<Unit>

    // MARK: - Single photo

    /** People and object chips under the viewer stage. */
    @GET("photos/{photoId}/detections")
    suspend fun getPhotoDetections(@Path("photoId") photoId: String): PhotoDetectionsResponse

    /** Capture time and coordinates for the viewer's stacked date/place line. */
    @GET("photos/{photoId}/metadata")
    suspend fun getPhotoMetadata(@Path("photoId") photoId: String): PhotoMetadata

    // MARK: - Search

    @GET("search")
    suspend fun search(
        @Query("q") query: String = "",
        @Query("media") media: String = "all",
        @Query("date_field") dateField: String = "taken",
        @Query("date_from") dateFrom: String? = null,
        @Query("date_to") dateTo: String? = null,
        @Query("cluster_id") clusterId: String? = null,
        @Query("category") category: String? = null,
        @Query("album_id") albumId: String? = null,
        @Query("limit") limit: Int = 60,
    ): SearchResponse

    // MARK: - Favourites (per member)

    @GET("favorites")
    suspend fun getFavorites(
        @Query("media") media: String = "all",
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int = 48,
    ): LibraryPage

    @GET("favorites/count")
    suspend fun getFavoritesCount(): FavoriteCount

    @PUT("photos/{photoId}/favorite")
    suspend fun addFavorite(@Path("photoId") photoId: String): FavoriteToggleResponse

    @DELETE("photos/{photoId}/favorite")
    suspend fun removeFavorite(@Path("photoId") photoId: String): FavoriteToggleResponse

    // MARK: - Albums

    @GET("albums")
    suspend fun getAlbums(): AlbumsResponse

    @POST("albums/{reference}/photos")
    suspend fun addPhotosToAlbum(
        @Path("reference") reference: String,
        @Body request: AlbumAddPhotosRequest,
    ): Response<Unit>

    // MARK: - Shares

    @GET("shares")
    suspend fun getShares(): SharesResponse

    // MARK: - Together

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
