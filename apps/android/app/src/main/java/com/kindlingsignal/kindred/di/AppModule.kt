package com.kindlingsignal.kindred.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import com.kindlingsignal.kindred.data.auth.FlickrAuthManager
import com.kindlingsignal.kindred.data.auth.SessionManager
import com.kindlingsignal.kindred.data.repository.KindredRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "kindred_prefs")

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideDataStore(
        @ApplicationContext context: Context,
    ): DataStore<Preferences> = context.dataStore

    @Provides
    @Singleton
    fun provideSessionManager(
        dataStore: DataStore<Preferences>,
    ): SessionManager = SessionManager(dataStore)

    @Provides
    @Singleton
    fun provideFlickrAuthManager(
        sessionManager: SessionManager,
    ): FlickrAuthManager = FlickrAuthManager(sessionManager)

    @Provides
    @Singleton
    fun provideKindredRepository(
        api: com.kindlingsignal.kindred.data.api.KindredApi,
        sessionManager: SessionManager,
    ): KindredRepository = KindredRepository(api, sessionManager)
}
