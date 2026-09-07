use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;

use crate::error::Result;

const CONFIG_FILENAME: &str = "config.json";

/// Settings → Local cache. Defaults match the pane in the design: favourites
/// and the last 90 days kept, downloads on Wi-Fi only, syncing continues on
/// battery.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachePrefs {
    pub limit_bytes: i64,
    pub keep_favorites: bool,
    pub keep_recent: bool,
    pub keep_recent_days: u32,
    pub wifi_only: bool,
    pub pause_on_battery: bool,
}

impl Default for CachePrefs {
    fn default() -> Self {
        Self {
            // 200 GB, the allowance the Settings pane shows.
            limit_bytes: 200 * 1024 * 1024 * 1024,
            keep_favorites: true,
            keep_recent: true,
            keep_recent_days: 90,
            wifi_only: true,
            pause_on_battery: false,
        }
    }
}

/// Remembered window geometry, keyed by window kind rather than label, so the
/// second viewer you open lands where the last one was.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

// The API key is stored in the same config file as everything else. This is a
// personal-use desktop tool talking to the user's own backend; the file lives
// in the OS app-data dir alongside the SQLite state. macOS Keychain access
// fails on unsigned dev binaries, so a plain config file is the pragmatic
// choice until we sign releases.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub base_url: Option<String>,
    pub concurrency: u32,
    #[serde(default)]
    pub api_key: Option<String>,
    // Added after the redesign. `default` on each keeps an existing config.json
    // from an older build loading cleanly.
    #[serde(default)]
    pub cache: CachePrefs,
    #[serde(default)]
    pub windows: HashMap<String, WindowGeometry>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            base_url: None,
            concurrency: 3,
            api_key: None,
            cache: CachePrefs::default(),
            windows: HashMap::new(),
        }
    }
}

pub struct SettingsStore {
    config_path: PathBuf,
    settings: RwLock<Settings>,
}

impl SettingsStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&app_data_dir)?;
        let config_path = app_data_dir.join(CONFIG_FILENAME);
        let settings = if config_path.exists() {
            let raw = std::fs::read_to_string(&config_path)?;
            serde_json::from_str(&raw).unwrap_or_default()
        } else {
            Settings::default()
        };
        Ok(Self {
            config_path,
            settings: RwLock::new(settings),
        })
    }

    pub fn get(&self) -> Settings {
        self.settings.read().unwrap().clone()
    }

    fn persist(&self, new: Settings) -> Result<()> {
        let raw = serde_json::to_string_pretty(&new)?;
        std::fs::write(&self.config_path, raw)?;
        *self.settings.write().unwrap() = new;
        Ok(())
    }

    pub fn update<F: FnOnce(&mut Settings)>(&self, f: F) -> Result<()> {
        let mut s = self.get();
        f(&mut s);
        self.persist(s)
    }
}
