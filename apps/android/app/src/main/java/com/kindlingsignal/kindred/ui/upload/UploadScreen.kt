package com.kindlingsignal.kindred.ui.upload

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.components.KindredEyebrow
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Upload/sync screen showing progress and controls for photo uploads.
 */
@Composable
fun UploadScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: UploadViewModel = hiltViewModel(),
) {
    val syncState by viewModel.syncState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(KindredColors.Paper)
            .verticalScroll(rememberScrollState())
            .statusBarsPadding(),
    ) {
        // Top bar with back button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = KindredColors.Pine,
                modifier = Modifier
                    .size(24.dp)
                    .clickable { onBack() },
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = "Photo Sync",
                style = KindredType.Title,
                color = KindredColors.Ash,
            )
        }

        // Status card
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(top = 8.dp)
                .shadow(
                    elevation = 13.dp,
                    shape = KindredShape.RadiusMD,
                    ambientColor = KindredColors.CardShadow,
                    spotColor = KindredColors.CardShadow,
                )
                .clip(KindredShape.RadiusMD)
                .background(KindredColors.Card)
                .border(1.dp, KindredColors.Line, KindredShape.RadiusMD)
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(
                            if (syncState.isSyncing) KindredColors.Ember.copy(alpha = 0.12f)
                            else KindredColors.Forest.copy(alpha = 0.12f)
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = if (syncState.isSyncing) Icons.Outlined.Sync else Icons.Outlined.CloudUpload,
                        contentDescription = null,
                        tint = if (syncState.isSyncing) KindredColors.Ember else KindredColors.Forest,
                        modifier = Modifier.size(22.dp),
                    )
                }

                Column {
                    Text(
                        text = if (syncState.isSyncing) "Syncing..." else "Photo Sync",
                        style = KindredType.display(17),
                        color = KindredColors.Ash,
                    )
                    Text(
                        text = if (syncState.isSyncing)
                            "${syncState.syncedCount} of ${syncState.totalToSync} uploaded"
                        else if (syncState.totalToSync > 0)
                            "${syncState.syncedCount} uploaded, ${syncState.totalToSync - syncState.syncedCount} remaining"
                        else
                            "Ready to sync your photos",
                        style = KindredType.Meta,
                        color = KindredColors.Mist,
                    )
                }
            }

            // Progress bar
            if (syncState.isSyncing) {
                LinearProgressIndicator(
                    progress = { syncState.progress },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp)),
                    color = KindredColors.Ember,
                    trackColor = KindredColors.Canvas,
                )
            }

            // Error
            if (syncState.lastError != null) {
                Text(
                    text = "Error: ${syncState.lastError}",
                    style = KindredType.Caption,
                    color = KindredColors.Rosehip,
                )
            }
        }

        // Action buttons
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(top = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Start/Stop sync button
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(KindredShape.RadiusSM)
                    .background(
                        if (syncState.isSyncing) KindredColors.Rosehip else KindredColors.Ember
                    )
                    .clickable {
                        if (syncState.isSyncing) {
                            viewModel.stopSync()
                        } else {
                            viewModel.startSync(context)
                        }
                    }
                    .padding(vertical = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (syncState.isSyncing) "Stop Sync" else "Start Sync",
                    style = KindredType.Button,
                    color = KindredColors.Paper,
                )
            }
        }

        // Auto-sync toggle
        Column(
            modifier = Modifier.padding(top = 24.dp),
        ) {
            KindredEyebrow(
                text = "Settings",
                modifier = Modifier
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 8.dp),
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(KindredShape.RadiusMD)
                    .background(KindredColors.Card)
                    .border(1.dp, KindredColors.Line, KindredShape.RadiusMD)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Auto-sync",
                        style = KindredType.Label,
                        color = KindredColors.Ash,
                    )
                    Text(
                        text = "Automatically upload new photos in the background",
                        style = KindredType.Meta,
                        color = KindredColors.Mist,
                    )
                }

                Switch(
                    checked = syncState.autoSyncEnabled,
                    onCheckedChange = { viewModel.toggleAutoSync(context, it) },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = KindredColors.Paper,
                        checkedTrackColor = KindredColors.Forest,
                        uncheckedThumbColor = KindredColors.Mist,
                        uncheckedTrackColor = KindredColors.Canvas,
                    ),
                    modifier = Modifier.height(24.dp),
                )
            }
        }

        // Info section
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(top = 20.dp)
                .clip(KindredShape.RadiusMD)
                .background(KindredColors.Canvas)
                .border(1.dp, KindredColors.Line, KindredShape.RadiusMD)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "How sync works",
                style = KindredType.body(14, FontWeight.Bold),
                color = KindredColors.Ash,
            )
            Text(
                text = "Photos from your device are uploaded to Flickr via your household's connected account. " +
                        "The backend then processes them for face, pet, and vehicle recognition.",
                style = KindredType.Caption,
                color = KindredColors.Pine,
            )
            Text(
                text = "HEIC photos are automatically converted by the backend.",
                style = KindredType.Micro,
                color = KindredColors.Mist,
            )
        }

        Spacer(modifier = Modifier.height(120.dp))
    }
}
