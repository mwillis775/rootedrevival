//! Tauri commands for the desktop app

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// Status response
#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub scholar_running: bool,
    pub grabnet_running: bool,
    pub offline_mode: bool,
    pub peer_id: Option<String>,
    pub connected_peers: u32,
}

/// Network stats response
#[derive(Debug, Serialize)]
pub struct NetworkStats {
    pub connected_peers: u32,
    pub published_sites: u32,
    pub hosted_sites: u32,
    pub bytes_sent: u64,
    pub bytes_received: u64,
}

/// Storage stats response
#[derive(Debug, Serialize)]
pub struct StorageStats {
    pub total_files: u32,
    pub total_size_bytes: u64,
    pub cached_sites: u32,
    pub local_uploads: u32,
}

/// File info
#[derive(Debug, Serialize)]
pub struct FileInfo {
    pub uuid: String,
    pub filename: String,
    pub content_type: String,
    pub size: u64,
    pub grabnet_cid: Option<String>,
    pub created_at: String,
}

/// Site info for publishing/pinning
#[derive(Debug, Deserialize)]
pub struct SiteRequest {
    pub site_id: String,
}

/// Upload request
#[derive(Debug, Deserialize)]
pub struct UploadRequest {
    pub path: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
}

/// Download request
#[derive(Debug, Deserialize)]
pub struct DownloadRequest {
    pub uuid: String,
    pub destination: String,
}

/// Identity export/import
#[derive(Debug, Serialize, Deserialize)]
pub struct IdentityData {
    pub public_key: String,
    pub private_key: String,
    pub username: String,
}

// ============================================================================
// Scholar Management Commands
// ============================================================================

#[tauri::command]
pub async fn start_scholar(state: State<'_, Arc<Mutex<AppState>>>) -> Result<String, String> {
    let mut app_state = state.lock().await;
    
    if app_state.is_scholar_running() {
        return Ok("Scholar is already running".into());
    }
    
    // Start scholar as a child process
    let scholar_path = which::which("scholar")
        .map_err(|_| "Scholar binary not found. Please install Scholar first.")?;
    
    let child = tokio::process::Command::new(scholar_path)
        .arg("--data-dir")
        .arg(&app_state.data_dir.join("scholar"))
        .spawn()
        .map_err(|e| format!("Failed to start Scholar: {}", e))?;
    
    app_state.scholar_process = Some(child);
    
    Ok("Scholar started successfully".into())
}

#[tauri::command]
pub async fn stop_scholar(state: State<'_, Arc<Mutex<AppState>>>) -> Result<String, String> {
    let mut app_state = state.lock().await;
    
    if let Some(mut process) = app_state.scholar_process.take() {
        process.kill().await.map_err(|e| format!("Failed to stop Scholar: {}", e))?;
    }
    
    Ok("Scholar stopped".into())
}

// ============================================================================
// GrabNet Management Commands
// ============================================================================

#[tauri::command]
pub async fn start_grabnet(state: State<'_, Arc<Mutex<AppState>>>) -> Result<String, String> {
    let mut app_state = state.lock().await;
    
    if app_state.is_grabnet_running() {
        return Ok("GrabNet is already running".into());
    }
    
    // Start grab node as a child process
    let grab_path = which::which("grab")
        .map_err(|_| "GrabNet binary not found. Please install GrabNet first.")?;
    
    let child = tokio::process::Command::new(grab_path)
        .arg("node")
        .arg("start")
        .spawn()
        .map_err(|e| format!("Failed to start GrabNet: {}", e))?;
    
    app_state.grabnet_process = Some(child);
    
    Ok("GrabNet node started successfully".into())
}

#[tauri::command]
pub async fn stop_grabnet(state: State<'_, Arc<Mutex<AppState>>>) -> Result<String, String> {
    let mut app_state = state.lock().await;
    
    if let Some(mut process) = app_state.grabnet_process.take() {
        process.kill().await.map_err(|e| format!("Failed to stop GrabNet: {}", e))?;
    }
    
    Ok("GrabNet stopped".into())
}

// ============================================================================
// Status Commands
// ============================================================================

#[tauri::command]
pub async fn get_status(state: State<'_, Arc<Mutex<AppState>>>) -> Result<StatusResponse, String> {
    let app_state = state.lock().await;
    
    let connected_peers = if app_state.is_grabnet_running() {
        // Query the gateway for peer count
        match reqwest::get(format!("{}/peers", app_state.grabnet_url)).await {
            Ok(resp) => {
                resp.json::<serde_json::Value>().await
                    .map(|v| v.get("count").and_then(|c| c.as_u64()).unwrap_or(0) as u32)
                    .unwrap_or(0)
            }
            Err(_) => 0,
        }
    } else {
        0
    };
    
    Ok(StatusResponse {
        scholar_running: app_state.is_scholar_running(),
        grabnet_running: app_state.is_grabnet_running(),
        offline_mode: app_state.offline_mode,
        peer_id: app_state.peer_id.clone(),
        connected_peers,
    })
}

#[tauri::command]
pub async fn get_peer_id(state: State<'_, Arc<Mutex<AppState>>>) -> Result<Option<String>, String> {
    let app_state = state.lock().await;
    Ok(app_state.peer_id.clone())
}

#[tauri::command]
pub async fn get_connected_peers(state: State<'_, Arc<Mutex<AppState>>>) -> Result<Vec<String>, String> {
    let app_state = state.lock().await;
    
    if !app_state.is_grabnet_running() {
        return Ok(Vec::new());
    }
    
    let resp = reqwest::get(format!("{}/peers", app_state.grabnet_url))
        .await
        .map_err(|e| format!("Failed to get peers: {}", e))?;
    
    let data: serde_json::Value = resp.json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let peers = data.get("peers")
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    
    Ok(peers)
}

#[tauri::command]
pub async fn get_published_sites(state: State<'_, Arc<Mutex<AppState>>>) -> Result<Vec<String>, String> {
    let app_state = state.lock().await;
    
    if !app_state.is_grabnet_running() {
        return Ok(Vec::new());
    }
    
    let resp = reqwest::get(format!("{}/api/network/status", app_state.grabnet_url))
        .await
        .map_err(|e| format!("Failed to get status: {}", e))?;
    
    let data: serde_json::Value = resp.json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let sites = data.get("published_sites")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    
    Ok(sites)
}

// ============================================================================
// Site Management Commands
// ============================================================================

#[tauri::command]
pub async fn publish_site(
    state: State<'_, Arc<Mutex<AppState>>>,
    request: SiteRequest,
) -> Result<String, String> {
    let app_state = state.lock().await;
    
    if !app_state.is_grabnet_running() {
        return Err("GrabNet is not running".into());
    }
    
    let client = reqwest::Client::new();
    let resp = client.post(format!("{}/publish", app_state.grabnet_url))
        .json(&serde_json::json!({ "site_id": request.site_id }))
        .send()
        .await
        .map_err(|e| format!("Failed to publish: {}", e))?;
    
    if resp.status().is_success() {
        Ok("Site published successfully".into())
    } else {
        Err("Failed to publish site".into())
    }
}

#[tauri::command]
pub async fn pin_site(
    state: State<'_, Arc<Mutex<AppState>>>,
    request: SiteRequest,
) -> Result<String, String> {
    let app_state = state.lock().await;
    
    if !app_state.is_grabnet_running() {
        return Err("GrabNet is not running".into());
    }
    
    let client = reqwest::Client::new();
    let resp = client.post(format!("{}/pin", app_state.grabnet_url))
        .json(&serde_json::json!({ "site_id": request.site_id }))
        .send()
        .await
        .map_err(|e| format!("Failed to pin: {}", e))?;
    
    if resp.status().is_success() {
        Ok("Site pinned successfully".into())
    } else {
        Err("Failed to pin site".into())
    }
}

// ============================================================================
// File Commands
// ============================================================================

#[tauri::command]
pub async fn get_files(state: State<'_, Arc<Mutex<AppState>>>) -> Result<Vec<FileInfo>, String> {
    let app_state = state.lock().await;
    
    if !app_state.is_scholar_running() {
        return Err("Scholar is not running".into());
    }
    
    let resp = reqwest::get(format!("{}/api/browse/recent", app_state.scholar_url))
        .await
        .map_err(|e| format!("Failed to get files: {}", e))?;
    
    let data: serde_json::Value = resp.json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let files = data.get("files")
        .and_then(|f| f.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    Some(FileInfo {
                        uuid: v.get("uuid")?.as_str()?.to_string(),
                        filename: v.get("filename")?.as_str()?.to_string(),
                        content_type: v.get("content_type")?.as_str()?.to_string(),
                        size: v.get("size")?.as_u64()?,
                        grabnet_cid: v.get("grabnet_cid").and_then(|c| c.as_str().map(String::from)),
                        created_at: v.get("created_at")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    
    Ok(files)
}

#[tauri::command]
pub async fn upload_file(
    state: State<'_, Arc<Mutex<AppState>>>,
    request: UploadRequest,
) -> Result<FileInfo, String> {
    let app_state = state.lock().await;
    
    if !app_state.is_scholar_running() {
        return Err("Scholar is not running".into());
    }
    
    // Read file
    let file_data = tokio::fs::read(&request.path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;
    
    let filename = std::path::Path::new(&request.path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");
    
    let form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(file_data).file_name(filename.to_string()));
    
    let client = reqwest::Client::new();
    let resp = client.post(format!("{}/api/files", app_state.scholar_url))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Failed to upload: {}", e))?;
    
    let data: serde_json::Value = resp.json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let file = data.get("file")
        .ok_or("Invalid response")?;
    
    Ok(FileInfo {
        uuid: file.get("uuid").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        filename: file.get("filename").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        content_type: file.get("content_type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        size: file.get("size").and_then(|v| v.as_u64()).unwrap_or(0),
        grabnet_cid: file.get("grabnet_cid").and_then(|c| c.as_str().map(String::from)),
        created_at: file.get("created_at").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    })
}

#[tauri::command]
pub async fn download_file(
    state: State<'_, Arc<Mutex<AppState>>>,
    request: DownloadRequest,
) -> Result<String, String> {
    let app_state = state.lock().await;
    
    if !app_state.is_scholar_running() {
        return Err("Scholar is not running".into());
    }
    
    let resp = reqwest::get(format!("{}/api/files/{}/download", app_state.scholar_url, request.uuid))
        .await
        .map_err(|e| format!("Failed to download: {}", e))?;
    
    let bytes = resp.bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    tokio::fs::write(&request.destination, bytes)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;
    
    Ok(request.destination)
}

// ============================================================================
// Stats Commands
// ============================================================================

#[tauri::command]
pub async fn get_network_stats(state: State<'_, Arc<Mutex<AppState>>>) -> Result<NetworkStats, String> {
    let app_state = state.lock().await;
    
    if !app_state.is_grabnet_running() {
        return Ok(NetworkStats {
            connected_peers: 0,
            published_sites: 0,
            hosted_sites: 0,
            bytes_sent: 0,
            bytes_received: 0,
        });
    }
    
    let resp = reqwest::get(format!("{}/api/network/status", app_state.grabnet_url))
        .await
        .map_err(|e| format!("Failed to get stats: {}", e))?;
    
    let data: serde_json::Value = resp.json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    Ok(NetworkStats {
        connected_peers: data.get("connected_peers").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        published_sites: data.get("published_sites").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        hosted_sites: data.get("hosted_sites").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        bytes_sent: data.get("bytes_sent").and_then(|v| v.as_u64()).unwrap_or(0),
        bytes_received: data.get("bytes_received").and_then(|v| v.as_u64()).unwrap_or(0),
    })
}

#[tauri::command]
pub async fn get_storage_stats(state: State<'_, Arc<Mutex<AppState>>>) -> Result<StorageStats, String> {
    let app_state = state.lock().await;
    
    if !app_state.is_scholar_running() {
        return Ok(StorageStats {
            total_files: 0,
            total_size_bytes: 0,
            cached_sites: 0,
            local_uploads: 0,
        });
    }
    
    let resp = reqwest::get(format!("{}/api/admin/stats", app_state.scholar_url))
        .await
        .map_err(|e| format!("Failed to get stats: {}", e))?;
    
    let data: serde_json::Value = resp.json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    Ok(StorageStats {
        total_files: data.get("total_files").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        total_size_bytes: data.get("total_storage_bytes").and_then(|v| v.as_u64()).unwrap_or(0),
        cached_sites: 0, // TODO: Implement
        local_uploads: data.get("total_files").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
    })
}

// ============================================================================
// Identity Commands
// ============================================================================

#[tauri::command]
pub async fn export_identity(
    state: State<'_, Arc<Mutex<AppState>>>,
    password: String,
) -> Result<String, String> {
    // This would export the user's keys encrypted with the password
    // For now, return a placeholder
    Err("Identity export not yet implemented".into())
}

#[tauri::command]
pub async fn import_identity(
    state: State<'_, Arc<Mutex<AppState>>>,
    data: String,
    password: String,
) -> Result<String, String> {
    // This would import encrypted identity data
    Err("Identity import not yet implemented".into())
}
