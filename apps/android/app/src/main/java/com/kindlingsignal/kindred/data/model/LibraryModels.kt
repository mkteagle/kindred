package com.kindlingsignal.kindred.data.model

import com.google.gson.annotations.SerializedName

/**
 * Models for the library, timeline, search, favourites, album and share
 * endpoints the redesign reads. Field names mirror the FastAPI responses
 * exactly — nothing here describes an endpoint that does not exist.
 */

// MARK: - Library gallery (`/library/photos`, `/favorites`)

/**
 * One row of the keyset-paged gallery.
 *
 * `dateTaken` is `COALESCE(taken_at, created_at)` server-side. Today
 * `photos.taken_at` is null for almost the whole library, so what arrives is
 * the upload date; the backend fix that populates `taken_at` will change the
 * value, not the shape, so date-facing UI can be built against this as-is.
 */
data class LibraryPhoto(
    @SerializedName("photo_id") val photoId: String,
    @SerializedName("photo_title") val photoTitle: String?,
    @SerializedName("date_taken") val dateTaken: String?,
    @SerializedName("media_kind") val mediaKind: String?,
    @SerializedName("duration_seconds") val durationSeconds: Double?,
    @SerializedName("flickr_url") val flickrUrl: String?,
) {
    val isVideo: Boolean get() = mediaKind == "video"
}

data class LibraryPage(
    val photos: List<LibraryPhoto> = emptyList(),
    @SerializedName("next_cursor") val nextCursor: String? = null,
)

/** `/library/counts` — the whole-catalog totals behind the stat cards. */
data class LibraryCounts(
    @SerializedName("total_files") val totalFiles: Int = 0,
    val photos: Int = 0,
    val videos: Int = 0,
    @SerializedName("on_nas") val onNas: Int = 0,
    @SerializedName("on_flickr") val onFlickr: Int = 0,
    @SerializedName("indexed_photos") val indexedPhotos: Int = 0,
    @SerializedName("pending_index") val pendingIndex: Int = 0,
)

/** `/library/years` — the full span, for the year scrubber and date chips. */
data class YearBucket(val year: Int, val count: Int)

data class YearsResponse(val years: List<YearBucket> = emptyList())

// MARK: - Favourites

data class FavoriteCount(val count: Int = 0)

data class FavoriteToggleResponse(
    @SerializedName("photo_id") val photoId: String,
    val favorited: Boolean,
)

// MARK: - Search (`/search`)

data class SearchFacets(
    val media: String? = null,
    @SerializedName("date_from") val dateFrom: String? = null,
    @SerializedName("date_to") val dateTo: String? = null,
    @SerializedName("date_field") val dateField: String? = null,
    @SerializedName("cluster_id") val clusterId: String? = null,
    val category: String? = null,
    @SerializedName("album_id") val albumId: String? = null,
)

data class SearchResponse(
    val results: List<SearchResult> = emptyList(),
    val query: String = "",
    val facets: SearchFacets? = null,
)

// MARK: - Named clusters (`/clusters/named`)

data class NamedCluster(
    val id: String,
    val category: String,
    val label: String?,
    val avatar: String?,
)

data class NamedClustersResponse(val clusters: List<NamedCluster> = emptyList())

// MARK: - Albums

data class Album(
    val id: String?,
    val name: String,
    val slug: String?,
    val description: String? = null,
    @SerializedName("photo_count") val photoCount: Int = 0,
    val source: String? = null,
) {
    /** The path segment `/albums/{reference}/photos` accepts. */
    val reference: String? get() = id ?: slug
}

data class AlbumsResponse(val albums: List<Album> = emptyList())

data class AlbumAddPhotosRequest(
    @SerializedName("photo_ids") val photoIds: List<String>,
)

// MARK: - Shares

data class Share(
    val id: String,
    val label: String? = null,
    @SerializedName("album_name") val albumName: String? = null,
    val url: String? = null,
    @SerializedName("photo_count") val photoCount: Int? = null,
    @SerializedName("created_at") val createdAt: String? = null,
)

data class SharesResponse(val shares: List<Share> = emptyList())

// MARK: - Single photo detail

/** One face/object found in a photo, with the cluster it was assigned to. */
data class PhotoDetection(
    val id: String,
    val category: String,
    val subtype: String?,
    @SerializedName("det_score") val detScore: Float?,
    val chip: String?,
    @SerializedName("cluster_id") val clusterId: String?,
    @SerializedName("cluster_label") val clusterLabel: String?,
)

data class PhotoDetectionsResponse(
    @SerializedName("photo_id") val photoId: String,
    @SerializedName("photo_title") val photoTitle: String? = null,
    val detections: List<PhotoDetection> = emptyList(),
)

/**
 * `/photos/{id}/metadata`. Latitude and longitude arrive, but no place name:
 * nothing on the backend reverse-geocodes them yet, so the viewer shows the
 * time alone rather than inventing a place.
 */
data class PhotoMetadata(
    @SerializedName("photo_id") val photoId: String? = null,
    @SerializedName("date_taken") val dateTaken: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val description: String? = null,
)

// MARK: - Cluster mutations (review / naming)

data class LabelClusterRequest(
    val category: String,
    @SerializedName("cluster_id") val clusterId: String,
    val name: String,
)

data class MergeClustersRequest(
    val category: String,
    @SerializedName("source_id") val sourceId: String,
    @SerializedName("target_id") val targetId: String,
)

data class DismissClusterRequest(
    val category: String,
    @SerializedName("cluster_id") val clusterId: String,
)

// MARK: - Media kind filter

/**
 * The `media` query parameter the library, timeline, search and years
 * endpoints all share.
 */
enum class MediaFilter(val apiValue: String, val label: String) {
    ALL("all", "All"),
    PHOTO("photo", "Photos"),
    VIDEO("video", "Videos"),
}

/**
 * Which date a range filter applies to. The search screen's "Taken ▾" chip
 * toggles between these; the backend calls the parameter `date_field`.
 */
enum class DateField(val apiValue: String, val label: String) {
    TAKEN("taken", "Taken"),
    ADDED("added", "Added"),
}
