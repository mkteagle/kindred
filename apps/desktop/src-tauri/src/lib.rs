mod api;
mod cache;
mod commands;
mod db;
mod error;
mod kindred;
mod media;
mod menu;
mod scanner;
mod settings;
mod sidecar;
mod windows;
mod worker;

use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use cache::MediaCache;
use commands::{AppState, ServerHealth};
use db::Db;
use settings::SettingsStore;
use windows::WindowRegistry;
use worker::WorkerState;

/// Menu ids Rust acts on itself. Everything else is forwarded to whichever
/// window has focus, because only the view layer knows what is selected.
const RUST_HANDLED: &[&str] = &["settings", "open-uploader"];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "kindred_uploader_lib=info,warn".into()),
        )
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Real drag-out to Finder/Explorer. The Rust side of this plugin owns
        // the OS drag session; `prepare_originals` materialises the files it
        // is handed.
        .plugin(tauri_plugin_drag::init())
        .menu(|handle| menu::build(handle))
        .on_menu_event(|app, event| {
            let id: String = event.id().as_ref().to_string();
            if RUST_HANDLED.contains(&id.as_str()) {
                let kind = if id == "settings" { "settings" } else { "uploader" };
                let state = app.state::<AppState>();
                if let Err(e) = windows::open(
                    app,
                    &state.windows,
                    &state.settings,
                    kind,
                    serde_json::Value::Null,
                ) {
                    tracing::warn!("could not open {} window: {}", kind, e);
                }
                return;
            }
            // Broadcast: Tauri has no "deliver to the key window" primitive, so
            // every window hears this and each one ignores it unless
            // `document.hasFocus()`.
            let _ = app.emit("menu-command", id);
        })
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data dir");
            let settings = Arc::new(SettingsStore::new(data_dir.clone()).expect("settings init"));
            let db = Arc::new(Db::open(&data_dir.join("state.db")).expect("db open"));
            let cache = Arc::new(MediaCache::open(&data_dir).expect("media cache init"));
            let registry = Arc::new(WindowRegistry::new());
            app.manage(AppState {
                db,
                settings: settings.clone(),
                worker: WorkerState::new(),
                cache,
                health: Arc::new(Mutex::new(ServerHealth::default())),
                windows: registry.clone(),
            });

            // The library window is built here rather than declared in
            // tauri.conf.json so it goes through the same path as every torn-off
            // window — and so it comes back the size and place it was left.
            windows::open(
                app.handle(),
                &registry,
                &settings,
                "library",
                serde_json::Value::Null,
            )?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Uploader (pre-existing)
            commands::get_settings,
            commands::set_settings,
            commands::test_connection,
            commands::trigger_scan,
            commands::list_albums,
            commands::start_scan,
            commands::rescan_sidecars,
            commands::fix_existing_metadata,
            commands::get_status,
            commands::start_upload,
            commands::stop_upload,
            commands::list_failed,
            commands::retry_failed,
            commands::is_running,
            commands::clear_queue,
            // Library app
            commands::api_get,
            commands::api_send,
            commands::server_status,
            commands::ping_server,
            commands::media_ref,
            commands::cached_media,
            commands::prepare_originals,
            commands::export_originals,
            commands::cache_stats,
            commands::clear_media_cache,
            commands::get_cache_prefs,
            commands::set_cache_prefs,
            commands::video_stream_url,
            commands::open_window,
            commands::window_context,
            commands::app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
