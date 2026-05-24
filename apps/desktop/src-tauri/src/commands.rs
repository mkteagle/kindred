use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::{Db, FileRow, StatusCounts};
use crate::error::{AppError, Result};
use crate::kindred::{Album, KindredClient, ScanTriggerResponse};
use crate::scanner;
use crate::settings::SettingsStore;
use crate::worker::{self, WorkerState};

pub struct AppState {
    pub db: Arc<Db>,
    pub settings: Arc<SettingsStore>,
    pub worker: WorkerState,
}

#[derive(Serialize)]
pub struct SettingsView {
    pub base_url: Option<String>,
    pub concurrency: u32,
    pub api_key_set: bool,
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<SettingsView> {
    let s = state.settings.get();
    let has_key = s.api_key.as_deref().map(|k| !k.is_empty()).unwrap_or(false);
    Ok(SettingsView {
        base_url: s.base_url,
        concurrency: s.concurrency,
        api_key_set: has_key,
    })
}

#[tauri::command]
pub fn set_settings(
    state: State<'_, AppState>,
    base_url: Option<String>,
    concurrency: Option<u32>,
    api_key: Option<String>,
) -> Result<()> {
    tracing::info!(
        "set_settings: base_url={:?} concurrency={:?} api_key={}",
        base_url,
        concurrency,
        if api_key.as_deref().map(|k| !k.is_empty()).unwrap_or(false) { "<set>" } else { "<none>" }
    );
    state.settings.update(|s| {
        if let Some(u) = base_url {
            s.base_url = if u.is_empty() { None } else { Some(u) };
        }
        if let Some(c) = concurrency {
            s.concurrency = c.clamp(1, 10);
        }
        if let Some(k) = api_key {
            s.api_key = if k.is_empty() { None } else { Some(k) };
        }
    })?;
    Ok(())
}

#[tauri::command]
pub async fn test_connection(state: State<'_, AppState>) -> Result<bool> {
    let s = state.settings.get();
    tracing::info!("test_connection: base_url={:?}", s.base_url);
    let client = build_client(&state)?;
    let result = client.health_check().await;
    tracing::info!("test_connection result: {:?}", result);
    result
}

#[tauri::command]
pub async fn trigger_scan(state: State<'_, AppState>) -> Result<ScanTriggerResponse> {
    let client = build_client(&state)?;
    client.trigger_scan().await
}

#[tauri::command]
pub async fn start_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    album_id: Option<String>,
) -> Result<usize> {
    let db = state.db.clone();
    scanner::scan_dir(app, db, path, album_id).await
}

#[tauri::command]
pub async fn rescan_sidecars(app: AppHandle, state: State<'_, AppState>) -> Result<usize> {
    let db = state.db.clone();
    scanner::rescan_sidecars(app, db).await
}

#[tauri::command]
pub async fn fix_existing_metadata(state: State<'_, AppState>) -> Result<FixMetadataResult> {
    let client = Arc::new(build_client(&state)?);
    let db = state.db.clone();
    let rows = db.done_with_sidecar()?;
    let total = rows.len();
    let mut applied = 0usize;
    let mut failed = 0usize;
    for (photo_id, sidecar_path) in rows {
        let meta = crate::sidecar::parse_sidecar(std::path::Path::new(&sidecar_path));
        let Some(meta) = meta else { continue };
        if meta.is_empty() {
            continue;
        }
        match client
            .apply_metadata(&photo_id, meta.taken_at_unix, meta.latitude, meta.longitude)
            .await
        {
            Ok(()) => applied += 1,
            Err(e) => {
                tracing::warn!("apply_metadata failed for {}: {}", photo_id, e);
                failed += 1;
            }
        }
        // gentle pacing to stay well under Flickr's per-key rate limit
        tokio::time::sleep(std::time::Duration::from_millis(75)).await;
    }
    Ok(FixMetadataResult { total, applied, failed })
}

#[derive(serde::Serialize)]
pub struct FixMetadataResult {
    pub total: usize,
    pub applied: usize,
    pub failed: usize,
}

#[tauri::command]
pub async fn list_albums(state: State<'_, AppState>) -> Result<Vec<Album>> {
    let client = build_client(&state)?;
    client.list_albums().await
}

#[tauri::command]
pub fn get_status(state: State<'_, AppState>) -> Result<StatusCounts> {
    state.db.status_counts()
}

#[tauri::command]
pub async fn start_upload(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    if state.worker.is_running() {
        return Ok(());
    }
    let client = Arc::new(build_client(&state)?);
    let db = state.db.clone();
    let worker_state = state.worker.clone();
    let conc = state.settings.get().concurrency;
    db.reset_uploading()?;
    tokio::spawn(async move {
        let _ = worker::run_uploads(app, db, client, worker_state, conc).await;
    });
    Ok(())
}

#[tauri::command]
pub fn stop_upload(state: State<'_, AppState>) -> Result<()> {
    worker::stop(&state.worker);
    Ok(())
}

#[tauri::command]
pub fn list_failed(state: State<'_, AppState>, limit: Option<i64>) -> Result<Vec<FileRow>> {
    state.db.list_failed(limit.unwrap_or(100))
}

#[tauri::command]
pub fn retry_failed(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.db.retry_failed(id)
}

#[tauri::command]
pub fn is_running(state: State<'_, AppState>) -> bool {
    state.worker.is_running()
}

#[tauri::command]
pub fn clear_queue(state: State<'_, AppState>) -> Result<()> {
    state.db.clear_all()
}

fn build_client(state: &State<'_, AppState>) -> Result<KindredClient> {
    let s = state.settings.get();
    let base = s
        .base_url
        .ok_or_else(|| AppError::NotConfigured("base_url not set".into()))?;
    let key = s
        .api_key
        .ok_or_else(|| AppError::NotConfigured("api_key not set".into()))?;
    KindredClient::new(base, key)
}
