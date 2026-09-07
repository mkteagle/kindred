package com.kindlingsignal.kindred

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import coil.ImageLoader
import coil.ImageLoaderFactory
import dagger.hilt.android.HiltAndroidApp
import okhttp3.OkHttpClient
import javax.inject.Inject

/**
 * Application class for Kindred Photos.
 * Annotated with @HiltAndroidApp to enable Hilt dependency injection.
 * Implements Configuration.Provider for Hilt-based WorkManager injection.
 */
@HiltAndroidApp
class KindredApp : Application(), Configuration.Provider, ImageLoaderFactory {

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    @Inject
    lateinit var okHttpClient: OkHttpClient

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()

    /**
     * Coil shares the app's OkHttp client so image requests carry the
     * `X-Session-Token` header the backend needs. The alternative — putting
     * the token in the image URL — would leak it into logs and caches.
     */
    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        .okHttpClient { okHttpClient }
        .crossfade(true)
        .build()
}
