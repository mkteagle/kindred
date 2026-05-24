mod commands;
mod db;
mod error;
mod kindred;
mod scanner;
mod settings;
mod worker;

use std::sync::Arc;
use tauri::Manager;

use commands::AppState;
use db::Db;
use settings::SettingsStore;
use worker::WorkerState;

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
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data dir");
            let settings = Arc::new(SettingsStore::new(data_dir.clone()).expect("settings init"));
            let db = Arc::new(Db::open(&data_dir.join("state.db")).expect("db open"));
            app.manage(AppState {
                db,
                settings,
                worker: WorkerState::new(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_settings,
            commands::test_connection,
            commands::trigger_scan,
            commands::list_albums,
            commands::start_scan,
            commands::get_status,
            commands::start_upload,
            commands::stop_upload,
            commands::list_failed,
            commands::retry_failed,
            commands::is_running,
            commands::clear_queue,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
