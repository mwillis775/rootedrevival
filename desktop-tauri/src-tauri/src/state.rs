//! Application state for the desktop app

use std::path::PathBuf;
use tokio::process::Child;

/// Global application state
#[derive(Default)]
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
}

impl AppState {
    pub fn new() -> Self {
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("rooted-revival");
        
        Self {
            scholar_process: None,
            grabnet_process: None,
            data_dir,
            scholar_url: "http://localhost:8889".into(),
            grabnet_url: "http://localhost:8080".into(),
            peer_id: None,
            offline_mode: false,
        }
    }
    
    pub fn is_scholar_running(&self) -> bool {
        self.scholar_process.is_some()
    }
    
    pub fn is_grabnet_running(&self) -> bool {
        self.grabnet_process.is_some()
    }
}
