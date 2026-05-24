use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;

use crate::error::Result;

const CONFIG_FILENAME: &str = "config.json";

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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            base_url: None,
            concurrency: 3,
            api_key: None,
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

    pub fn get_api_key(&self) -> Option<String> {
        self.settings.read().unwrap().api_key.clone()
    }
}
