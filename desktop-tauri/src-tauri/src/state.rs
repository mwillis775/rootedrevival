//! Application state for the desktop app

use std::path::PathBuf;
use tokio::process::Child;

/// Global application state
pub struct AppState {
    /// Scholar server process (if running embedded)
    pub scholar_process: Option<Child>,

    /// GrabNet node process (if running embedded)
    pub grabnet_process: Option<Child>,

    /// Data directory for local storage
    pub data_dir: PathBuf,

    /// Scholar API URL
    pub scholar_url: String,

    /// GrabNet gateway URL
    pub grabnet_url: String,

    /// User's peer ID
    pub peer_id: Option<String>,

    /// Whether we're in offline mode
    pub offline_mode: bool,

    /// Path to scholar binary
    pub scholar_bin: Option<PathBuf>,

    /// Path to grab binary
    pub grab_bin: Option<PathBuf>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("rooted-revival");

        let _ = std::fs::create_dir_all(&data_dir);

        let scholar_bin = which::which("scholar").ok();
        let grab_bin = which::which("grab").ok();

        Self {
            scholar_process: None,
            grabnet_process: None,
            data_dir,
            scholar_url: "http://127.0.0.1:8889".into(),
            grabnet_url: "http://127.0.0.1:8080".into(),
            peer_id: None,
            offline_mode: false,
            scholar_bin,
            grab_bin,
        }
    }

    pub fn is_scholar_running(&self) -> bool {
        self.scholar_process.is_some()
    }

    pub fn is_grabnet_running(&self) -> bool {
        self.grabnet_process.is_some()
    }
}
