use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;

use crate::error::Result;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_root TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    size_bytes INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    sha256 TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    flickr_photo_id TEXT,
    target_album_id TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
CREATE INDEX IF NOT EXISTS idx_files_source_root ON files(source_root);
"#;

// Migrations for older DBs that pre-date a column. Each statement runs once;
// errors (column already exists) are swallowed because rusqlite returns
// SQLITE_ERROR for duplicate columns and there is no IF NOT EXISTS for ADD COLUMN.
const MIGRATIONS: &[&str] = &[
    "ALTER TABLE files ADD COLUMN target_album_id TEXT",
];

pub struct Db {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingFile {
    pub id: i64,
    pub path: String,
    pub size_bytes: i64,
    pub target_album_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileRow {
    pub id: i64,
    pub path: String,
    pub size_bytes: i64,
    pub status: String,
    pub flickr_photo_id: Option<String>,
    pub error: Option<String>,
    pub attempts: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct StatusCounts {
    pub pending: i64,
    pub uploading: i64,
    pub done: i64,
    pub failed: i64,
    pub skipped: i64,
    pub total_bytes_done: i64,
    pub total_bytes_all: i64,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        for stmt in MIGRATIONS {
            let _ = conn.execute(stmt, []);
        }
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn insert_pending(
        &self,
        source_root: &str,
        path: &str,
        size: i64,
        mtime_ms: i64,
        target_album_id: Option<&str>,
    ) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "INSERT OR IGNORE INTO files (source_root, path, size_bytes, mtime_ms, target_album_id)
             VALUES (?, ?, ?, ?, ?)",
            params![source_root, path, size, mtime_ms, target_album_id],
        )?;
        Ok(changed > 0)
    }

    pub fn next_pending(&self) -> Result<Option<PendingFile>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "UPDATE files
             SET status='uploading',
                 attempts=attempts+1,
                 last_attempt_at=unixepoch()
             WHERE id = (SELECT id FROM files WHERE status='pending' ORDER BY id LIMIT 1)
             RETURNING id, path, size_bytes, target_album_id",
        )?;
        let res = stmt.query_row([], |row| {
            Ok(PendingFile {
                id: row.get(0)?,
                path: row.get(1)?,
                size_bytes: row.get(2)?,
                target_album_id: row.get(3)?,
            })
        });
        match res {
            Ok(f) => Ok(Some(f)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn mark_done(&self, id: i64, flickr_photo_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE files
             SET status='done', flickr_photo_id=?, completed_at=unixepoch(), error=NULL
             WHERE id=?",
            params![flickr_photo_id, id],
        )?;
        Ok(())
    }

    pub fn mark_failed(&self, id: i64, error: &str, retryable: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let status = if retryable { "pending" } else { "failed" };
        conn.execute(
            "UPDATE files SET status=?, error=? WHERE id=?",
            params![status, error, id],
        )?;
        Ok(())
    }

    pub fn status_counts(&self) -> Result<StatusCounts> {
        let conn = self.conn.lock().unwrap();
        let mut counts = StatusCounts::default();
        {
            let mut stmt = conn.prepare(
                "SELECT status, COUNT(*), COALESCE(SUM(size_bytes), 0) FROM files GROUP BY status",
            )?;
            let rows = stmt.query_map([], |row| {
                let s: String = row.get(0)?;
                let c: i64 = row.get(1)?;
                let b: i64 = row.get(2)?;
                Ok((s, c, b))
            })?;
            for r in rows {
                let (s, c, b) = r?;
                match s.as_str() {
                    "pending" => counts.pending = c,
                    "uploading" => counts.uploading = c,
                    "done" => {
                        counts.done = c;
                        counts.total_bytes_done = b;
                    }
                    "failed" => counts.failed = c,
                    "skipped" => counts.skipped = c,
                    _ => {}
                }
            }
        }
        counts.total_bytes_all = conn.query_row(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM files",
            [],
            |row| row.get(0),
        )?;
        Ok(counts)
    }

    pub fn list_failed(&self, limit: i64) -> Result<Vec<FileRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, path, size_bytes, status, flickr_photo_id, error, attempts
             FROM files WHERE status='failed' ORDER BY id DESC LIMIT ?",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(FileRow {
                id: row.get(0)?,
                path: row.get(1)?,
                size_bytes: row.get(2)?,
                status: row.get(3)?,
                flickr_photo_id: row.get(4)?,
                error: row.get(5)?,
                attempts: row.get(6)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn retry_failed(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE files SET status='pending', error=NULL, attempts=0
             WHERE id=? AND status='failed'",
            params![id],
        )?;
        Ok(())
    }

    pub fn reset_uploading(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE files SET status='pending' WHERE status='uploading'",
            [],
        )?;
        Ok(())
    }

    pub fn clear_all(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM files", [])?;
        Ok(())
    }
}
