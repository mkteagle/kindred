package com.kindlingsignal.kindred.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.components.KindredAvatar
import com.kindlingsignal.kindred.ui.components.KindredHairline
import com.kindlingsignal.kindred.ui.components.KindredMeta
import com.kindlingsignal.kindred.ui.components.KindredPillButton
import com.kindlingsignal.kindred.ui.components.KindredTopAppBar
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType
import com.kindlingsignal.kindred.util.formatCount

/**
 * Screen 11 — Settings.
 *
 * 18dp-radius grouped surfaces: the profile card, a Household group and a This
 * device group, with terracotta Material switches.
 */
@Composable
fun SettingsScreen(
    onSignOut: () -> Unit,
    onOpenFavorites: () -> Unit,
    onOpenShares: () -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val syncState by viewModel.syncState.collectAsStateWithLifecycle()
    val wifiOnly by viewModel.wifiOnly.collectAsStateWithLifecycle()
    val backendOnline by viewModel.backendOnline.collectAsStateWithLifecycle()
    val favorites by viewModel.favoritesCount.collectAsStateWithLifecycle()
    val shares by viewModel.shareCount.collectAsStateWithLifecycle()
    val colors = KindredTheme.colors
    val context = LocalContext.current

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = contentPadding,
    ) {
        item("bar") { KindredTopAppBar(title = "Settings") }

        item("profile") {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(KindredShape.Large)
                    .background(colors.fillSoft)
                    .border(1.dp, colors.hairline, KindredShape.Large)
                    .padding(15.dp)
                    .semantics(mergeDescendants = true) {
                        contentDescription = "${state.displayName}, ${state.role}"
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(13.dp),
            ) {
                KindredAvatar(
                    url = state.avatarUrl,
                    contentDescription = null,
                    size = 48.dp,
                    initial = state.displayName,
                )
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        text = state.displayName,
                        style = KindredType.display(17, androidx.compose.ui.text.font.FontWeight.SemiBold),
                        color = colors.inkPrimary,
                    )
                    KindredMeta("@${state.username} · ${state.role}")
                }
                Spacer(Modifier.weight(1f))
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    tint = colors.inkMeta,
                    modifier = Modifier.size(15.dp),
                )
            }
        }

        item("household") {
            SettingsGroup(title = "Household") {
                SettingsRow(
                    title = "Members",
                    // TODO: the handoff lists member names here. /users is
                    // admin-only, so a member sees the group without a roster;
                    // a member-safe household roster endpoint would close it.
                    subtitle = "Everyone who shares this library",
                    onClick = null,
                )
                KindredHairline()
                SettingsRow(
                    title = "Invite codes",
                    // TODO: /invites is admin-only too, so the count is not
                    // readable from a member session.
                    subtitle = "Ask an admin for a code",
                    onClick = null,
                )
                KindredHairline()
                SettingsRow(
                    title = "Shared links",
                    subtitle = if (shares == 1) "1 live share" else "${formatCount(shares)} live shares",
                    onClick = onOpenShares,
                )
                KindredHairline()
                SettingsRow(
                    title = "Favorites",
                    subtitle = "${formatCount(favorites)} of yours",
                    onClick = onOpenFavorites,
                )
            }
        }

        item("device") {
            SettingsGroup(title = "This device") {
                SettingsToggleRow(
                    title = "Back up my photos",
                    checked = syncState.autoSyncEnabled,
                    onCheckedChange = { viewModel.setBackupEnabled(context, it) },
                )
                KindredHairline()
                SettingsToggleRow(
                    title = "Only on Wi-Fi",
                    checked = wifiOnly,
                    onCheckedChange = { viewModel.setWifiOnly(context, it) },
                )
                KindredHairline()
                SettingsRow(
                    title = "Server",
                    subtitle = buildString {
                        append(state.serverUrl.ifBlank { "Not configured" })
                        when (backendOnline) {
                            true -> append(" · connected")
                            false -> append(" · unreachable")
                            null -> Unit
                        }
                    },
                    onClick = viewModel::checkBackendStatus,
                )
            }
        }

        item("sign-out") {
            Box(Modifier.padding(16.dp)) {
                KindredPillButton(
                    label = if (state.isDemoMode) "Leave demo mode" else "Sign out",
                    onClick = { viewModel.signOut(onSignOut) },
                    filled = false,
                    danger = true,
                    minHeight = 44.dp,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        item("tail") { Spacer(Modifier.height(120.dp)) }
    }
}

@Composable
private fun SettingsGroup(
    title: String,
    content: @Composable () -> Unit,
) {
    val colors = KindredTheme.colors
    Column(Modifier.padding(horizontal = 16.dp, vertical = 18.dp)) {
        Text(
            text = title.uppercase(),
            style = KindredType.Eyebrow,
            color = colors.inkMeta,
            modifier = Modifier
                .padding(start = 4.dp, bottom = 8.dp)
                .semantics { heading() },
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(KindredShape.Large)
                .background(colors.fillSoft)
                .border(1.dp, colors.hairline, KindredShape.Large),
        ) { content() }
    }
}

@Composable
private fun SettingsRow(
    title: String,
    subtitle: String?,
    onClick: (() -> Unit)?,
) {
    val colors = KindredTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick)
                else Modifier
            )
            .defaultMinSize(minHeight = 56.dp)
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .semantics(mergeDescendants = true) { },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.weight(1f)) {
            Text(text = title, style = KindredType.Label, color = colors.inkPrimary)
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    style = KindredType.MetaSmall,
                    color = colors.inkMeta,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (onClick != null) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = colors.inkMeta,
                modifier = Modifier.size(15.dp),
            )
        }
    }
}

@Composable
private fun SettingsToggleRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    val colors = KindredTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 56.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = KindredType.Label,
            color = colors.inkPrimary,
            modifier = Modifier.weight(1f),
        )
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = colors.onAccentInk,
                checkedTrackColor = colors.terracotta,
                checkedBorderColor = colors.terracotta,
                uncheckedThumbColor = colors.inkMeta,
                uncheckedTrackColor = colors.fillStrong,
                uncheckedBorderColor = colors.hairlineStrong,
            ),
            // The row's own title is the label; Switch announces its state.
            modifier = Modifier.semantics { contentDescription = title },
        )
    }
}
