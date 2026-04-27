package com.kindlingsignal.kindred.data.model

import com.google.gson.annotations.SerializedName

/**
 * Data classes matching the Kindred backend API responses.
 * Mirror of the iOS Models.swift.
 */

// MARK: - Cluster Models

data class ClusterSummary(
    val id: String,
    val label: String?,
    @SerializedName("det_count") val detCount: Int,
    @SerializedName("photo_count") val photoCount: Int,
    val avatar: String?,
    @SerializedName("thumb_url") val thumbUrl: String?,
    @SerializedName("photo_url") val photoUrl: String?,
)

data class ClusterDetail(
    @SerializedName("cluster_id") val clusterId: String,
    val items: List<Detection>,
)

data class ClustersSummaryResponse(
    val clusters: List<ClusterSummary>,
    @SerializedName("noise_count") val noiseCount: Int?,
)

// MARK: - Detection

data class Detection(
    val id: String,
    val category: String,
    val subtype: String,
    @SerializedName("photo_id") val photoId: String,
    @SerializedName("photo_url") val photoUrl: String,
    @SerializedName("thumb_url") val thumbUrl: String?,
    @SerializedName("flickr_url") val flickrUrl: String?,
    @SerializedName("photo_title") val photoTitle: String?,
    val owner: String?,
    @SerializedName("det_score") val detScore: Float?,
    val chip: String?,
)

// MARK: - Stats

data class Stats(
    val people: CategoryStats,
    val pets: CategoryStats,
    val vehicles: CategoryStats,
)

data class CategoryStats(
    val detections: Int,
    val photos: Int,
    val groups: Int?,
)

// MARK: - Search

data class SearchResult(
    @SerializedName("photo_id") val photoId: String,
    val distance: Float,
    @SerializedName("photo_url") val photoUrl: String,
    @SerializedName("thumb_url") val thumbUrl: String?,
    @SerializedName("flickr_url") val flickrUrl: String?,
    @SerializedName("photo_title") val photoTitle: String?,
    val owner: String?,
    @SerializedName("match_type") val matchType: String?,
    @SerializedName("match_name") val matchName: String?,
    @SerializedName("match_cluster_id") val matchClusterId: String?,
    @SerializedName("match_category") val matchCategory: String?,
)

// MARK: - Timeline

data class TimelinePhoto(
    @SerializedName("photo_id") val photoId: String,
    @SerializedName("thumb_url") val thumbUrl: String?,
    @SerializedName("flickr_url") val flickrUrl: String?,
    @SerializedName("photo_title") val photoTitle: String?,
    @SerializedName("date_taken") val dateTaken: String?,
)

data class TimelineMonth(
    val month: String,
    val count: Int,
    val photos: List<TimelinePhoto>,
)

data class TimelineResponse(
    val months: List<TimelineMonth>,
)

// MARK: - Together

data class TogetherResponse(
    val photos: List<TogetherPhoto>,
    val count: Int,
    @SerializedName("people_count") val peopleCount: Int,
)

data class TogetherPhoto(
    @SerializedName("photo_id") val photoId: String,
    @SerializedName("photo_url") val photoUrl: String,
    @SerializedName("thumb_url") val thumbUrl: String?,
    @SerializedName("flickr_url") val flickrUrl: String?,
    @SerializedName("photo_title") val photoTitle: String?,
)

// MARK: - Health

data class HealthResponse(
    val status: String,
)

// MARK: - Category Enum

enum class ClusterCategory(
    val displayName: String,
    val apiName: String,
) {
    PEOPLE("People", "people"),
    PETS("Pets", "pets"),
    VEHICLES("Vehicles", "vehicles");
}
