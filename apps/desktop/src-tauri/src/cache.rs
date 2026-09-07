//! The offline cache — the thing the web app cannot have.
//!
//! ## Where it lives
//! `<app data dir>/media-cache/<variant>/<first two chars of id>/<id>.<ext>`,
//! with `<app data dir>` resolved by Tauri (`~/Library/Application Support/
//! app.kindredphotos.desktop` on macOS, `%APPDATA%` on Windows,
//! `~/.local/share` on Linux). The two-character fan-out keeps any one
//! directory from holding a million entries. An index of what is in there
//! lives beside it in `media-cache.db` (SQLite), separate from the uploader's
//! `state.db` so neither feature's schema can break the other.
//!
//! ## What it holds
//! Every variant the UI asks for: `thumb` (512px), `preview` (2048px), `clip`
//! (the silent hover loop for videos) and `original`. Thumbnails arrive as a
//! side effect of browsing, so the grid is instant on a second visit and
//! readable with the server switched off. Originals only arrive deliberately —
//! opening a photo full size, dragging it out to Finder, or a pin.
//!
//! ## What gets kept
//! Entries carry a `pin`. Pinned entries are never evicted:
//! - `favorite` — the member's favourites, from the "Keep favorites offline"
//!   toggle.
//! - `recent` — everything inside the "Keep last 90 days" window.
//! - `shared` — anything in a live share.
//! - `manual` — pulled deliberately by the member.
//! Unpinned entries (ordinary browsing) are evictable, least-recently-used
//! first, whenever the total passes the allowance from Settings → Local cache.
//! Eviction runs after each write, so the cache trims itself rather than
//! needing a sweep.
//!
//! ## What the UI shows on a miss
//! `lookup` never fetches. The grid renders the tile placeholder and the
//! inspector says "Not kept offline" until `media.rs` has actually pulled the
//! bytes, so a photo that is only on the server is visibly distinct from one
//! that is on this machine — which is the whole point when the server is
//! unreachable.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::Result;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS media (
    key TEXT PRIMARY KEY,
    photo_id TEXT NOT NULL,
    variant TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    content_type TEXT,
    pin TEXT,
    complete INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    used_at INTEGER NOT NULL
);
-- Eviction reads unpinned rows oldest-used first; this is that query's index.
CREATE INDEX IF NOT EXISTS idx_media_evict ON media(pin, used_at);
CREATE INDEX IF NOT EXISTS idx_media_photo ON media(photo_id);
"#;

/// Variants the cache will store. Anything else is refused so a bad string
/// from the view layer cannot create stray directories.
pub const VARIANTS: &[&str] = &["thumb", "preview", "clip", "original"];

/// Distinguishes concurrent writes to the same cache entry. See `store`.
static TEMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
pub struct CachedMedia {
    pub photo_id: String,
    pub variant: String,
    /// Absolute path. The view layer turns this into an asset URL with
    /// `convertFileSrc`; it never reads the file itself.
    pub path: String,
    pub bytes: i64,
    pub content_type: Option<String>,
    pub pin: Option<String>,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CacheStats {
    pub used_bytes: i64,
    pub limit_bytes: i64,
    pub entries: i64,
    pub favorites_bytes: i64,
    pub recent_bytes: i64,
    pub shared_bytes: i64,
    pub evictable_bytes: i64,
    pub root: String,
}

pub struct MediaCache {
    root: PathBuf,
    conn: Mutex<Connection>,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// File extension for a served content type. Unknown types keep `.bin`; the
/// extension only matters because the webview's asset protocol infers a MIME
/// type from it.
pub fn extension_for(content_type: &str) -> &'static str {
    match content_type {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/heic" | "image/heif" => "heic",
        "image/tiff" => "tiff",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/webm" => "webm",
        _ => "bin",
    }
}

/// Photo ids are UUIDs from the server. Reject anything that could escape the
/// cache root before it becomes a path component.
fn safe_id(photo_id: &str) -> bool {
    !photo_id.is_empty()
        && photo_id.len() <= 64
        && photo_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

impl MediaCache {
    pub fn open(app_data_dir: &Path) -> Result<Self> {
        let root = app_data_dir.join("media-cache");
        std::fs::create_dir_all(&root)?;
        let conn = Connection::open(app_data_dir.join("media-cache.db"))?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self {
            root,
            conn: Mutex::new(conn),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn key(photo_id: &str, variant: &str) -> String {
        format!("{}:{}", photo_id, variant)
    }

    fn relative_path(photo_id: &str, variant: &str, extension: &str) -> String {
        let shard = &photo_id[..photo_id.len().min(2)];
        format!("{}/{}/{}.{}", variant, shard, photo_id, extension)
    }

    fn row_to_media(&self, row: &rusqlite::Row<'_>) -> rusqlite::Result<CachedMedia> {
        let rel_path: String = row.get("rel_path")?;
        Ok(CachedMedia {
            photo_id: row.get("photo_id")?,
            variant: row.get("variant")?,
            path: self.root.join(&rel_path).to_string_lossy().to_string(),
            bytes: row.get("bytes")?,
            content_type: row.get("content_type")?,
            pin: row.get("pin")?,
            complete: row.get::<_, i64>("complete")? != 0,
        })
    }

    /// What is already on this machine. Never touches the network, and never
    /// reports an entry whose file has gone missing underneath us — a cleared
    /// Application Support folder should read as a cold cache, not as broken
    /// images.
    pub fn lookup(&self, photo_id: &str, variant: &str) -> Result<Option<CachedMedia>> {
        if !safe_id(photo_id) || !VARIANTS.contains(&variant) {
            return Ok(None);
        }
        let conn = self.conn.lock().unwrap();
        let key = Self::key(photo_id, variant);
        let found = conn
            .query_row(
                "SELECT photo_id, variant, rel_path, bytes, content_type, pin, complete
                 FROM media WHERE key = ?1",
                params![key],
                |row| self.row_to_media(row),
            )
            .optional()?;
        let Some(media) = found else {
            return Ok(None);
        };
        if !Path::new(&media.path).exists() {
            conn.execute("DELETE FROM media WHERE key = ?1", params![key])?;
            return Ok(None);
        }
        conn.execute(
            "UPDATE media SET used_at = ?2 WHERE key = ?1",
            params![key, now()],
        )?;
        Ok(Some(media))
    }

    /// Write bytes into the cache and index them. Replaces any earlier copy of
    /// the same photo and variant, and keeps an existing pin unless a stronger
    /// one is supplied.
    pub fn store(
        &self,
        photo_id: &str,
        variant: &str,
        bytes: &[u8],
        content_type: &str,
        pin: Option<&str>,
    ) -> Result<CachedMedia> {
        if !safe_id(photo_id) {
            return Err(crate::error::AppError::Other(format!(
                "unsafe photo id: {}",
                photo_id
            )));
        }
        if !VARIANTS.contains(&variant) {
            return Err(crate::error::AppError::Other(format!(
                "unknown variant: {}",
                variant
            )));
        }
        let rel_path = Self::relative_path(photo_id, variant, extension_for(content_type));
        let absolute = self.root.join(&rel_path);
        if let Some(parent) = absolute.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Write to a sibling and rename, so a half-written file is never
        // visible to the asset protocol. The counter matters because two
        // windows can ask for the same thumbnail at the same moment, and a
        // shared temp name would interleave two writes into one file.
        let temporary = absolute.with_extension(format!(
            "{}.{}.tmp",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::write(&temporary, bytes)?;
        std::fs::rename(&temporary, &absolute)?;

        let key = Self::key(photo_id, variant);
        let stamp = now();
        {
            let conn = self.conn.lock().unwrap();
            // COALESCE keeps a pin that is already there when this write does
            // not carry one: browsing past a favourite must not un-pin it.
            conn.execute(
                "INSERT INTO media (key, photo_id, variant, rel_path, bytes, content_type,
                                    pin, complete, created_at, used_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)
                 ON CONFLICT(key) DO UPDATE SET
                    rel_path = excluded.rel_path,
                    bytes = excluded.bytes,
                    content_type = excluded.content_type,
                    pin = COALESCE(excluded.pin, media.pin),
                    complete = 1,
                    used_at = excluded.used_at",
                params![
                    key,
                    photo_id,
                    variant,
                    rel_path,
                    bytes.len() as i64,
                    content_type,
                    pin,
                    stamp
                ],
            )?;
        }
        Ok(CachedMedia {
            photo_id: photo_id.to_string(),
            variant: variant.to_string(),
            path: absolute.to_string_lossy().to_string(),
            bytes: bytes.len() as i64,
            content_type: Some(content_type.to_string()),
            pin: pin.map(|p| p.to_string()),
            complete: true,
        })
    }

    /// Adopt a file that was assembled elsewhere, by moving it in. Videos come
    /// down in ranged chunks straight to disk, so their originals must never be
    /// held in memory the way `store` holds a thumbnail.
    pub fn store_file(
        &self,
        photo_id: &str,
        variant: &str,
        source: &Path,
        content_type: &str,
        pin: Option<&str>,
    ) -> Result<CachedMedia> {
        if !safe_id(photo_id) {
            return Err(crate::error::AppError::Other(format!(
                "unsafe photo id: {}",
                photo_id
            )));
        }
        if !VARIANTS.contains(&variant) {
            return Err(crate::error::AppError::Other(format!(
                "unknown variant: {}",
                variant
            )));
        }
        let bytes = std::fs::metadata(source)?.len() as i64;
        let rel_path = Self::relative_path(photo_id, variant, extension_for(content_type));
        let absolute = self.root.join(&rel_path);
        if let Some(parent) = absolute.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // A rename across filesystems fails; the staging area lives under the
        // cache root precisely so it does not, but copy-then-delete is the
        // honest fallback.
        if std::fs::rename(source, &absolute).is_err() {
            std::fs::copy(source, &absolute)?;
            let _ = std::fs::remove_file(source);
        }
        let stamp = now();
        let key = Self::key(photo_id, variant);
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO media (key, photo_id, variant, rel_path, bytes, content_type,
                                    pin, complete, created_at, used_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)
                 ON CONFLICT(key) DO UPDATE SET
                    rel_path = excluded.rel_path,
                    bytes = excluded.bytes,
                    content_type = excluded.content_type,
                    pin = COALESCE(excluded.pin, media.pin),
                    complete = 1,
                    used_at = excluded.used_at",
                params![key, photo_id, variant, rel_path, bytes, content_type, pin, stamp],
            )?;
        }
        Ok(CachedMedia {
            photo_id: photo_id.to_string(),
            variant: variant.to_string(),
            path: absolute.to_string_lossy().to_string(),
            bytes,
            content_type: Some(content_type.to_string()),
            pin: pin.map(|p| p.to_string()),
            complete: true,
        })
    }

    /// Scratch space for partial downloads, kept inside the cache root so the
    /// move into place is a rename rather than a copy.
    pub fn staging_path(&self, photo_id: &str) -> Result<PathBuf> {
        if !safe_id(photo_id) {
            return Err(crate::error::AppError::Other(format!(
                "unsafe photo id: {}",
                photo_id
            )));
        }
        let staging = self.root.join(".staging");
        std::fs::create_dir_all(&staging)?;
        Ok(staging.join(format!("{}.part", photo_id)))
    }

    pub fn set_pin(&self, photo_id: &str, variant: &str, pin: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE media SET pin = ?2 WHERE key = ?1",
            params![Self::key(photo_id, variant), pin],
        )?;
        Ok(())
    }

    pub fn stats(&self, limit_bytes: i64) -> Result<CacheStats> {
        let conn = self.conn.lock().unwrap();
        let (used, entries): (i64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(bytes), 0), COUNT(*) FROM media",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let sum_for = |pin: Option<&str>| -> rusqlite::Result<i64> {
            match pin {
                Some(pin) => conn.query_row(
                    "SELECT COALESCE(SUM(bytes), 0) FROM media WHERE pin = ?1",
                    params![pin],
                    |row| row.get(0),
                ),
                None => conn.query_row(
                    "SELECT COALESCE(SUM(bytes), 0) FROM media WHERE pin IS NULL",
                    [],
                    |row| row.get(0),
                ),
            }
        };
        Ok(CacheStats {
            used_bytes: used,
            limit_bytes,
            entries,
            favorites_bytes: sum_for(Some("favorite"))?,
            recent_bytes: sum_for(Some("recent"))?,
            shared_bytes: sum_for(Some("shared"))?,
            evictable_bytes: sum_for(None)?,
            root: self.root.to_string_lossy().to_string(),
        })
    }

    /// Trim unpinned entries, least recently used first, until the total fits
    /// the allowance. Returns how many bytes went. Pinned entries are left
    /// alone even when that means staying over the line — the member asked for
    /// those explicitly, and silently dropping a favourite would be worse than
    /// being 2 GB over.
    pub fn evict_to_fit(&self, limit_bytes: i64) -> Result<i64> {
        if limit_bytes <= 0 {
            return Ok(0);
        }
        let mut freed = 0i64;
        loop {
            let victim = {
                let conn = self.conn.lock().unwrap();
                let used: i64 = conn.query_row(
                    "SELECT COALESCE(SUM(bytes), 0) FROM media",
                    [],
                    |row| row.get(0),
                )?;
                if used <= limit_bytes {
                    break;
                }
                conn.query_row(
                    "SELECT key, rel_path, bytes FROM media
                     WHERE pin IS NULL ORDER BY used_at ASC LIMIT 1",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )
                .optional()?
            };
            let Some((key, rel_path, bytes)) = victim else {
                // Nothing left that may be evicted.
                break;
            };
            let _ = std::fs::remove_file(self.root.join(&rel_path));
            let conn = self.conn.lock().unwrap();
            conn.execute("DELETE FROM media WHERE key = ?1", params![key])?;
            freed += bytes;
        }
        Ok(freed)
    }

    /// Drop everything. The originals are on the server; this is always safe.
    pub fn clear(&self) -> Result<i64> {
        let freed = {
            let conn = self.conn.lock().unwrap();
            let used: i64 =
                conn.query_row("SELECT COALESCE(SUM(bytes), 0) FROM media", [], |row| {
                    row.get(0)
                })?;
            conn.execute("DELETE FROM media", [])?;
            used
        };
        if self.root.exists() {
            std::fs::remove_dir_all(&self.root)?;
        }
        std::fs::create_dir_all(&self.root)?;
        Ok(freed)
    }

    /// Which of these photos have a cached copy of this variant. One query
    /// rather than one per tile — the grid asks about a whole screen at once.
    pub fn cached_ids(&self, photo_ids: &[String], variant: &str) -> Result<Vec<String>> {
        if photo_ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock().unwrap();
        let placeholders = std::iter::repeat("?")
            .take(photo_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT photo_id FROM media WHERE variant = ? AND photo_id IN ({})",
            placeholders
        );
        let mut statement = conn.prepare(&sql)?;
        let mut binds: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(photo_ids.len() + 1);
        binds.push(&variant);
        for id in photo_ids {
            binds.push(id);
        }
        let rows = statement.query_map(binds.as_slice(), |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A directory of this test's own.
    ///
    /// Keyed on more than the process id: cargo runs tests as threads inside
    /// one process, so a pid-only name is shared, and one test's cleanup pulls
    /// the SQLite file out from under another mid-write — which reads back as
    /// "attempt to write a readonly database".
    fn temp_cache() -> (MediaCache, PathBuf) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static COUNTER: AtomicUsize = AtomicUsize::new(0);

        let dir = std::env::temp_dir().join(format!(
            "kindred-cache-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        (MediaCache::open(&dir).unwrap(), dir)
    }

    #[test]
    fn stores_and_looks_up() {
        let (cache, dir) = temp_cache();
        let stored = cache
            .store("abc123", "thumb", b"hello", "image/jpeg", None)
            .unwrap();
        assert!(stored.path.ends_with("thumb/ab/abc123.jpg"));
        let found = cache.lookup("abc123", "thumb").unwrap().unwrap();
        assert_eq!(found.bytes, 5);
        assert!(cache.lookup("abc123", "original").unwrap().is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn eviction_spares_pinned_entries() {
        let (cache, dir) = temp_cache();
        cache
            .store("aaa", "thumb", &[0u8; 400], "image/jpeg", Some("favorite"))
            .unwrap();
        cache
            .store("bbb", "thumb", &[0u8; 400], "image/jpeg", None)
            .unwrap();
        cache.evict_to_fit(500).unwrap();
        assert!(cache.lookup("aaa", "thumb").unwrap().is_some());
        assert!(cache.lookup("bbb", "thumb").unwrap().is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unsafe_ids_are_refused() {
        let (cache, dir) = temp_cache();
        assert!(cache
            .store("../../etc/passwd", "thumb", b"x", "image/jpeg", None)
            .is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
