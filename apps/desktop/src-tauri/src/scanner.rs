use std::sync::Arc;
use std::time::SystemTime;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::db::Db;
use crate::error::{AppError, Result};
use crate::sidecar;

// Everything Flickr accepts. Flickr converts BMP/TIFF/WebP/HEIC to JPEG
// server-side, so they're fine to upload. RAW formats are NOT in this list —
// Flickr rejects DNG/CR2/CR3/NEF/ARW etc.
const SUPPORTED_EXTENSIONS: &[&str] = &[
    // Images
    "jpg", "jpeg", "jfif", "png", "gif", "bmp", "tif", "tiff", "webp",
    "heic", "heif", "psd",
    // Videos
    "mp4", "mov", "m4v", "m4p", "avi", "wmv",
    "mpeg", "mpg", "3gp", "m2ts", "ogg", "ogv",
];

#[derive(Serialize, Clone, Debug)]
pub struct ScanProgress {
    pub scanned: usize,
    pub queued: usize,
    pub skipped: usize,
    pub sidecars: usize,
    pub current_dir: String,
}

pub async fn scan_dir(
    app: AppHandle,
    db: Arc<Db>,
    root: String,
    target_album_id: Option<String>,
) -> Result<usize> {
    let root_path = root.clone();
    let album = target_album_id.clone();
    let queued = tokio::task::spawn_blocking(move || -> Result<usize> {
        let mut scanned = 0usize;
        let mut queued = 0usize;
        let mut skipped = 0usize;
        let mut sidecars = 0usize;
        let mut last_emit = std::time::Instant::now();
        let mut last_dir = String::new();

        for entry in WalkDir::new(&root_path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_dir() {
                last_dir = entry.path().display().to_string();
                continue;
            }
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_lowercase())
                .unwrap_or_default();

            // Google Takeout sidecars: never queue these as photos. They're
            // metadata for an adjacent photo and we pair them up below.
            if ext == "json" {
                continue;
            }

            scanned += 1;
            if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                skipped += 1;
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            let size = meta.len() as i64;
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);

            let sidecar_path = sidecar::find_sidecar(path);
            if sidecar_path.is_some() {
                sidecars += 1;
            }
            let sidecar_str = sidecar_path.as_ref().map(|p| p.display().to_string());

            let inserted = db
                .insert_pending(
                    &root_path,
                    &path.display().to_string(),
                    size,
                    mtime_ms,
                    album.as_deref(),
                    sidecar_str.as_deref(),
                )
                .unwrap_or(false);
            if inserted {
                queued += 1;
            }

            if last_emit.elapsed() > std::time::Duration::from_millis(200) {
                let _ = app.emit(
                    "scan-progress",
                    ScanProgress {
                        scanned,
                        queued,
                        skipped,
                        sidecars,
                        current_dir: last_dir.clone(),
                    },
                );
                last_emit = std::time::Instant::now();
            }
        }
        let _ = app.emit(
            "scan-complete",
            ScanProgress {
                scanned,
                queued,
                skipped,
                sidecars,
                current_dir: last_dir,
            },
        );
        Ok(queued)
    })
    .await
    .map_err(|e| AppError::Other(format!("scan join: {}", e)))??;
    Ok(queued)
}

/// Walk the local DB for files missing a sidecar_path and try to find one.
/// Used as a one-shot after upgrading from a pre-sidecar build, so users don't
/// have to re-scan their whole drive to pick up Google Takeout metadata.
pub async fn rescan_sidecars(app: AppHandle, db: Arc<Db>) -> Result<usize> {
    let updated = tokio::task::spawn_blocking(move || -> Result<usize> {
        let rows = db.paths_missing_sidecar()?;
        let total = rows.len();
        let mut found = 0usize;
        let mut last_emit = std::time::Instant::now();

        for (i, (id, path_str)) in rows.into_iter().enumerate() {
            let p = std::path::PathBuf::from(&path_str);
            if let Some(side) = sidecar::find_sidecar(&p) {
                if db.set_sidecar(id, &side.display().to_string()).is_ok() {
                    found += 1;
                }
            }
            if last_emit.elapsed() > std::time::Duration::from_millis(500) {
                let _ = app.emit(
                    "sidecar-rescan-progress",
                    serde_json::json!({"checked": i + 1, "total": total, "found": found}),
                );
                last_emit = std::time::Instant::now();
            }
        }
        let _ = app.emit(
            "sidecar-rescan-complete",
            serde_json::json!({"checked": total, "total": total, "found": found}),
        );
        Ok(found)
    })
    .await
    .map_err(|e| AppError::Other(format!("rescan join: {}", e)))??;
    Ok(updated)
}
