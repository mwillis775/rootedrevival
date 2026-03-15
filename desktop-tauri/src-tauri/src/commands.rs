//! Tauri commands for the desktop app

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

// ============================================================================
// Response / Request types
// ============================================================================

#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub scholar_running: bool,
    pub grabnet_running: bool,
    pub offline_mode: bool,
    pub peer_id: Option<String>,
    pub connected_peers: u32,
    pub scholar_available: bool,
    pub grabnet_available: bool,
}

#[derive(Debug, Serialize)]
pub struct NetworkStats {
    pub connected_peers: u32,
    pub published_sites: u32,
    pub hosted_sites: u32,
    pub bytes_sent: u64,
    pub bytes_received: u64,
}

#[derive(Debug, Serialize)]
pub struct StorageStats {
    pub total_files: u32,
    pub total_size_bytes: u64,
    pub cached_sites: u32,
    pub local_uploads: u32,
    pub data_dir: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct FileInfo {
    pub uuid: String,
    pub title: String,
    pub filename: String,
    pub content_type: String,
    pub size: u64,
    pub grabnet_cid: Option<String>,
    pub created_at: String,
    pub work_type: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[allow(dead_code)]
pub struct PinnedSite {
    pub site_id: String,
    pub name: Option<String>,
    pub size: u64,
    pub pinned_at: String,
}

#[derive(Debug, Deserialize)]
pub struct SiteRequest {
    pub site_id: String,
}

#[derive(Debug, Deserialize)]
pub struct UploadRequest {
    pub path: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub work_type: Option<String>,
    #[allow(dead_code)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct DownloadRequest {
    pub uuid: String,
    pub destination: String,
}

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub work_type: Option<String>,
    pub page: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub results: Vec<FileInfo>,
    pub total: u32,
    pub page: u32,
}

// Helper to make HTTP requests with timeout
async fn http_get(url: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    resp.json().await.map_err(|e| e.to_string())
}

// ============================================================================
// Scholar Management
// ============================================================================

#[tauri::command]
pub async fn start_scholar(state: State<'_, Arc<Mutex<AppState>>>) -> Result<String, String> {
    let mut app = state.lock().await;

    if app.is_scholar_running() {
        return Ok("Scholar is already running".into());
    }

    let bin = app
        .scholar_bin
        .clone()
        .ok_or("Scholar binary not found. Install it or set it in settings.")?;

    let data_dir = app.data_dir.join("scholar");
    let _ = std::fs::create_dir_all(&data_dir);

    let child = tokio::process::Command::new(&bin)
        .arg("--data-dir")
        .arg(&data_dir)
        .arg("--port")
        .arg("8889")
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start Scholar: {}", e))?;

    app.scholar_process = Some(child);

    // Wait briefly for it to bind
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    Ok("Scholar started".into())
}

#[tauri::command]
pub async fn stop_scholar(state: State<'_, Arc<Mutex<AppState>>>) -> Result<String, String> {
    let mut app = state.lock().await;
    if let Some(mut p) = app.scholar_process.take() {
        let _ = p.kill().await;
    }
    Ok("Scholar stopped".into())
}

// ============================================================================
// GrabNet Management
// ============================================================================

#[tauri::command]
pub async fn start_grabnet(state: State<'_, Arc<Mutex<AppState>>>) -> Result<String, String> {
    let mut app = state.lock().await;

    if app.is_grabnet_running() {
        return Ok("GrabNet is already running".into());
    }

    let bin = app
        .grab_bin
        .clone()
        .ok_or("GrabNet binary not found. Install it or set it in settings.")?;

    let data_dir = app.data_dir.join("grabnet");
    let _ = std::fs::create_dir_all(&data_dir);

    let child = tokio::process::Command::new(&bin)
        .arg("run")
        .arg("--gateway")
        .arg("--gateway-port")
        .arg("8080")
        .arg("--data-dir")
        .arg(&data_dir)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start GrabNet: {}", e))?;

    app.grabnet_process = Some(child);

    tokio::time::sleep(std::time::Duration::from_millis(2000)).await;

    Ok("GrabNet started".into())
}

#[tauri::command]
pub async fn stop_grabnet(state: State<'_, Arc<Mutex<AppState>>>) -> Result<String, String> {
    let mut app = state.lock().await;
    if let Some(mut p) = app.grabnet_process.take() {
        let _ = p.kill().await;
    }
    Ok("GrabNet stopped".into())
}

// ============================================================================
// Status
// ============================================================================

#[tauri::command]
pub async fn get_status(state: State<'_, Arc<Mutex<AppState>>>) -> Result<StatusResponse, String> {
    let app = state.lock().await;

    let scholar_available = app.scholar_bin.is_some();
    let grabnet_available = app.grab_bin.is_some();

    let connected_peers = if app.is_grabnet_running() {
        http_get(&format!("{}/peers", app.grabnet_url))
            .await
            .ok()
            .and_then(|v| v.get("count")?.as_u64())
            .unwrap_or(0) as u32
    } else {
        0
    };

    Ok(StatusResponse {
        scholar_running: app.is_scholar_running(),
        grabnet_running: app.is_grabnet_running(),
        offline_mode: app.offline_mode,
        peer_id: app.peer_id.clone(),
        connected_peers,
        scholar_available,
        grabnet_available,
    })
}

#[tauri::command]
pub async fn get_peer_id(state: State<'_, Arc<Mutex<AppState>>>) -> Result<Option<String>, String> {
    let app = state.lock().await;
    Ok(app.peer_id.clone())
}

#[tauri::command]
pub async fn get_connected_peers(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<String>, String> {
    let app = state.lock().await;
    if !app.is_grabnet_running() {
        return Ok(Vec::new());
    }

    let data = http_get(&format!("{}/peers", app.grabnet_url)).await?;
    Ok(data
        .get("peers")
        .and_then(|p| p.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn get_published_sites(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<String>, String> {
    let app = state.lock().await;
    if !app.is_grabnet_running() {
        return Ok(Vec::new());
    }

    let data = http_get(&format!("{}/api/network/status", app.grabnet_url)).await?;
    Ok(data
        .get("published_sites")
        .and_then(|s| s.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default())
}

// ============================================================================
// Site Management
// ============================================================================

#[tauri::command]
pub async fn publish_site(
    state: State<'_, Arc<Mutex<AppState>>>,
    request: SiteRequest,
) -> Result<String, String> {
    let app = state.lock().await;
    if !app.is_grabnet_running() {
        return Err("GrabNet is not running. Start it first.".into());
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/publish", app.grabnet_url))
        .json(&serde_json::json!({ "site_id": request.site_id }))
        .send()
        .await
        .map_err(|e| format!("Publish failed: {}", e))?;

    if resp.status().is_success() {
        Ok("Site published".into())
    } else {
        let body = resp.text().await.unwrap_or_default();
        Err(format!("Publish failed: {}", body))
    }
}

#[tauri::command]
pub async fn pin_site(
    state: State<'_, Arc<Mutex<AppState>>>,
    request: SiteRequest,
) -> Result<String, String> {
    let app = state.lock().await;
    if !app.is_grabnet_running() {
        return Err("GrabNet is not running. Start it first.".into());
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/pin", app.grabnet_url))
        .json(&serde_json::json!({ "site_id": request.site_id }))
        .send()
        .await
        .map_err(|e| format!("Pin failed: {}", e))?;

    if resp.status().is_success() {
        Ok("Site pinned".into())
    } else {
        let body = resp.text().await.unwrap_or_default();
        Err(format!("Pin failed: {}", body))
    }
}

#[tauri::command]
pub async fn unpin_site(
    state: State<'_, Arc<Mutex<AppState>>>,
    request: SiteRequest,
) -> Result<String, String> {
    let app = state.lock().await;
    if !app.is_grabnet_running() {
        return Err("GrabNet is not running".into());
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/unpin", app.grabnet_url))
        .json(&serde_json::json!({ "site_id": request.site_id }))
        .send()
        .await
        .map_err(|e| format!("Unpin failed: {}", e))?;

    if resp.status().is_success() {
        Ok("Site unpinned".into())
    } else {
        Err("Unpin failed".into())
    }
}

// ============================================================================
// File / Content Commands
// ============================================================================

#[tauri::command]
pub async fn get_files(state: State<'_, Arc<Mutex<AppState>>>) -> Result<Vec<FileInfo>, String> {
    let app = state.lock().await;
    if !app.is_scholar_running() {
        return Ok(Vec::new());
    }

    let data = http_get(&format!("{}/api/browse/recent", app.scholar_url)).await?;

    Ok(parse_files_array(
        data.get("files").or_else(|| data.get("papers")),
    ))
}

#[tauri::command]
pub async fn search_content(
    state: State<'_, Arc<Mutex<AppState>>>,
    request: SearchRequest,
) -> Result<SearchResults, String> {
    let app = state.lock().await;
    if !app.is_scholar_running() {
        return Ok(SearchResults {
            results: Vec::new(),
            total: 0,
            page: 0,
        });
    }

    let mut url = format!(
        "{}/api/search?q={}",
        app.scholar_url,
        urlencoding::encode(&request.query)
    );
    if let Some(ref wt) = request.work_type {
        url.push_str(&format!("&type={}", urlencoding::encode(wt)));
    }
    if let Some(p) = request.page {
        url.push_str(&format!("&page={}", p));
    }

    let data = http_get(&url).await?;

    let results = parse_files_array(data.get("results").or_else(|| data.get("papers")));
    let total = data
        .get("total")
        .and_then(|v| v.as_u64())
        .unwrap_or(results.len() as u64) as u32;

    Ok(SearchResults {
        results,
        total,
        page: request.page.unwrap_or(1),
    })
}

#[tauri::command]
pub async fn upload_file(
    state: State<'_, Arc<Mutex<AppState>>>,
    request: UploadRequest,
) -> Result<FileInfo, String> {
    let app = state.lock().await;
    if !app.is_scholar_running() {
        return Err("Scholar is not running".into());
    }

    let file_data = tokio::fs::read(&request.path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let filename = std::path::Path::new(&request.path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let mut form = reqwest::multipart::Form::new().part(
        "file",
        reqwest::multipart::Part::bytes(file_data).file_name(filename.clone()),
    );

    if let Some(ref title) = request.title {
        form = form.text("title", title.clone());
    }
    if let Some(ref desc) = request.description {
        form = form.text("description", desc.clone());
    }
    if let Some(ref wt) = request.work_type {
        form = form.text("work_type", wt.clone());
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/files", app.scholar_url))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Upload failed: {}", e))?;

    let data: serde_json::Value = resp.json().await.map_err(|e| format!("Bad response: {}", e))?;

    let file = data.get("file").unwrap_or(&data);
    Ok(parse_file_info(file))
}

#[tauri::command]
pub async fn download_file(
    state: State<'_, Arc<Mutex<AppState>>>,
    request: DownloadRequest,
) -> Result<String, String> {
    let app = state.lock().await;
    if !app.is_scholar_running() {
        return Err("Scholar is not running".into());
    }

    let resp = reqwest::get(format!(
        "{}/api/files/{}/download",
        app.scholar_url, request.uuid
    ))
    .await
    .map_err(|e| format!("Download failed: {}", e))?;

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Read failed: {}", e))?;

    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&request.destination).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    tokio::fs::write(&request.destination, bytes)
        .await
        .map_err(|e| format!("Write failed: {}", e))?;

    Ok(request.destination)
}

// ============================================================================
// Stats
// ============================================================================

#[tauri::command]
pub async fn get_network_stats(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<NetworkStats, String> {
    let app = state.lock().await;
    if !app.is_grabnet_running() {
        return Ok(NetworkStats {
            connected_peers: 0,
            published_sites: 0,
            hosted_sites: 0,
            bytes_sent: 0,
            bytes_received: 0,
        });
    }

    let data = http_get(&format!("{}/api/network/status", app.grabnet_url))
        .await
        .unwrap_or_default();

    Ok(NetworkStats {
        connected_peers: data
            .get("connected_peers")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        published_sites: data
            .get("published_sites")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        hosted_sites: data
            .get("hosted_sites")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        bytes_sent: data.get("bytes_sent").and_then(|v| v.as_u64()).unwrap_or(0),
        bytes_received: data
            .get("bytes_received")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
    })
}

#[tauri::command]
pub async fn get_storage_stats(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<StorageStats, String> {
    let app = state.lock().await;

    // Calculate local storage even without Scholar running
    let data_dir = &app.data_dir;
    let mut total_size: u64 = 0;
    let mut file_count: u32 = 0;
    if data_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(data_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    total_size += meta.len();
                    if meta.is_file() {
                        file_count += 1;
                    }
                }
            }
        }
    }

    if app.is_scholar_running() {
        if let Ok(data) = http_get(&format!("{}/api/admin/stats", app.scholar_url)).await {
            return Ok(StorageStats {
                total_files: data
                    .get("total_files")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(file_count as u64) as u32,
                total_size_bytes: data
                    .get("total_storage_bytes")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(total_size),
                cached_sites: 0,
                local_uploads: data
                    .get("total_files")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32,
                data_dir: data_dir.display().to_string(),
            });
        }
    }

    Ok(StorageStats {
        total_files: file_count,
        total_size_bytes: total_size,
        cached_sites: 0,
        local_uploads: 0,
        data_dir: data_dir.display().to_string(),
    })
}

// ============================================================================
// Identity
// ============================================================================

#[tauri::command]
pub async fn export_identity(
    state: State<'_, Arc<Mutex<AppState>>>,
    _password: String,
) -> Result<String, String> {
    let app = state.lock().await;
    let keys_dir = app.data_dir.join("keys");
    let pub_path = keys_dir.join("public.key");
    let priv_path = keys_dir.join("private.key");

    if !pub_path.exists() || !priv_path.exists() {
        return Err("No identity keys found. Start GrabNet first to generate keys.".into());
    }

    let pub_key = std::fs::read_to_string(&pub_path).map_err(|e| e.to_string())?;
    let priv_key = std::fs::read_to_string(&priv_path).map_err(|e| e.to_string())?;

    let identity = serde_json::json!({
        "public_key": pub_key.trim(),
        "peer_id": app.peer_id,
        "exported_at": chrono_now(),
    });

    // Only include private key — in production this should be encrypted with the password
    let export = serde_json::json!({
        "version": 1,
        "identity": identity,
        "private_key": priv_key.trim(),
    });

    Ok(serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn import_identity(
    state: State<'_, Arc<Mutex<AppState>>>,
    data: String,
    _password: String,
) -> Result<String, String> {
    let app = state.lock().await;
    let parsed: serde_json::Value =
        serde_json::from_str(&data).map_err(|_| "Invalid identity data")?;

    let pub_key = parsed
        .get("identity")
        .and_then(|i| i.get("public_key"))
        .and_then(|v| v.as_str())
        .ok_or("Missing public key")?;
    let priv_key = parsed
        .get("private_key")
        .and_then(|v| v.as_str())
        .ok_or("Missing private key")?;

    let keys_dir = app.data_dir.join("keys");
    let _ = std::fs::create_dir_all(&keys_dir);

    std::fs::write(keys_dir.join("public.key"), pub_key).map_err(|e| e.to_string())?;
    std::fs::write(keys_dir.join("private.key"), priv_key).map_err(|e| e.to_string())?;

    Ok("Identity imported successfully. Restart GrabNet to use it.".into())
}

// ============================================================================
// Config / Settings
// ============================================================================

#[tauri::command]
pub async fn get_config(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<serde_json::Value, String> {
    let app = state.lock().await;
    Ok(serde_json::json!({
        "data_dir": app.data_dir.display().to_string(),
        "scholar_url": app.scholar_url,
        "grabnet_url": app.grabnet_url,
        "scholar_bin": app.scholar_bin.as_ref().map(|p| p.display().to_string()),
        "grabnet_bin": app.grab_bin.as_ref().map(|p| p.display().to_string()),
        "offline_mode": app.offline_mode,
    }))
}

#[tauri::command]
pub async fn set_offline_mode(
    state: State<'_, Arc<Mutex<AppState>>>,
    enabled: bool,
) -> Result<(), String> {
    let mut app = state.lock().await;
    app.offline_mode = enabled;
    Ok(())
}

// ============================================================================
// Helpers
// ============================================================================

fn parse_file_info(v: &serde_json::Value) -> FileInfo {
    FileInfo {
        uuid: v
            .get("uuid")
            .or_else(|| v.get("id"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        title: v
            .get("title")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        filename: v
            .get("filename")
            .or_else(|| v.get("name"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        content_type: v
            .get("content_type")
            .or_else(|| v.get("mime_type"))
            .and_then(|x| x.as_str())
            .unwrap_or("application/octet-stream")
            .to_string(),
        size: v.get("size").and_then(|x| x.as_u64()).unwrap_or(0),
        grabnet_cid: v
            .get("grabnet_cid")
            .or_else(|| v.get("cid"))
            .and_then(|x| x.as_str().map(String::from)),
        created_at: v
            .get("created_at")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        work_type: v
            .get("work_type")
            .and_then(|x| x.as_str().map(String::from)),
    }
}

fn parse_files_array(v: Option<&serde_json::Value>) -> Vec<FileInfo> {
    v.and_then(|arr| arr.as_array())
        .map(|arr| arr.iter().map(parse_file_info).collect())
        .unwrap_or_default()
}

fn chrono_now() -> String {
    // Simple ISO-ish timestamp without pulling in chrono
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", dur.as_secs())
}
