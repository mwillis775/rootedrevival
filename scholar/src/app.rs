//! Application state and configuration

use std::path::PathBuf;
use std::sync::Arc;

use crate::db::Database;
use crate::email::EmailService;
use crate::grabnet_client::GrabNetClient;

/// Application state shared across all handlers
pub struct AppState {
    /// Data directory for Scholar
    pub data_dir: PathBuf,
    
    /// SQLite database for user data, files, reviews
    pub db: Database,
    
    /// GrabNet client for P2P operations
    pub grabnet: GrabNetClient,
    
    /// Email service for notifications
    pub email: Arc<EmailService>,
    
    /// Content directory for user uploads
    pub content_dir: PathBuf,
    
    /// Static files directory
    pub static_dir: PathBuf,
}

impl AppState {
    pub async fn new(data_dir: PathBuf) -> anyhow::Result<Self> {
        // Create directories
        std::fs::create_dir_all(&data_dir)?;
        
        let content_dir = data_dir.join("content");
        std::fs::create_dir_all(&content_dir)?;
        
        let static_dir = data_dir.join("static");
        std::fs::create_dir_all(&static_dir)?;
        
        // Initialize database
        let db_path = data_dir.join("scholar.db");
        let db = Database::new(&db_path)?;
        
        // Initialize GrabNet client
        let grabnet = GrabNetClient::new().await?;
        
        // Initialize email service
        let email = Arc::new(EmailService::from_env());
        
        tracing::info!("Scholar data directory: {:?}", data_dir);
        tracing::info!("GrabNet client initialized");
        tracing::info!("Email service initialized: enabled={}", email.is_enabled());
        
        Ok(Self {
            data_dir,
            db,
            grabnet,
            email,
            content_dir,
            static_dir,
        })
    }
    
    /// Get path for a user's content directory
    pub fn user_content_dir(&self, username: &str) -> PathBuf {
        let dir = self.content_dir.join(username);
        if !dir.exists() {
            let _ = std::fs::create_dir_all(&dir);
        }
        dir
    }
}
