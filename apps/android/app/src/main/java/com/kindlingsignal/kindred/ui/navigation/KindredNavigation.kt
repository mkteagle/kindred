package com.kindlingsignal.kindred.ui.navigation

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.data.model.Detection
import com.kindlingsignal.kindred.ui.components.DemoModeBanner
import com.kindlingsignal.kindred.ui.components.KindredBottomBar
import com.kindlingsignal.kindred.ui.detail.ClusterDetailScreen
import com.kindlingsignal.kindred.ui.detail.FullScreenPhotoView
import com.kindlingsignal.kindred.ui.detail.FullScreenPhotoViewSimple
import com.kindlingsignal.kindred.ui.home.HomeScreen
import com.kindlingsignal.kindred.ui.library.LibraryScreen
import com.kindlingsignal.kindred.ui.search.SearchScreen
import com.kindlingsignal.kindred.ui.settings.SettingsScreen
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.together.TogetherScreen

/**
 * Navigation destinations used by the app.
 */
private sealed class Screen {
    data object Tabs : Screen()
    data class ClusterDetail(val category: String, val clusterId: String) : Screen()
    data object Together : Screen()
    data class FullScreenPhoto(val photos: List<Detection>, val initialIndex: Int) : Screen()
    data class FullScreenPhotoSimple(val urls: List<String>, val titles: List<String>, val initialIndex: Int) : Screen()
}

/**
 * Root navigation shell -- bottom bar + tab content + push screens.
 * Uses a simple back stack to support Detail -> FullScreen -> back to Detail.
 */
@Composable
fun KindredNavigation() {
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }
    var isDemoMode by remember { mutableStateOf(DemoDataProvider.isActive) }

    // Back stack: the current screen is screenStack.last()
    val screenStack = remember { mutableStateListOf<Screen>(Screen.Tabs) }

    val currentScreen = screenStack.lastOrNull() ?: Screen.Tabs

    val navigateTo: (Screen) -> Unit = { screen ->
        screenStack.add(screen)
    }
    val navigateBack: () -> Unit = {
        if (screenStack.size > 1) {
            screenStack.removeAt(screenStack.lastIndex)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(KindredColors.Paper),
    ) {
        when (val screen = currentScreen) {
            is Screen.Tabs -> {
                // Tab content -- keep all screens in the tree, toggle visibility
                Box(modifier = Modifier.fillMaxSize()) {
                    // Home
                    AnimatedVisibility(
                        visible = selectedTab == 0,
                        enter = fadeIn(),
                        exit = fadeOut(),
                    ) {
                        HomeScreen(
                            onTogetherClick = {
                                navigateTo(Screen.Together)
                            },
                        )
                    }

                    // Library
                    AnimatedVisibility(
                        visible = selectedTab == 1,
                        enter = fadeIn(),
                        exit = fadeOut(),
                    ) {
                        LibraryScreen(
                            onClusterClick = { category, clusterId ->
                                navigateTo(Screen.ClusterDetail(category, clusterId))
                            },
                        )
                    }

                    // Search
                    AnimatedVisibility(
                        visible = selectedTab == 2,
                        enter = fadeIn(),
                        exit = fadeOut(),
                    ) {
                        SearchScreen(
                            onPhotoClick = { index, urls, titles ->
                                navigateTo(Screen.FullScreenPhotoSimple(urls, titles, index))
                            },
                        )
                    }

                    // Settings
                    AnimatedVisibility(
                        visible = selectedTab == 3,
                        enter = fadeIn(),
                        exit = fadeOut(),
                    ) {
                        SettingsScreen(
                            onEnterDemo = {
                                DemoDataProvider.activate()
                                isDemoMode = true
                                selectedTab = 0
                            },
                        )
                    }
                }

                // Bottom bar
                Column(
                    modifier = Modifier.align(Alignment.BottomCenter),
                ) {
                    if (isDemoMode) {
                        DemoModeBanner(
                            onExit = {
                                DemoDataProvider.deactivate()
                                isDemoMode = false
                            },
                        )
                    }

                    KindredBottomBar(
                        selectedTab = selectedTab,
                        onTabSelected = { selectedTab = it },
                    )
                }
            }

            is Screen.ClusterDetail -> {
                ClusterDetailScreen(
                    category = screen.category,
                    clusterId = screen.clusterId,
                    onBack = navigateBack,
                    onPhotoClick = { index, photos ->
                        navigateTo(Screen.FullScreenPhoto(photos, index))
                    },
                )
            }

            is Screen.Together -> {
                TogetherScreen(
                    onBack = navigateBack,
                )
            }

            is Screen.FullScreenPhoto -> {
                FullScreenPhotoView(
                    photos = screen.photos,
                    initialIndex = screen.initialIndex,
                    onDismiss = navigateBack,
                )
            }

            is Screen.FullScreenPhotoSimple -> {
                FullScreenPhotoViewSimple(
                    photoUrls = screen.urls,
                    photoTitles = screen.titles,
                    initialIndex = screen.initialIndex,
                    onDismiss = navigateBack,
                )
            }
        }
    }
}
