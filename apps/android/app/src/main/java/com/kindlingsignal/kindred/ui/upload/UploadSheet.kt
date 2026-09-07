package com.kindlingsignal.kindred.ui.upload

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.kindlingsignal.kindred.data.sync.PhotoSyncManager
import com.kindlingsignal.kindred.ui.components.KindredEyebrow
import com.kindlingsignal.kindred.ui.components.KindredImage
import com.kindlingsignal.kindred.ui.components.KindredMeta
import com.kindlingsignal.kindred.ui.components.KindredPillButton
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredTheme
import com.kindlingsignal.kindred.ui.theme.KindredType
import java.util.Locale

/**
 * Screen 9 — the Upload sheet.
 *
 * A Material modal bottom sheet with the 28dp top radius and the 32x4 drag
 * handle, carrying Kindred's own content: the mono UPLOAD eyebrow, a 21sp
 * title, the album row, per-file queue rows with a 4dp progress bar (sage when
 * done, terracotta in flight), then "Upload all" and "Done".
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UploadSheet(
    sheetState: SheetState,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: UploadViewModel = hiltViewModel(),
) {
    val colors = KindredTheme.colors
    val context = LocalContext.current
    val queue by viewModel.queue.collectAsStateWithLifecycle()
    val albums by viewModel.albums.collectAsStateWithLifecycle()
    val selectedAlbum by viewModel.selectedAlbum.collectAsStateWithLifecycle()
    val syncState by viewModel.syncState.collectAsStateWithLifecycle()
    val pending by viewModel.pendingCount.collectAsStateWithLifecycle()
    var albumMenuOpen by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = colors.sheet,
        shape = KindredShape.Sheet,
        dragHandle = {
            Box(
                modifier = Modifier
                    .padding(top = 10.dp, bottom = 18.dp)
                    .width(32.dp)
                    .height(4.dp)
                    .clip(KindredShape.Pill)
                    .background(colors.inkPrimary.copy(alpha = 0.3f))
            )
        },
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 26.dp),
        ) {
            KindredEyebrow("Upload")
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Add to the library",
                style = KindredType.TitleLarge,
                color = colors.inkPrimary,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Saved to your NAS, mirrored to Flickr, then analyzed on your server.",
                style = KindredType.BodySmall,
                color = colors.inkBody,
            )

            Spacer(Modifier.height(16.dp))

            Box {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(KindredShape.Small)
                        .background(colors.fillSoft)
                        .border(1.dp, colors.hairline, KindredShape.Small)
                        .clickable(role = Role.Button) { albumMenuOpen = true }
                        .defaultMinSize(minHeight = 52.dp)
                        .padding(horizontal = 14.dp, vertical = 8.dp)
                        .semantics {
                            contentDescription = "Album: " +
                                (selectedAlbum?.name ?: "none chosen") + ". Tap to change."
                        },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        text = "ALBUM",
                        style = KindredType.MetaSmall,
                        color = colors.inkMeta,
                    )
                    Text(
                        text = selectedAlbum?.name ?: "No album",
                        style = KindredType.Label,
                        color = colors.inkPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.weight(1f))
                    Icon(
                        imageVector = Icons.Filled.KeyboardArrowDown,
                        contentDescription = null,
                        tint = colors.inkMeta,
                        modifier = Modifier.size(15.dp),
                    )
                }
                DropdownMenu(
                    expanded = albumMenuOpen,
                    onDismissRequest = { albumMenuOpen = false },
                    containerColor = colors.sheet,
                ) {
                    DropdownMenuItem(
                        text = { Text("No album", style = KindredType.Label, color = colors.inkBody) },
                        onClick = {
                            viewModel.selectAlbum(null)
                            albumMenuOpen = false
                        },
                    )
                    albums.forEach { album ->
                        DropdownMenuItem(
                            text = {
                                Text(
                                    text = album.name,
                                    style = KindredType.Label,
                                    color = if (album.id == selectedAlbum?.id) colors.terracotta
                                    else colors.inkPrimary,
                                )
                            },
                            onClick = {
                                viewModel.selectAlbum(album)
                                albumMenuOpen = false
                            },
                        )
                    }
                    // TODO: creating an album from here needs POST /albums,
                    // which exists; the sheet keeps to picking one for now so
                    // the naming flow does not live in two places.
                }
            }

            Spacer(Modifier.height(12.dp))

            if (queue.isEmpty()) {
                Text(
                    text = if (pending == 0) "Everything on this phone is already in the library."
                    else "$pending photos on this phone are not in the library yet.",
                    style = KindredType.BodySmall,
                    color = colors.inkBody,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.heightIn(max = 260.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(queue, key = { it.uri }) { item -> QueueRow(item) }
                }
            }

            Spacer(Modifier.height(18.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KindredPillButton(
                    label = if (syncState.isSyncing) "Uploading…" else "Upload all",
                    onClick = { if (!syncState.isSyncing) viewModel.startSync(context) },
                    minHeight = 48.dp,
                    modifier = Modifier.weight(1f),
                    contentDescription = if (syncState.isSyncing) "Upload in progress"
                    else "Upload all $pending photos",
                )
                KindredPillButton(
                    label = "Done",
                    onClick = onDismiss,
                    filled = false,
                    minHeight = 48.dp,
                )
            }
        }
    }
}

@Composable
private fun QueueRow(item: PhotoSyncManager.QueueItem) {
    val colors = KindredTheme.colors
    val done = item.status == PhotoSyncManager.QueueItem.Status.DONE
    val failed = item.status == PhotoSyncManager.QueueItem.Status.FAILED
    val statusLabel = when (item.status) {
        PhotoSyncManager.QueueItem.Status.WAITING -> "Waiting"
        PhotoSyncManager.QueueItem.Status.UPLOADING -> "Uploading"
        PhotoSyncManager.QueueItem.Status.DONE -> "Uploaded · analyzing"
        PhotoSyncManager.QueueItem.Status.FAILED -> "Failed"
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(KindredShape.Small)
            .background(colors.fillSoft)
            .border(1.dp, colors.hairline, KindredShape.Small)
            .padding(10.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = "${item.name}, $statusLabel"
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // The content:// URI loads straight from MediaStore, so the row shows
        // the photo being uploaded rather than a generic file glyph.
        KindredImage(
            url = item.uri,
            contentDescription = null,
            modifier = Modifier
                .size(44.dp)
                .clip(KindredShape.Chip),
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = item.name,
                    style = KindredType.body(13, androidx.compose.ui.text.font.FontWeight.SemiBold),
                    color = colors.inkPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.weight(1f))
                KindredMeta(formatBytes(item.sizeBytes))
            }
            // The upload is a single multipart POST with no progress callback,
            // so an in-flight row is indeterminate rather than showing an
            // invented percentage. A resumable upload (the backend's
            // /uploads/resumable routes) would give real per-chunk progress.
            val barModifier = Modifier
                .fillMaxWidth()
                .height(4.dp)
                .clip(KindredShape.Pill)
            if (item.status == PhotoSyncManager.QueueItem.Status.UPLOADING) {
                LinearProgressIndicator(
                    color = colors.terracotta,
                    trackColor = colors.inkPrimary.copy(alpha = 0.12f),
                    modifier = barModifier,
                )
            } else {
                LinearProgressIndicator(
                    progress = { if (done) 1f else 0f },
                    color = if (done) colors.sage else colors.terracotta,
                    trackColor = colors.inkPrimary.copy(alpha = 0.12f),
                    drawStopIndicator = { },
                    gapSize = 0.dp,
                    modifier = barModifier,
                )
            }
            Text(
                text = statusLabel,
                style = KindredType.MetaSmall,
                color = when {
                    done -> colors.sageInk
                    failed -> colors.dangerInk
                    else -> colors.inkMeta
                },
            )
        }
    }
}

private fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "—"
    val mb = bytes / 1_048_576.0
    return if (mb >= 1) String.format(Locale.US, "%.1f MB", mb)
    else String.format(Locale.US, "%d KB", (bytes / 1024).coerceAtLeast(1))
}
