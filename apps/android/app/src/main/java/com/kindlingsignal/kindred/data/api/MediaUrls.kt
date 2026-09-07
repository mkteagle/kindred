package com.kindlingsignal.kindred.data.api

import com.kindlingsignal.kindred.data.auth.SessionManager
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Builds URLs for `/photos/{id}/local?variant=…`.
 *
 * `/library/photos` and `/search` return catalog rows without image URLs — the
 * client composes them from the configured server. The session token is *not*
 * put in the query string: it travels in the `X-Session-Token` header that the
 * shared OkHttp client adds, and Coil is wired to that same client so image
 * requests carry it too.
 */
@Singleton
class MediaUrls @Inject constructor(
    private val sessionManager: SessionManager,
) {
    enum class Variant(val value: String) {
        /** Grid tiles and filmstrip frames. */
        THUMB("thumb"),

        /** The viewer stage and cover images. */
        PREVIEW("preview"),

        /** A short silent loop; videos only. */
        CLIP("clip"),

        /** The full file. Videos answer byte ranges, so Media3 can scrub. */
        ORIGINAL("original"),
    }

    private val base: String get() = sessionManager.baseUrl.value.trimEnd('/')

    /** Null when no server is configured yet, so callers show a placeholder. */
    fun local(photoId: String, variant: Variant = Variant.THUMB): String? {
        // Demo mode addresses bundled drawables by `demo://` id, so those pass
        // straight through rather than being turned into a server URL.
        if (photoId.startsWith("demo://")) return photoId
        val root = base
        if (root.isBlank()) return null
        return "$root/photos/$photoId/local?variant=${variant.value}"
    }

    fun thumb(photoId: String): String? = local(photoId, Variant.THUMB)

    fun preview(photoId: String): String? = local(photoId, Variant.PREVIEW)

    fun clip(photoId: String): String? = local(photoId, Variant.CLIP)

    fun original(photoId: String): String? = local(photoId, Variant.ORIGINAL)
}
