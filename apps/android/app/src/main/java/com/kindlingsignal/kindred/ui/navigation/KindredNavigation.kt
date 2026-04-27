package com.kindlingsignal.kindred.ui.navigation

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.data.model.Detection
import com.kindlingsignal.kindred.ui.auth.AuthViewModel
import com.kindlingsignal.kindred.ui.auth.JoinScreen
import com.kindlingsignal.kindred.ui.auth.LoginScreen
import com.kindlingsignal.kindred.ui.auth.ServerSetupScreen
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
import com.kindlingsignal.kindred.ui.upload.UploadScreen

/**
 * Navigation destinations used by the app.
 */
private sealed class Screen {
    data object ServerSetup : Screen()
    data object Login : Screen()
    data object Join : Screen()
    data object Tabs : Screen()
    data class ClusterDetail(val category: String, val clusterId: String) : Screen()
    data object Together : Screen()
    data class FullScreenPhoto(val photos: List<Detection>, val initialIndex: Int) : Screen()
    data class FullScreenPhotoSimple(val urls: List<String>, val titles: List<String>, val initialIndex: Int) : Screen()
    data object Upload : Screen()
}

/**
 * Root navigation shell -- auth check + bottom bar + tab content + push screens.
 * Uses a simple back stack to support Detail -> FullScreen -> back to Detail.
 */
@Composable
fun KindredNavigation() {
    val authViewModel: AuthViewModel = hiltViewModel()
    val isLoggedIn by authViewModel.isLoggedIn.collectAsStateWithLifecycle()
    val isDemoMode by authViewModel.isDemoMode.collectAsStateWithLifecycle()
    val hasBaseUrl by authViewModel.hasBaseUrl.collectAsStateWithLifecycle(initialValue = false)

    var selectedTab by rememberSaveable { mutableIntStateOf(0) }

    // Determine initial screen based on auth state
    val initialScreen = remember(isLoggedIn, isDemoMode, hasBaseUrl) {
        when {
            isLoggedIn || isDemoMode -> Screen.Tabs
            !hasBaseUrl -> Screen.ServerSetup
            else -> Screen.Login
        }
    }

    // Back stack: the current screen is screenStack.last()
    val screenStack = remember { mutableStateListOf<Screen>(Screen.Tabs) }

    // Update root screen when auth state changes
    LaunchedEffect(initialScreen) {
        if (screenStack.size == 1 || screenStack.first() != initialScreen) {
            screenStack.clear()
            screenStack.add(initialScreen)
        }
    }

    val currentScreen = screenStack.lastOrNull() ?: Screen.Tabs

    val navigateTo: (Screen) -> Unit = { screen ->
        screenStack.add(screen)
    }
    val navigateBack: () -> Unit = {
        if (screenStack.size > 1) {
            screenStack.removeAt(screenStack.lastIndex)
        }
    }
    val navigateToRoot: (Screen) -> Unit = { screen ->
        screenStack.clear()
        screenStack.add(screen)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(KindredColors.Paper),
    ) {
        when (val screen = currentScreen) {
            is Screen.ServerSetup -> {
                ServerSetupScreen(
                    viewModel = authViewModel,
                    onSetupComplete = {
                        navigateToRoot(Screen.Login)
                    },
                    onSkipToDemo = {
                        authViewModel.enterDemo()
                    },
                )
            }

            is Screen.Login -> {
                LoginScreen(
                    viewModel = authViewModel,
                    onLoginSuccess = {
                        selectedTab = 0
                        navigateToRoot(Screen.Tabs)
                    },
                    onJoinClick = {
                        navigateTo(Screen.Join)
                    },
                )
            }

            is Screen.Join -> {
                JoinScreen(
                    viewModel = authViewModel,
                    onBack = navigateBack,
                    onJoinSuccess = {
                        selectedTab = 0
                        navigateToRoot(Screen.Tabs)
                    },
                )
            }

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
                                selectedTab = 0
                            },
                            onSignOut = {
                                navigateToRoot(Screen.Login)
                            },
                            onUploadClick = {
                                navigateTo(Screen.Upload)
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
                                authViewModel.signOut()
                                navigateToRoot(Screen.Login)
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

            is Screen.Upload -> {
                UploadScreen(
                    onBack = navigateBack,
                )
            }
        }
    }
}
