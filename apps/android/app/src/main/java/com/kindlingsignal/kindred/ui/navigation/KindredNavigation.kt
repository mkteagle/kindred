package com.kindlingsignal.kindred.ui.navigation

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.ui.components.DemoModeBanner
import com.kindlingsignal.kindred.ui.components.KindredBottomBar
import com.kindlingsignal.kindred.ui.home.HomeScreen
import com.kindlingsignal.kindred.ui.library.LibraryScreen
import com.kindlingsignal.kindred.ui.search.SearchScreen
import com.kindlingsignal.kindred.ui.settings.SettingsScreen
import com.kindlingsignal.kindred.ui.theme.KindredColors

/**
 * Root navigation shell — bottom bar + tab content.
 * Uses simple tab switching (same as iOS ContentView) rather than NavHost,
 * to keep all screens alive and preserve scroll state.
 */
@Composable
fun KindredNavigation() {
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }
    var isDemoMode by remember { mutableStateOf(DemoDataProvider.isActive) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(KindredColors.Paper),
    ) {
        // Tab content — keep all screens in the tree, toggle visibility
        Box(modifier = Modifier.fillMaxSize()) {
            // Home
            AnimatedVisibility(
                visible = selectedTab == 0,
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                HomeScreen()
            }

            // Library
            AnimatedVisibility(
                visible = selectedTab == 1,
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                LibraryScreen()
            }

            // Search
            AnimatedVisibility(
                visible = selectedTab == 2,
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                SearchScreen()
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
            // Demo mode banner (above bottom bar)
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
}
