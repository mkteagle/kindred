use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinSet;

use crate::db::Db;
use crate::error::Result;
use crate::kindred::KindredClient;

#[derive(Clone)]
pub struct WorkerState {
    pub running: Arc<AtomicBool>,
    pub bytes_uploaded_session: Arc<AtomicU64>,
    pub session_started: Arc<Mutex<Option<Instant>>>,
}

impl Default for WorkerState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct UploadEvent {
    pub kind: String,
    pub file_id: i64,
    pub path: String,
    pub photo_id: Option<String>,
    pub error: Option<String>,
}

impl WorkerState {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            bytes_uploaded_session: Arc::new(AtomicU64::new(0)),
            session_started: Arc::new(Mutex::new(None)),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

pub async fn run_uploads(
    app: AppHandle,
    db: Arc<Db>,
    client: Arc<KindredClient>,
    state: WorkerState,
    concurrency: u32,
) -> Result<()> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    *state.session_started.lock().await = Some(Instant::now());
    state.bytes_uploaded_session.store(0, Ordering::SeqCst);
    let _ = app.emit("upload-started", ());

    let sem = Arc::new(Semaphore::new(concurrency.max(1) as usize));
    let mut set: JoinSet<()> = JoinSet::new();

    loop {
        if !state.running.load(Ordering::SeqCst) {
            break;
        }
        let next = db.next_pending().ok().flatten();
        match next {
            Some(pending) => {
                let permit = sem.clone().acquire_owned().await.unwrap();
                let app = app.clone();
                let db = db.clone();
                let client = client.clone();
                let state = state.clone();
                set.spawn(async move {
                    let _permit = permit;
                    upload_one(app, db, client, state, pending).await;
                });
            }
            None => {
                if set.is_empty() {
                    break;
                }
                let _ = tokio::time::timeout(Duration::from_millis(200), set.join_next()).await;
            }
        }
    }

    while set.join_next().await.is_some() {}
    state.running.store(false, Ordering::SeqCst);
    let _ = app.emit("upload-stopped", ());
    Ok(())
}

async fn upload_one(
    app: AppHandle,
    db: Arc<Db>,
    client: Arc<KindredClient>,
    state: WorkerState,
    pending: crate::db::PendingFile,
) {
    let _ = app.emit(
        "upload-event",
        UploadEvent {
            kind: "start".into(),
            file_id: pending.id,
            path: pending.path.clone(),
            photo_id: None,
            error: None,
        },
    );

    let path = std::path::PathBuf::from(&pending.path);
    match client.upload_file(&path, pending.target_album_id.as_deref()).await {
        Ok(resp) => {
            let _ = db.mark_done(pending.id, &resp.photo_id);
            state
                .bytes_uploaded_session
                .fetch_add(pending.size_bytes as u64, Ordering::SeqCst);
            let _ = app.emit(
                "upload-event",
                UploadEvent {
                    kind: "ok".into(),
                    file_id: pending.id,
                    path: pending.path,
                    photo_id: Some(resp.photo_id),
                    error: None,
                },
            );
        }
        Err(err) => {
            let msg = err.to_string();
            let retryable = err.is_retryable();
            let _ = db.mark_failed(pending.id, &msg, retryable);
            let _ = app.emit(
                "upload-event",
                UploadEvent {
                    kind: "fail".into(),
                    file_id: pending.id,
                    path: pending.path,
                    photo_id: None,
                    error: Some(msg),
                },
            );
            if retryable {
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

pub fn stop(state: &WorkerState) {
    state.running.store(false, Ordering::SeqCst);
}
