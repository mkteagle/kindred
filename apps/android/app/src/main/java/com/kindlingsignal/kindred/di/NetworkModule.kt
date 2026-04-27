package com.kindlingsignal.kindred.di

import com.kindlingsignal.kindred.BuildConfig
import com.kindlingsignal.kindred.data.api.KindredApi
import com.kindlingsignal.kindred.data.auth.SessionManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    /**
     * Auth interceptor that adds the session token to every request.
     * Reads the current token from SessionManager at request time.
     */
    @Provides
    @Singleton
    fun provideAuthInterceptor(
        sessionManager: SessionManager,
    ): Interceptor = Interceptor { chain ->
        val original = chain.request()
        val builder = original.newBuilder()

        // Add session token header if available
        val token = sessionManager.sessionToken.value
        if (!token.isNullOrBlank()) {
            builder.addHeader("X-Session-Token", token)
        }

        builder.addHeader("Accept", "application/json")
        chain.proceed(builder.build())
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(
        authInterceptor: Interceptor,
    ): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS) // uploads can be slow

        // Debug logging
        if (BuildConfig.DEBUG) {
            val loggingInterceptor = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BASIC
            }
            builder.addInterceptor(loggingInterceptor)
        }

        return builder.build()
    }

    /**
     * Retrofit instance that dynamically resolves the base URL.
     *
     * We use a placeholder base URL here because the real base URL comes
     * from SessionManager and can change at runtime. Each request's URL
     * is resolved via the auth interceptor's request builder if needed,
     * but Retrofit requires a non-empty base URL at construction time.
     *
     * The actual base URL is set by reconfiguring Retrofit when the user
     * configures their server. For dynamic base URL support, we use a
     * base URL interceptor.
     */
    @Provides
    @Singleton
    fun provideRetrofit(
        okHttpClient: OkHttpClient,
        sessionManager: SessionManager,
    ): Retrofit {
        // We add a dynamic base URL interceptor to the client
        val dynamicClient = okHttpClient.newBuilder()
            .addInterceptor { chain ->
                val original = chain.request()
                val baseUrl = sessionManager.baseUrl.value
                if (baseUrl.isNotBlank() && original.url.host == "placeholder.invalid") {
                    // Replace placeholder host with actual base URL
                    val newUrl = original.url.toString()
                        .replace("https://placeholder.invalid/", "$baseUrl/")
                    val newRequest = original.newBuilder()
                        .url(newUrl)
                        .build()
                    chain.proceed(newRequest)
                } else {
                    chain.proceed(original)
                }
            }
            .build()

        return Retrofit.Builder()
            .baseUrl("https://placeholder.invalid/")
            .client(dynamicClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    @Provides
    @Singleton
    fun provideKindredApi(
        retrofit: Retrofit,
    ): KindredApi = retrofit.create(KindredApi::class.java)
}
