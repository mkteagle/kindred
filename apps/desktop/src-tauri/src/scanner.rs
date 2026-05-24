use std::sync::Arc;
use std::time::SystemTime;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::db::Db;
use crate::error::{AppError, Result};

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "heic", "heif", "png",
    // Phase 2 (needs backend streaming + larger max size):
    // "dng", "cr2", "cr3", "nef", "arw", "raf", "orf", "rw2", "tif", "tiff",
    // "mp4", "mov",
];

#[derive(Serialize, Clone, Debug)]
pub struct ScanProgress {
    pub scanned: usize,
    pub queued: usize,
    pub skipped: usize,
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
            scanned += 1;
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_lowercase())
                .unwrap_or_default();
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
            let inserted = db
                .insert_pending(
                    &root_path,
                    &path.display().to_string(),
                    size,
                    mtime_ms,
                    album.as_deref(),
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
                current_dir: last_dir,
            },
        );
        Ok(queued)
    })
    .await
    .map_err(|e| AppError::Other(format!("scan join: {}", e)))??;
    Ok(queued)
}
