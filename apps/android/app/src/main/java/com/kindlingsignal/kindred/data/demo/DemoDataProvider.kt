package com.kindlingsignal.kindred.data.demo

import com.kindlingsignal.kindred.R
import com.kindlingsignal.kindred.data.model.*

/**
 * Provides bundled demo data so the app can run fully offline when the user
 * taps "Try the demo". No network calls are made in demo mode.
 *
 * Mirrors the iOS DemoDataProvider.
 */
object DemoDataProvider {

    /** Whether demo mode is currently active */
    var isActive: Boolean = false
        private set

    fun activate() {
        isActive = true
    }

    fun deactivate() {
        isActive = false
    }

    /** Check if a URL uses the demo:// scheme */
    fun isDemoUrl(url: String?): Boolean {
        return url?.startsWith("demo://") == true
    }

    // MARK: - Demo drawable resource mapping

    /**
     * Maps demo photo keys to Android drawable resource IDs.
     * These are the subset of photos bundled with the Android app.
     */
    val demoDrawables: Map<String, Int> = mapOf(
        "family-campfire-1" to R.drawable.demo_family_campfire_1,
        "couple-sunset" to R.drawable.demo_couple_sunset,
        "family-holiday-1" to R.drawable.demo_family_holiday_1,
        "dog-retriever" to R.drawable.demo_dog_retriever,
        "family-campervan" to R.drawable.demo_family_campervan,
        "mom-child-joy" to R.drawable.demo_mom_child_joy,
    )

    /** All available demo drawable keys */
    private val demoKeys = demoDrawables.keys.toList()

    /** Get a drawable resource ID for a demo URL, or null */
    fun drawableForDemoUrl(url: String): Int? {
        if (!url.startsWith("demo://")) return null

        // Support demo://file_FILENAME pattern
        if (url.startsWith("demo://file_")) {
            val filename = url.removePrefix("demo://file_")
            return demoDrawables[filename]
        }

        // Fallback: hash-based selection from available drawables
        val index = kotlin.math.abs(url.hashCode()) % demoKeys.size
        return demoDrawables[demoKeys[index]]
    }

    // MARK: - Demo Clusters (People)

    private val demoPeopleClusters = listOf(
        ClusterSummary(
            id = "demo_p1",
            label = "Mom",
            detCount = 42,
            photoCount = 35,
            avatar = "demo://file_family-campfire-1",
            thumbUrl = "demo://file_family-campfire-1",
            photoUrl = "demo://file_family-campfire-1",
        ),
        ClusterSummary(
            id = "demo_p2",
            label = "Dad",
            detCount = 38,
            photoCount = 31,
            avatar = "demo://file_couple-sunset",
            thumbUrl = "demo://file_couple-sunset",
            photoUrl = "demo://file_couple-sunset",
        ),
        ClusterSummary(
            id = "demo_p3",
            label = "Maya",
            detCount = 33,
            photoCount = 27,
            avatar = "demo://file_mom-child-joy",
            thumbUrl = "demo://file_mom-child-joy",
            photoUrl = "demo://file_mom-child-joy",
        ),
        ClusterSummary(
            id = "demo_p4",
            label = "Uncle Jim",
            detCount = 5,
            photoCount = 4,
            avatar = "demo://file_family-holiday-1",
            thumbUrl = "demo://file_family-holiday-1",
            photoUrl = "demo://file_family-holiday-1",
        ),
        ClusterSummary(
            id = "demo_p5",
            label = "Friends",
            detCount = 5,
            photoCount = 4,
            avatar = "demo://file_family-campervan",
            thumbUrl = "demo://file_family-campervan",
            photoUrl = "demo://file_family-campervan",
        ),
    )

    // MARK: - Demo Clusters (Pets)

    private val demoPetClusters = listOf(
        ClusterSummary(
            id = "demo_pet1",
            label = "Buddy",
            detCount = 8,
            photoCount = 6,
            avatar = "demo://file_dog-retriever",
            thumbUrl = "demo://file_dog-retriever",
            photoUrl = "demo://file_dog-retriever",
        ),
    )

    // MARK: - Demo Clusters (Vehicles)

    private val demoVehicleClusters = listOf(
        ClusterSummary(
            id = "demo_v1",
            label = "Family Van",
            detCount = 4,
            photoCount = 3,
            avatar = "demo://file_family-campervan",
            thumbUrl = "demo://file_family-campervan",
            photoUrl = "demo://file_family-campervan",
        ),
    )

    // MARK: - Public API

    fun getClusterSummary(category: String): ClustersSummaryResponse {
        val clusters = when (category) {
            "people" -> demoPeopleClusters
            "pets" -> demoPetClusters
            "vehicles" -> demoVehicleClusters
            else -> demoPeopleClusters
        }
        return ClustersSummaryResponse(clusters = clusters, noiseCount = 0)
    }

    fun getStats(): Stats = Stats(
        people = CategoryStats(detections = 123, photos = 101, groups = 5),
        pets = CategoryStats(detections = 8, photos = 6, groups = 1),
        vehicles = CategoryStats(detections = 4, photos = 3, groups = 1),
    )

    /**
     * Returns a list of Detection objects for a specific cluster,
     * simulating the cluster detail API response.
     */
    fun getClusterDetail(category: String, clusterId: String): List<Detection> {
        val clusters = getClusterSummary(category).clusters
        val cluster = clusters.firstOrNull { it.id == clusterId } ?: return emptyList()

        // Generate detections from available demo drawables, cycling through them
        val count = cluster.photoCount
        return (0 until count).map { i ->
            val key = demoKeys[i % demoKeys.size]
            Detection(
                id = "${clusterId}_det_$i",
                category = category,
                subtype = if (category == "people") "face" else category,
                photoId = "${clusterId}_photo_$i",
                photoUrl = "demo://file_$key",
                thumbUrl = "demo://file_$key",
                flickrUrl = null,
                photoTitle = cluster.label?.let { "$it - Photo ${i + 1}" } ?: "Photo ${i + 1}",
                owner = null,
                detScore = 0.95f,
                chip = null,
            )
        }
    }

    /**
     * Searches demo photos by keyword, matching against photo titles and known terms.
     * Mirrors the iOS search_results.json logic.
     */
    fun searchDemoPhotos(query: String): List<SearchResult> {
        val q = query.lowercase()

        // Keyword to demo photo mappings
        val keywordMap = mapOf(
            "campfire" to listOf("family-campfire-1"),
            "fire" to listOf("family-campfire-1"),
            "sunset" to listOf("couple-sunset"),
            "couple" to listOf("couple-sunset"),
            "golden" to listOf("couple-sunset"),
            "holiday" to listOf("family-holiday-1"),
            "christmas" to listOf("family-holiday-1"),
            "gathering" to listOf("family-holiday-1"),
            "dog" to listOf("dog-retriever"),
            "buddy" to listOf("dog-retriever"),
            "retriever" to listOf("dog-retriever"),
            "pet" to listOf("dog-retriever"),
            "park" to listOf("dog-retriever"),
            "campervan" to listOf("family-campervan"),
            "van" to listOf("family-campervan"),
            "road" to listOf("family-campervan"),
            "trip" to listOf("family-campervan"),
            "beach" to listOf("couple-sunset", "family-campervan"),
            "joy" to listOf("mom-child-joy"),
            "child" to listOf("mom-child-joy"),
            "maya" to listOf("mom-child-joy"),
            "mom" to listOf("family-campfire-1", "mom-child-joy"),
            "dad" to listOf("couple-sunset", "family-holiday-1"),
            "family" to listOf("family-campfire-1", "family-holiday-1", "family-campervan"),
            "birthday" to listOf("family-holiday-1", "mom-child-joy"),
        )

        // Collect matching keys
        val matchedKeys = mutableSetOf<String>()
        keywordMap.forEach { (keyword, keys) ->
            if (keyword.contains(q) || q.contains(keyword)) {
                matchedKeys.addAll(keys)
            }
        }

        // If no keyword matches, try fuzzy matching against all demo photo keys
        if (matchedKeys.isEmpty()) {
            demoKeys.forEach { key ->
                if (key.contains(q)) {
                    matchedKeys.add(key)
                }
            }
        }

        // Build search results
        return matchedKeys.mapIndexed { index, key ->
            val titleMap = mapOf(
                "family-campfire-1" to "Campfire evening",
                "couple-sunset" to "Golden hour",
                "family-holiday-1" to "Holiday gathering",
                "dog-retriever" to "Buddy at the park",
                "family-campervan" to "Road trip",
                "mom-child-joy" to "Afternoon light",
            )
            SearchResult(
                photoId = "search_$key",
                distance = 0.1f + (index * 0.05f),
                photoUrl = "demo://file_$key",
                thumbUrl = "demo://file_$key",
                flickrUrl = null,
                photoTitle = titleMap[key] ?: key.replace("-", " ").replaceFirstChar { it.uppercase() },
                owner = null,
                matchType = null,
                matchName = null,
                matchClusterId = null,
                matchCategory = null,
            )
        }
    }

    fun getTimeline(): TimelineResponse = TimelineResponse(
        months = listOf(
            TimelineMonth(
                month = "2024-12",
                count = 18,
                photos = listOf(
                    TimelinePhoto(
                        photoId = "demo_t1",
                        thumbUrl = "demo://file_family-campfire-1",
                        flickrUrl = null,
                        photoTitle = "Campfire evening",
                        dateTaken = "2024-12-20",
                    ),
                    TimelinePhoto(
                        photoId = "demo_t2",
                        thumbUrl = "demo://file_couple-sunset",
                        flickrUrl = null,
                        photoTitle = "Golden hour",
                        dateTaken = "2024-12-18",
                    ),
                    TimelinePhoto(
                        photoId = "demo_t3",
                        thumbUrl = "demo://file_family-holiday-1",
                        flickrUrl = null,
                        photoTitle = "Holiday gathering",
                        dateTaken = "2024-12-15",
                    ),
                ),
            ),
            TimelineMonth(
                month = "2022-08",
                count = 12,
                photos = listOf(
                    TimelinePhoto(
                        photoId = "demo_t4",
                        thumbUrl = "demo://file_family-campervan",
                        flickrUrl = null,
                        photoTitle = "Road trip",
                        dateTaken = "2022-08-14",
                    ),
                    TimelinePhoto(
                        photoId = "demo_t5",
                        thumbUrl = "demo://file_mom-child-joy",
                        flickrUrl = null,
                        photoTitle = "Afternoon light",
                        dateTaken = "2022-08-10",
                    ),
                    TimelinePhoto(
                        photoId = "demo_t6",
                        thumbUrl = "demo://file_dog-retriever",
                        flickrUrl = null,
                        photoTitle = "Buddy at the park",
                        dateTaken = "2022-08-05",
                    ),
                ),
            ),
        ),
    )
}
