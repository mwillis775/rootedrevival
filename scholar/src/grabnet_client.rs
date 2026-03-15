//! GrabNet client for P2P operations
//! 
//! Integrates directly with the GrabNet library for:
//! - Publishing content to the network
//! - Pinning/hosting sites
//! - Fetching content from peers
//! - Auto-starting GrabNet if not running

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use serde::{Deserialize, Serialize};
use tokio::time::{sleep, Duration};

/// Response from GrabNet upload endpoint
#[derive(Debug, Deserialize)]
struct UploadResponse {
    upload: UploadInfo,
    url: String,
}

#[derive(Debug, Deserialize)]
struct UploadInfo {
    id: String,
}

/// GrabNet network status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkStatus {
    pub running: bool,
    pub peer_id: Option<String>,
    pub connected_peers: usize,
    pub published_sites: usize,
    pub hosted_sites: usize,
}

/// GrabNet client wrapper
pub struct GrabNetClient {
    /// Path to GrabNet data directory
    pub data_dir: PathBuf,
    
    /// Gateway URL for content access
    pub gateway_url: String,
    
    /// Whether GrabNet is available
    available: bool,
    
    /// Path to grab binary
    grab_binary: PathBuf,
}

impl GrabNetClient {
    pub async fn new() -> anyhow::Result<Self> {
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".grab");
        
        // Try to detect if GrabNet is running
        let gateway_url = std::env::var("GRAB_GATEWAY_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8888".to_string());
        
        // Find the grab binary
        let grab_binary = Self::find_grab_binary();
        
        let mut client = Self {
            data_dir,
            gateway_url: gateway_url.clone(),
            available: false,
            grab_binary,
        };
        
        // Check if GrabNet is already running
        if Self::check_availability(&gateway_url).await {
            client.available = true;
            tracing::info!("GrabNet already running at {}", gateway_url);
        } else {
            // Try to auto-start GrabNet
            tracing::info!("GrabNet not running, attempting to start...");
            if client.start_grabnet().await.is_ok() {
                client.available = true;
                tracing::info!("GrabNet started successfully");
            } else {
                tracing::warn!("Failed to start GrabNet - will run in local-only mode");
            }
        }
        
        Ok(client)
    }
    
    /// Find the grab binary in common locations
    fn find_grab_binary() -> PathBuf {
        // Check environment variable first
        if let Ok(path) = std::env::var("GRAB_BINARY") {
            return PathBuf::from(path);
        }
        
        // Common locations to check
        let candidates = [
            // Development build
            PathBuf::from("../grab/target/release/grab"),
            PathBuf::from("./grab/target/release/grab"),
            // System-wide installation
            PathBuf::from("/usr/local/bin/grab"),
            PathBuf::from("/usr/bin/grab"),
            // User local bin
            dirs::home_dir()
                .map(|h| h.join(".local/bin/grab"))
                .unwrap_or_else(|| PathBuf::from("/tmp/grab")),
            // Cargo bin
            dirs::home_dir()
                .map(|h| h.join(".cargo/bin/grab"))
                .unwrap_or_else(|| PathBuf::from("/tmp/grab")),
        ];
        
        for candidate in candidates {
            if candidate.exists() && candidate.is_file() {
                tracing::debug!("Found grab binary at: {:?}", candidate);
                return candidate;
            }
        }
        
        // Fallback - hope it's in PATH
        PathBuf::from("grab")
    }
    
    /// Start the GrabNet daemon
    async fn start_grabnet(&self) -> anyhow::Result<()> {
        // Check if binary exists
        if !self.grab_binary.exists() && !self.grab_binary.to_str().map(|s| s == "grab").unwrap_or(false) {
            tracing::warn!("Grab binary not found at {:?}", self.grab_binary);
            return Err(anyhow::anyhow!("Grab binary not found"));
        }
        
        tracing::info!("Starting GrabNet with binary: {:?}", self.grab_binary);
        
        // Start grab in the background with gateway enabled
        let result = Command::new(&self.grab_binary)
            .args([
                "run",
                "--gateway",
                "--gateway-port", "8888",
                "--default-site", "rootedrevival",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        
        match result {
            Ok(child) => {
                tracing::info!("GrabNet process started with PID: {}", child.id());
                
                // Wait for the gateway to become available
                for i in 0..10 {
                    sleep(Duration::from_millis(500)).await;
                    if Self::check_availability(&self.gateway_url).await {
                        tracing::info!("GrabNet gateway ready after {}ms", (i + 1) * 500);
                        return Ok(());
                    }
                }
                
                tracing::warn!("GrabNet started but gateway not responding");
                Err(anyhow::anyhow!("Gateway not responding after startup"))
            }
            Err(e) => {
                tracing::error!("Failed to start GrabNet: {}", e);
                Err(anyhow::anyhow!("Failed to start GrabNet: {}", e))
            }
        }
    }
    
    async fn check_availability(gateway_url: &str) -> bool {
        // Try to ping the gateway
        if let Ok(client) = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
        {
            if let Ok(resp) = client.get(format!("{}/health", gateway_url)).send().await {
                return resp.status().is_success();
            }
        }
        false
    }
    
    /// Check if GrabNet is available
    pub fn is_available(&self) -> bool {
        self.available
    }
    
    /// Refresh availability status
    pub async fn refresh_availability(&mut self) {
        self.available = Self::check_availability(&self.gateway_url).await;
    }
    
    /// Get the gateway URL for a site
    pub fn get_site_url(&self, site_id: &str) -> String {
        format!("{}/site/{}/", self.gateway_url, site_id)
    }
    
    /// Get the gateway URL for a file by its CID/path
    /// When called with just cid, uses it as both site_id and path
    pub fn get_file_url(&self, cid: &str) -> String {
        format!("{}/content/{}", self.gateway_url, cid)
    }
    
    /// Get the gateway URL for a file path within a site
    pub fn get_site_file_url(&self, site_id: &str, path: &str) -> String {
        format!("{}/site/{}/{}", self.gateway_url, site_id, path.trim_start_matches('/'))
    }
    
    /// Simple add file - just stores the relative path as the "CID" for now
    /// In production this would actually add to GrabNet and return a real CID
    pub async fn add_file(&self, file_path: &Path) -> anyhow::Result<String> {
        if !self.available {
            // Fallback to just returning filename
            let filename = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            return Ok(filename.to_string());
        }

        // Read the file content
        let data = tokio::fs::read(file_path).await?;
        let filename = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("upload");
        
        // Determine content type from extension
        let content_type = match file_path.extension().and_then(|e| e.to_str()) {
            Some("pdf") => "application/pdf",
            Some("txt") => "text/plain",
            Some("html") | Some("htm") => "text/html",
            Some("json") => "application/json",
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            Some("gif") => "image/gif",
            Some("svg") => "image/svg+xml",
            Some("mp4") => "video/mp4",
            Some("webm") => "video/webm",
            Some("mp3") => "audio/mpeg",
            Some("ogg") => "audio/ogg",
            _ => "application/octet-stream",
        };
        
        // Upload to GrabNet gateway
        // The gateway should have a site configured for user uploads
        let upload_result = self.upload_to_gateway(&data, filename, content_type).await;
        
        match upload_result {
            Ok(upload_id) => {
                tracing::info!("File uploaded to GrabNet: {}", upload_id);
                Ok(upload_id)
            }
            Err(e) => {
                tracing::warn!("Failed to upload to GrabNet: {}, using local storage", e);
                // Fallback to just returning filename
                Ok(filename.to_string())
            }
        }
    }

    /// Upload data to the GrabNet gateway
    async fn upload_to_gateway(
        &self,
        data: &[u8],
        filename: &str,
        content_type: &str,
    ) -> anyhow::Result<String> {
        // For user uploads, we need a site configured for uploads
        // Default to "scholar-uploads" site
        let site_id = std::env::var("GRAB_UPLOAD_SITE")
            .unwrap_or_else(|_| "scholar".to_string());
        
        let client = reqwest::Client::new();
        let url = format!("{}/api/sites/{}/uploads", self.gateway_url, site_id);
        
        let response = client
            .post(&url)
            .header("Content-Type", content_type)
            .header("X-Upload-Filename", filename)
            .body(data.to_vec())
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await?;
        
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Upload failed ({}): {}", status, body));
        }
        
        // Parse response to get upload ID
        let result: UploadResponse = response.json().await?;
        Ok(result.upload.id)
    }
    
    /// Delete file by path
    pub async fn delete_file(&self, cid: &str) -> anyhow::Result<()> {
        // For now, files are deleted by the handler directly
        // This would remove from GrabNet in production
        let _ = cid;
        Ok(())
    }
    
    /// Add content to be published
    /// Returns the relative path within the content directory
    pub async fn add_content(
        &self,
        username: &str,
        content_dir: &Path,
        data: &[u8],
        filename: &str,
    ) -> anyhow::Result<String> {
        let user_dir = content_dir.join(username);
        tokio::fs::create_dir_all(&user_dir).await?;
        
        // Generate unique filename
        let ext = Path::new(filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let base = Path::new(filename)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        
        let timestamp = chrono::Utc::now().timestamp_millis();
        let unique_name = if ext.is_empty() {
            format!("{}-{}", base, timestamp)
        } else {
            format!("{}-{}.{}", base, timestamp, ext)
        };
        
        let file_path = user_dir.join(&unique_name);
        tokio::fs::write(&file_path, data).await?;
        
        // Also write metadata
        let meta = serde_json::json!({
            "originalName": filename,
            "uploadedAt": chrono::Utc::now().to_rfc3339(),
            "size": data.len(),
            "uploader": username,
        });
        
        let meta_path = user_dir.join(format!("{}.meta.json", unique_name));
        tokio::fs::write(&meta_path, serde_json::to_string_pretty(&meta)?).await?;
        
        Ok(format!("{}/{}", username, unique_name))
    }
    
    /// Delete content
    pub async fn delete_content(&self, content_dir: &Path, relative_path: &str) -> anyhow::Result<()> {
        let file_path = content_dir.join(relative_path);
        let meta_path = content_dir.join(format!("{}.meta.json", relative_path));
        
        if file_path.exists() {
            tokio::fs::remove_file(&file_path).await?;
        }
        if meta_path.exists() {
            tokio::fs::remove_file(&meta_path).await?;
        }
        
        Ok(())
    }
    
    /// Publish the Scholar site to GrabNet
    /// This would call the grab CLI or use the library directly
    pub async fn publish_site(&self, site_dir: &Path) -> anyhow::Result<PublishResult> {
        // For now, we'll shell out to the grab CLI
        // In production, this would use the grabnet library directly
        
        let site_name = "scholar";
        
        let output = tokio::process::Command::new("grab")
            .args(["update", site_name])
            .current_dir(site_dir)
            .output()
            .await;
        
        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let stderr = String::from_utf8_lossy(&out.stderr);
                
                if out.status.success() {
                    // Parse site_id and revision from output
                    let site_id = stdout
                        .lines()
                        .find(|l| l.contains("grab://"))
                        .and_then(|l| l.split("grab://").nth(1))
                        .and_then(|s| s.split_whitespace().next())
                        .unwrap_or(site_name)
                        .to_string();
                    
                    let revision = stdout
                        .lines()
                        .find(|l| l.contains("revision"))
                        .and_then(|l| l.split_whitespace().last())
                        .and_then(|r| r.parse().ok())
                        .unwrap_or(0);
                    
                    Ok(PublishResult {
                        success: true,
                        site_id,
                        revision,
                        message: stdout.to_string(),
                    })
                } else {
                    Err(anyhow::anyhow!("Publish failed: {}", stderr))
                }
            }
            Err(e) => Err(anyhow::anyhow!("Failed to run grab: {}", e)),
        }
    }

    /// Get network status from GrabNet gateway
    pub async fn get_network_status(&self) -> anyhow::Result<NetworkStatus> {
        if !self.available {
            return Ok(NetworkStatus {
                running: false,
                peer_id: None,
                connected_peers: 0,
                published_sites: 0,
                hosted_sites: 0,
            });
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()?;
        
        let response = client
            .get(format!("{}/api/network", self.gateway_url))
            .send()
            .await?;
        
        if response.status().is_success() {
            let status: NetworkStatus = response.json().await?;
            Ok(status)
        } else {
            Ok(NetworkStatus {
                running: false,
                peer_id: None,
                connected_peers: 0,
                published_sites: 0,
                hosted_sites: 0,
            })
        }
    }

    /// Get the peer viewer URL
    pub fn get_peer_viewer_url(&self) -> String {
        format!("{}/peers", self.gateway_url)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PublishResult {
    pub success: bool,
    pub site_id: String,
    pub revision: u64,
    pub message: String,
}
