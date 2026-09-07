use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::api::ApiClient;
use crate::cache::{CacheStats, MediaCache};
use crate::db::{Db, FileRow, StatusCounts};
use crate::error::{AppError, Result};
use crate::kindred::{Album, KindredClient, ScanTriggerResponse};
use crate::media::{self, MediaRef};
use crate::scanner;
use crate::settings::{CachePrefs, SettingsStore};
use crate::windows::{self, WindowContext, WindowRegistry};
use crate::worker::{self, WorkerState};

pub struct AppState {
    pub db: Arc<Db>,
    pub settings: Arc<SettingsStore>,
    pub worker: WorkerState,
    pub cache: Arc<MediaCache>,
    pub health: Arc<Mutex<ServerHealth>>,
    pub windows: Arc<WindowRegistry>,
}

/// Whether the household server is answering, and when it last did.
///
/// The Settings pane's "Server unreachable · showing the local cache · last
/// sync 3 hours ago" banner is driven entirely from this, so it has to be
/// recorded on ordinary traffic rather than by a separate heartbeat — the
/// interesting failure is the one that happens mid-scroll.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ServerHealth {
    pub reachable: bool,
    pub checked_at: Option<i64>,
    pub last_ok: Option<i64>,
    pub last_error: Option<String>,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn record_health<T>(health: &Mutex<ServerHealth>, outcome: &Result<T>) {
    let mut state = health.lock().unwrap();
    state.checked_at = Some(now());
    match outcome {
        Ok(_) => {
            state.reachable = true;
            state.last_ok = Some(now());
            state.last_error = None;
        }
        Err(e) => {
            state.reachable = false;
            state.last_error = Some(e.to_string());
        }
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// The library app: server proxy, offline cache, windows.
// ─────────────────────────────────────────────────────────────────────────────

fn build_api(state: &State<'_, AppState>) -> Result<ApiClient> {
    let s = state.settings.get();
    let base = s
        .base_url
        .ok_or_else(|| AppError::NotConfigured("This Mac is not paired with a server yet".into()))?;
    let key = s
        .api_key
        .ok_or_else(|| AppError::NotConfigured("No API key is stored for this server".into()))?;
    ApiClient::new(base, key)
}

fn query_pairs(query: Option<HashMap<String, String>>) -> Vec<(String, String)> {
    query.map(|q| q.into_iter().collect()).unwrap_or_default()
}

/// Read anything on the allowlist. The view layer's only route to the server.
#[tauri::command]
pub async fn api_get(
    state: State<'_, AppState>,
    path: String,
    query: Option<HashMap<String, String>>,
) -> Result<Value> {
    let client = build_api(&state)?;
    let outcome = client.get_json(&path, &query_pairs(query)).await;
    record_health(&state.health, &outcome);
    outcome
}

/// Write anything on the allowlist: favouriting, naming a face, merging
/// clusters, creating a share. Destructive actions go through here and the UI
/// commits only on the response, never optimistically.
#[tauri::command]
pub async fn api_send(
    state: State<'_, AppState>,
    method: String,
    path: String,
    query: Option<HashMap<String, String>>,
    body: Option<Value>,
) -> Result<Value> {
    let client = build_api(&state)?;
    let outcome = client
        .send_json(&method, &path, &query_pairs(query), body)
        .await;
    record_health(&state.health, &outcome);
    outcome
}

#[derive(Serialize)]
pub struct ServerStatus {
    pub configured: bool,
    pub base_url: Option<String>,
    #[serde(flatten)]
    pub health: ServerHealth,
}

#[tauri::command]
pub fn server_status(state: State<'_, AppState>) -> ServerStatus {
    let s = state.settings.get();
    ServerStatus {
        configured: s.base_url.is_some()
            && s.api_key.as_deref().map(|k| !k.is_empty()).unwrap_or(false),
        base_url: s.base_url,
        health: state.health.lock().unwrap().clone(),
    }
}

/// "Retry now" on the unreachable banner, and ⌘R.
#[tauri::command]
pub async fn ping_server(state: State<'_, AppState>) -> Result<ServerStatus> {
    let client = build_api(&state)?;
    let outcome = client.health_check().await.and_then(|ok| {
        if ok {
            Ok(())
        } else {
            Err(AppError::Other("the server answered but not with health".into()))
        }
    });
    record_health(&state.health, &outcome);
    Ok(server_status(state))
}

/// One variant of one photo, fetched into the cache if it is not there yet.
#[tauri::command]
pub async fn media_ref(
    state: State<'_, AppState>,
    photo_id: String,
    variant: String,
    pin: Option<String>,
) -> Result<MediaRef> {
    let prefs = state.settings.get().cache;
    // A cache hit must not need a configured server: that is the whole point
    // of the offline cache, and the failure mode it exists for.
    if let Some(found) = state.cache.lookup(&photo_id, &variant)? {
        return Ok(MediaRef {
            photo_id,
            variant,
            path: Some(found.path),
            bytes: found.bytes,
            cached: true,
            from_cache: true,
            error: None,
        });
    }
    let client = match build_api(&state) {
        Ok(client) => client,
        Err(e) => {
            return Ok(MediaRef {
                photo_id,
                variant,
                path: None,
                bytes: 0,
                cached: false,
                from_cache: false,
                error: Some(e.to_string()),
            })
        }
    };
    let result = media::ensure(
        &state.cache,
        &client,
        &photo_id,
        &variant,
        pin.as_deref(),
        prefs.limit_bytes,
    )
    .await;
    if result.error.is_some() {
        let mut health = state.health.lock().unwrap();
        health.reachable = false;
        health.checked_at = Some(now());
        health.last_error = result.error.clone();
    }
    Ok(result)
}

/// Which of these photos already have a cached thumbnail. The grid asks once
/// per screenful instead of once per tile, so a cold scroll does not fire a
/// thousand round trips into Rust to learn the answer is "none".
#[tauri::command]
pub fn cached_media(
    state: State<'_, AppState>,
    photo_ids: Vec<String>,
    variant: String,
) -> Result<Vec<String>> {
    state.cache.cached_ids(&photo_ids, &variant)
}

/// Ensure originals are on disk and hand back their paths. This is the half of
/// drag-out that has to be real: by the time the OS drag begins, the files must
/// already exist. The gesture itself is `tauri-plugin-drag`, invoked from the
/// view layer with exactly these paths.
#[tauri::command]
pub async fn prepare_originals(
    state: State<'_, AppState>,
    photo_ids: Vec<String>,
) -> Result<Vec<String>> {
    let client = build_api(&state)?;
    let prefs = state.settings.get().cache;
    let mut paths = Vec::with_capacity(photo_ids.len());
    for photo_id in photo_ids {
        let media = media::ensure_original_file(
            &state.cache,
            &client,
            &photo_id,
            // Deliberate: something the member dragged out is worth keeping.
            Some("manual"),
            prefs.limit_bytes,
        )
        .await?;
        paths.push(media.path);
    }
    Ok(paths)
}

#[derive(Serialize)]
pub struct ExportResult {
    pub written: Vec<String>,
    pub failed: Vec<String>,
}

/// Write originals into a folder the member chose. `titles` is parallel to
/// `photo_ids` so the files land with names they recognise.
#[tauri::command]
pub async fn export_originals(
    state: State<'_, AppState>,
    photo_ids: Vec<String>,
    titles: Option<Vec<String>>,
    destination: String,
) -> Result<ExportResult> {
    let client = build_api(&state)?;
    let prefs = state.settings.get().cache;
    let destination = std::path::PathBuf::from(destination);
    std::fs::create_dir_all(&destination)?;
    let mut written = Vec::new();
    let mut failed = Vec::new();
    for (index, photo_id) in photo_ids.iter().enumerate() {
        let title = titles.as_ref().and_then(|t| t.get(index)).map(String::as_str);
        let source = media::ensure_original_file(
            &state.cache,
            &client,
            photo_id,
            Some("manual"),
            prefs.limit_bytes,
        )
        .await;
        match source {
            Ok(media) => {
                let source_path = std::path::PathBuf::from(&media.path);
                let name = media::export_filename(title, photo_id, &source_path);
                let target = unique_path(&destination, &name);
                match std::fs::copy(&source_path, &target) {
                    Ok(_) => written.push(target.to_string_lossy().to_string()),
                    Err(e) => failed.push(format!("{}: {}", photo_id, e)),
                }
            }
            Err(e) => failed.push(format!("{}: {}", photo_id, e)),
        }
    }
    Ok(ExportResult { written, failed })
}

/// Never overwrite what is already in the destination folder.
fn unique_path(directory: &std::path::Path, name: &str) -> std::path::PathBuf {
    let candidate = directory.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = std::path::Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    for n in 2..1000 {
        let next = if extension.is_empty() {
            directory.join(format!("{} {}", stem, n))
        } else {
            directory.join(format!("{} {}.{}", stem, n, extension))
        };
        if !next.exists() {
            return next;
        }
    }
    candidate
}

#[tauri::command]
pub fn cache_stats(state: State<'_, AppState>) -> Result<CacheStats> {
    state.cache.stats(state.settings.get().cache.limit_bytes)
}

#[tauri::command]
pub fn clear_media_cache(state: State<'_, AppState>) -> Result<i64> {
    state.cache.clear()
}

#[tauri::command]
pub fn get_cache_prefs(state: State<'_, AppState>) -> CachePrefs {
    state.settings.get().cache
}

#[tauri::command]
pub fn set_cache_prefs(state: State<'_, AppState>, prefs: CachePrefs) -> Result<CacheStats> {
    let limit = prefs.limit_bytes.max(0);
    state.settings.update(|s| {
        s.cache = CachePrefs {
            limit_bytes: limit,
            ..prefs
        };
    })?;
    // A lowered allowance should take effect now, not at the next download.
    state.cache.evict_to_fit(limit)?;
    state.cache.stats(limit)
}

/// The one URL that carries the credential.
///
/// A `<video>` element cannot set request headers, so streaming a video
/// original that is not yet cached has to authenticate in the query string —
/// which the backend supports (`api_key`). It stays on the household LAN and
/// never leaves this machine's webview, but it is still the weakest link here.
///
/// TODO: replace with a short-lived, single-photo media token once the backend
/// grows one — an endpoint like `POST /media-tokens {photo_id}` returning a
/// token valid for a minute would let this URL carry no long-lived secret.
#[tauri::command]
pub fn video_stream_url(state: State<'_, AppState>, photo_id: String) -> Result<String> {
    let client = build_api(&state)?;
    let (key_name, key_value) = client.query_credential();
    Ok(format!(
        "{}/photos/{}/local?variant=original&{}={}",
        client.base_url(),
        photo_id,
        key_name,
        urlencoding(key_value)
    ))
}

fn urlencoding(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}

#[tauri::command]
pub fn open_window(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: String,
    params: Option<Value>,
) -> Result<String> {
    windows::open(
        &app,
        &state.windows,
        &state.settings,
        &kind,
        params.unwrap_or(Value::Null),
    )
}

/// What this window was opened with. Each window asks for its own; there is no
/// way to read another's.
#[tauri::command]
pub fn window_context(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
) -> Option<WindowContext> {
    state.windows.context(window.label())
}

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
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
