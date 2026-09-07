package com.kindlingsignal.kindred.ui.navigation

import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.auth.AuthViewModel
import com.kindlingsignal.kindred.ui.auth.JoinScreen
import com.kindlingsignal.kindred.ui.auth.LoginScreen
import com.kindlingsignal.kindred.ui.auth.ServerSetupScreen
import com.kindlingsignal.kindred.ui.components.KindredDestination
import com.kindlingsignal.kindred.ui.components.KindredNavigationBar
import com.kindlingsignal.kindred.ui.components.KindredNavigationRail
import com.kindlingsignal.kindred.ui.components.KindredVerticalHairline
import com.kindlingsignal.kindred.ui.components.MosaicTile
import com.kindlingsignal.kindred.ui.components.UploadFab
import com.kindlingsignal.kindred.ui.gallery.FavoritesScreen
import com.kindlingsignal.kindred.ui.gallery.SharesScreen
import com.kindlingsignal.kindred.ui.home.HomeScreen
import com.kindlingsignal.kindred.ui.library.LibraryScreen
import com.kindlingsignal.kindred.ui.people.PeopleScreen
import com.kindlingsignal.kindred.ui.people.PersonDetailScreen
import com.kindlingsignal.kindred.ui.people.ReviewScreen
import com.kindlingsignal.kindred.ui.search.SearchScreen
import com.kindlingsignal.kindred.ui.settings.SettingsScreen
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType
import com.kindlingsignal.kindred.ui.together.TogetherScreen
import com.kindlingsignal.kindred.ui.upload.UploadSheet
import com.kindlingsignal.kindred.ui.videos.VideosScreen
import com.kindlingsignal.kindred.ui.viewer.PhotoViewerScreen
import kotlinx.coroutines.launch

/**
 * The screens the shell can push on top of a destination.
 *
 * Kept as a small sealed hierarchy over an explicit back stack rather than
 * navigation-compose routes: the viewer and the person screens take whole
 * lists of tiles, which do not survive a string route without re-fetching what
 * the caller already has in hand.
 */
private sealed interface Pushed {
    data class People(val category: String, val title: String) : Pushed
    data class Person(val category: String, val clusterId: String) : Pushed
    data class Review(val category: String) : Pushed
    data object Videos : Pushed
    data object Favorites : Pushed
    data object Shares : Pushed
    data class Together(val seedClusterId: String?) : Pushed
    data class Viewer(val tiles: List<MosaicTile>, val index: Int) : Pushed
}

private sealed interface Root {
    data object ServerSetup : Root
    data object Login : Root
    data object Join : Root
    data object Tabs : Root
}

/**
 * The navigation shell.
 *
 * Phones get the Material navigation bar; tablets (600dp and wider) get the
 * navigation rail instead, per screen 12 of `ANDROID.md`. Which one shows is
 * derived from the current configuration, so a rotation or an unfold moves
 * between them without losing the selected destination, the back stack, or any
 * view model state.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KindredNavigation() {
    val authViewModel: AuthViewModel = hiltViewModel()
    val isLoggedIn by authViewModel.isLoggedIn.collectAsStateWithLifecycle()
    val isDemoMode by authViewModel.isDemoMode.collectAsStateWithLifecycle()
    val hasBaseUrl by authViewModel.hasBaseUrl.collectAsStateWithLifecycle(initialValue = false)

    val colors = KindredTheme.colors
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var uploadOpen by rememberSaveable { mutableStateOf(false) }

    var destination by rememberSaveable { mutableStateOf(KindredDestination.HOME) }
    val stack = remember { mutableStateListOf<Pushed>() }

    val root = remember(isLoggedIn, isDemoMode, hasBaseUrl) {
        when {
            isLoggedIn || isDemoMode -> Root.Tabs
            !hasBaseUrl -> Root.ServerSetup
            else -> Root.Login
        }
    }
    var authRoot by remember { mutableStateOf<Root>(root) }
    LaunchedEffect(root) { authRoot = root }

    // The rail replaces the bottom bar at tablet widths. Reading the
    // configuration rather than remembering a device class means a fold or a
    // rotation is just a recomposition.
    val isTablet = LocalConfiguration.current.screenWidthDp >= 600

    fun push(screen: Pushed) {
        stack.add(screen)
    }

    fun pop() {
        if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex)
    }

    BackHandler(enabled = stack.isNotEmpty(), onBack = ::pop)

    when (authRoot) {
        is Root.ServerSetup -> {
            ServerSetupScreen(
                viewModel = authViewModel,
                onSetupComplete = { authRoot = Root.Login },
                onSkipToDemo = { authViewModel.enterDemo() },
            )
            return
        }

        is Root.Login -> {
            LoginScreen(
                viewModel = authViewModel,
                onLoginSuccess = {
                    destination = KindredDestination.HOME
                    authRoot = Root.Tabs
                },
                onJoinClick = { authRoot = Root.Join },
            )
            return
        }

        is Root.Join -> {
            JoinScreen(
                viewModel = authViewModel,
                onBack = { authRoot = Root.Login },
                onJoinSuccess = {
                    destination = KindredDestination.HOME
                    authRoot = Root.Tabs
                },
            )
            return
        }

        is Root.Tabs -> Unit
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = drawerState.isOpen,
        drawerContent = {
            ModalDrawerSheet(drawerContainerColor = colors.sheet) {
                Text(
                    text = "Kindred",
                    style = KindredType.AppBarTitle,
                    color = colors.inkPrimary,
                    modifier = Modifier.padding(24.dp),
                )
                listOf(
                    "People" to { push(Pushed.People("people", "People")) },
                    "Animals" to { push(Pushed.People("pets", "Animals")) },
                    "Videos" to { push(Pushed.Videos) },
                    "Favorites" to { push(Pushed.Favorites) },
                    "Shared links" to { push(Pushed.Shares) },
                ).forEach { (label, action) ->
                    NavigationDrawerItem(
                        label = { Text(label, style = KindredType.Label, color = colors.inkPrimary) },
                        selected = false,
                        onClick = {
                            action()
                            scope.launch { drawerState.close() }
                        },
                        colors = NavigationDrawerItemDefaults.colors(
                            unselectedContainerColor = colors.sheet,
                        ),
                        modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                    )
                }
            }
        },
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.bg),
        ) {
            Row(Modifier.fillMaxSize()) {
                if (isTablet) {
                    KindredNavigationRail(
                        selected = destination,
                        onSelect = {
                            destination = it
                            stack.clear()
                        },
                        onUpload = { uploadOpen = true },
                    )
                    KindredVerticalHairline()
                }

                Box(Modifier.weight(1f)) {
                    // On a tablet the rail is beside the content, so the system
                    // navigation bar is the only thing at the bottom and the
                    // lists inset for it. On a phone the app's own navigation
                    // bar already sits there and each screen ends with a tail
                    // spacer that clears it.
                    val padding = if (isTablet) {
                        WindowInsets.navigationBars.asPaddingValues()
                    } else {
                        PaddingValues(0.dp)
                    }

                    Destinations(
                        destination = destination,
                        snackbarHostState = snackbarHostState,
                        contentPadding = padding,
                        onMenuClick = { scope.launch { drawerState.open() } },
                        onSearch = { destination = KindredDestination.SEARCH },
                        onLeaveSearch = { destination = KindredDestination.HOME },
                        onOpenPeople = { push(Pushed.People("people", "People")) },
                        onOpenAnimals = { push(Pushed.People("pets", "Animals")) },
                        onOpenVideos = { push(Pushed.Videos) },
                        onOpenFavorites = { push(Pushed.Favorites) },
                        onOpenShares = { push(Pushed.Shares) },
                        onOpenViewer = { tiles, index -> push(Pushed.Viewer(tiles, index)) },
                        onSignOut = { authRoot = Root.Login },
                    )

                    // Entry is the handoff's rise and fade, on its own easing.
                    // Crossfade rather than AnimatedVisibility: the pushed
                    // screen replaces what is underneath, and Crossfade keeps
                    // the outgoing one composed for the length of the swap.
                    Crossfade(
                        targetState = stack.lastOrNull(),
                        animationSpec = tween(220),
                        label = "pushedScreen",
                    ) { screen ->
                        if (screen != null) {
                            Box(
                                Modifier
                                    .fillMaxSize()
                                    .background(colors.bg)
                            ) {
                                PushedScreen(
                                    screen = screen,
                                    snackbarHostState = snackbarHostState,
                                    onBack = ::pop,
                                    onPush = ::push,
                                )
                            }
                        }
                    }

                    if (!isTablet) {
                        Column(
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .fillMaxWidth(),
                        ) {
                            // The FAB is hidden behind a pushed screen: those
                            // are reading contexts, and Upload belongs to the
                            // destinations.
                            if (stack.isEmpty() &&
                                destination in setOf(KindredDestination.HOME, KindredDestination.LIBRARY)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(end = 16.dp, bottom = 16.dp),
                                    contentAlignment = Alignment.CenterEnd,
                                ) {
                                    UploadFab(onClick = { uploadOpen = true })
                                }
                            }
                            KindredNavigationBar(
                                selected = destination,
                                onSelect = {
                                    destination = it
                                    stack.clear()
                                },
                            )
                        }
                    }
                }
            }

            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = if (isTablet) 24.dp else 96.dp),
            )
        }
    }

    if (uploadOpen) {
        UploadSheet(
            sheetState = sheetState,
            onDismiss = {
                scope.launch { sheetState.hide() }.invokeOnCompletion { uploadOpen = false }
            },
        )
    }
}

@Composable
private fun Destinations(
    destination: KindredDestination,
    snackbarHostState: SnackbarHostState,
    contentPadding: PaddingValues,
    onMenuClick: () -> Unit,
    onSearch: () -> Unit,
    onLeaveSearch: () -> Unit,
    onOpenPeople: () -> Unit,
    onOpenAnimals: () -> Unit,
    onOpenVideos: () -> Unit,
    onOpenFavorites: () -> Unit,
    onOpenShares: () -> Unit,
    onOpenViewer: (List<MosaicTile>, Int) -> Unit,
    onSignOut: () -> Unit,
) {
    // `when` rather than keeping all four alive: each destination's view model
    // is scoped to the navigation graph and survives the swap, so the only
    // thing lost is scroll position, and holding four mosaics in memory at once
    // is the worse trade on a library this size.
    when (destination) {
        KindredDestination.HOME -> HomeScreen(
            onSearchClick = onSearch,
            onPhotoClick = onOpenViewer,
            onNotificationsClick = { },
            onAccountClick = { },
            contentPadding = contentPadding,
        )

        KindredDestination.LIBRARY -> LibraryScreen(
            onMenuClick = onMenuClick,
            onOpenPeople = onOpenPeople,
            onOpenAnimals = onOpenAnimals,
            onOpenVideos = onOpenVideos,
            onSearchClick = onSearch,
            onPhotoClick = onOpenViewer,
            snackbarHostState = snackbarHostState,
            contentPadding = contentPadding,
        )

        KindredDestination.SEARCH -> SearchScreen(
            onBack = onLeaveSearch,
            onPhotoClick = onOpenViewer,
            contentPadding = contentPadding,
        )

        KindredDestination.SETTINGS -> SettingsScreen(
            onSignOut = onSignOut,
            onOpenFavorites = onOpenFavorites,
            onOpenShares = onOpenShares,
            contentPadding = contentPadding,
        )
    }
}

@Composable
private fun PushedScreen(
    screen: Pushed,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
    onPush: (Pushed) -> Unit,
) {
    when (screen) {
        is Pushed.People -> PeopleScreen(
            category = screen.category,
            title = screen.title,
            onBack = onBack,
            onPersonClick = { cluster -> onPush(Pushed.Person(screen.category, cluster.id)) },
            onReview = { onPush(Pushed.Review(screen.category)) },
        )

        is Pushed.Person -> PersonDetailScreen(
            category = screen.category,
            clusterId = screen.clusterId,
            onBack = onBack,
            onTogether = { onPush(Pushed.Together(screen.clusterId)) },
            onPhotoClick = { tiles, index -> onPush(Pushed.Viewer(tiles, index)) },
        )

        is Pushed.Review -> ReviewScreen(
            category = screen.category,
            onBack = onBack,
            snackbarHostState = snackbarHostState,
        )

        is Pushed.Videos -> VideosScreen(
            onBack = onBack,
            onPlay = { video ->
                onPush(
                    Pushed.Viewer(
                        tiles = listOf(
                            MosaicTile(
                                id = video.id,
                                imageUrl = video.posterUrl,
                                label = video.title,
                                isVideo = true,
                                durationLabel = video.duration,
                            )
                        ),
                        index = 0,
                    )
                )
            },
        )

        is Pushed.Favorites -> FavoritesScreen(
            onBack = onBack,
            onPhotoClick = { tiles, index -> onPush(Pushed.Viewer(tiles, index)) },
        )

        is Pushed.Shares -> SharesScreen(onBack = onBack)

        is Pushed.Together -> TogetherScreen(
            seedClusterId = screen.seedClusterId,
            onBack = onBack,
            onPhotoClick = { tiles, index -> onPush(Pushed.Viewer(tiles, index)) },
        )

        is Pushed.Viewer -> PhotoViewerScreen(
            tiles = screen.tiles,
            initialIndex = screen.index,
            onBack = onBack,
            snackbarHostState = snackbarHostState,
        )
    }
}
