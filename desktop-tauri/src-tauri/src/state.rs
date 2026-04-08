//! Application state for the Rooted Revival desktop app.
//!
//! Stores authentication, service config, and child process handles.

use std::path::PathBuf;
use tokio::process::Child;

/// Persistent settings saved to disk.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Settings {
    /// Base URL of the Rooted Revival server (e.g. "https://scholar.rootedrevival.us")
    pub server_url: String,
    /// Whether to auto-start GrabNet on launch
    pub auto_pin: bool,
    /// Local data directory
    pub data_dir: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            server_url: "https://scholar.rootedrevival.us".into(),
            auto_pin: true,
            data_dir: dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("rooted-revival")
                .to_string_lossy()
                .into_owned(),
        }
    }
}

/// Authenticated user info from the server.
#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
pub struct UserInfo {
    pub id: i64,
    pub username: String,
    pub email: Option<String>,
    #[serde(alias = "displayName", alias = "display_name")]
    pub display_name: Option<String>,
    #[serde(alias = "isAdmin", default)]
    pub is_admin: bool,
    #[serde(alias = "isModerator", default)]
    pub is_moderator: bool,
}

/// Global app state behind a tokio Mutex.
pub struct AppState {
    /// Session token from login (used as Bearer token)
    pub token: Option<String>,
    /// Logged-in user info
    pub user: Option<UserInfo>,
    /// GrabNet child process (if we started it)
    pub grabnet_process: Option<Child>,
    /// Path to grab binary
    pub grab_bin: Option<PathBuf>,
    /// Current settings
    pub settings: Settings,
    /// GrabNet gateway URL (local)
    pub grabnet_url: String,
    /// Whether heartbeat loop is running
    pub heartbeat_active: bool,
}

impl AppState {
    pub fn new() -> Self {
        let settings = Settings::default();
        let grab_bin = which::which("grab").ok().or_else(|| {
            // Check common non-PATH locations
            let candidates = [
                // Project build directory (development)
                std::env::current_dir().ok().map(|d| d.join("../grab/target/release/grab")),
                // System-wide install
                Some(PathBuf::from("/usr/local/bin/grab")),
                // Home cargo bin
                dirs::home_dir().map(|h| h.join(".cargo/bin/grab")),
                // Sibling project directory
                dirs::home_dir().map(|h| h.join("projects/rootedrevival/grab/target/release/grab")),
            ];
            candidates.into_iter().flatten().find(|p| p.is_file())
        });

        Self {
            token: None,
            user: None,
            grabnet_process: None,
            grab_bin,
            settings,
            grabnet_url: "http://127.0.0.1:8888".into(),
            heartbeat_active: false,
        }
    }

    /// Load settings from disk, falling back to defaults.
    pub fn load_settings(&mut self) {
        let path = self.settings_path();
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(s) = serde_json::from_str::<Settings>(&data) {
                self.settings = s;
            }
        }
        // Also try to load saved token
        let token_path = self.token_path();
        if let Ok(data) = std::fs::read_to_string(&token_path) {
            let trimmed = data.trim().to_string();
            if !trimmed.is_empty() {
                self.token = Some(trimmed);
            }
        }
    }

    /// Persist settings to disk.
    pub fn save_settings(&self) {
        let dir = PathBuf::from(&self.settings.data_dir);
        let _ = std::fs::create_dir_all(&dir);
        let path = self.settings_path();
        if let Ok(json) = serde_json::to_string_pretty(&self.settings) {
            let _ = std::fs::write(path, json);
        }
    }

    /// Save token to disk (so user stays logged in).
    pub fn save_token(&self) {
        let dir = PathBuf::from(&self.settings.data_dir);
        let _ = std::fs::create_dir_all(&dir);
        let path = self.token_path();
        if let Some(ref t) = self.token {
            if let Err(e) = std::fs::write(&path, t) {
                eprintln!("[RR] Failed to save token to {}: {}", path.display(), e);
            }
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }

    fn settings_path(&self) -> PathBuf {
        PathBuf::from(&self.settings.data_dir).join("settings.json")
    }

    fn token_path(&self) -> PathBuf {
        PathBuf::from(&self.settings.data_dir).join(".session")
    }
}