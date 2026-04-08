//! Tauri commands — the IPC bridge between the frontend and Rust backend.
//!
//! RULE: Never hold the AppState mutex during HTTP requests or sleeps.
//! Extract values into locals, drop the lock, then perform I/O.

use crate::state::{AppState, Settings, UserInfo};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

// Using State directly with full type in each fn signature to avoid lifetime issues.

// ─── Helpers ───────────────────────────────────────────────

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .danger_accept_invalid_certs(false)
        .build()
        .unwrap_or_default()
}

fn quick_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(3000))
        .build()
        .unwrap_or_default()
}

// ─── Auth ──────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct LoginRequest {
    pub server_url: String,
    pub username: String,
    pub password: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct LoginResponse {
    pub success: bool,
    pub token: Option<String>,
    pub user: Option<UserInfo>,
    pub error: Option<String>,
}

#[derive(serde::Serialize)]
pub struct AuthState {
    pub logged_in: bool,
    pub user: Option<UserInfo>,
    pub server_url: String,
}

/// Login to the Rooted Revival server.
#[tauri::command]
pub async fn login(state: State<'_, Arc<Mutex<AppState>>>, request: LoginRequest) -> Result<LoginResponse, String> {
    let client = http_client();
    let url = format!("{}/api/auth/login", request.server_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "username": request.username,
            "password": request.password,
        }))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    let status = resp.status();
    let raw = resp.text().await.map_err(|e| format!("Failed to read response: {e}"))?;

    if !status.is_success() {
        // Try to parse as JSON for error message, fall back to status code
        let msg = serde_json::from_str::<serde_json::Value>(&raw)
            .ok()
            .and_then(|v| v["error"].as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| format!("Server returned {status}"));
        return Ok(LoginResponse {
            success: false,
            token: None,
            user: None,
            error: Some(msg),
        });
    }

    let body: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid JSON from server: {e}"))?;

    let token = body["token"].as_str().map(|s| s.to_string());
    let user: Option<UserInfo> = serde_json::from_value(body["user"].clone()).ok();

    // Store in state
    {
        let mut app = state.lock().await;
        app.token = token.clone();
        app.user = user.clone();
        app.settings.server_url = request.server_url;
        app.save_settings();
        app.save_token();
    }

    Ok(LoginResponse {
        success: true,
        token,
        user,
        error: None,
    })
}

/// Logout — clear local session.
#[tauri::command]
pub async fn logout(state: State<'_, Arc<Mutex<AppState>>>) -> Result<(), String> {
    let (token, server_url) = {
        let app = state.lock().await;
        (app.token.clone(), app.settings.server_url.clone())
    };

    // Try to invalidate server-side session
    if let Some(ref t) = token {
        let client = quick_client();
        let _ = client
            .post(format!("{}/api/auth/logout", server_url))
            .bearer_auth(t)
            .send()
            .await;
    }

    let mut app = state.lock().await;
    app.token = None;
    app.user = None;
    app.save_token();
    Ok(())
}

/// Check if we have a valid session (validate stored token).
#[tauri::command]
pub async fn check_auth(state: State<'_, Arc<Mutex<AppState>>>) -> Result<AuthState, String> {
    let (token, server_url) = {
        let app = state.lock().await;
        (app.token.clone(), app.settings.server_url.clone())
    };

    if let Some(ref t) = token {
        let client = http_client();
        let resp = client
            .get(format!("{}/api/auth/me", server_url))
            .bearer_auth(t)
            .send()
            .await;

        match resp {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    if let Some(user_val) = body.get("user") {
                        if !user_val.is_null() {
                            let user: Option<UserInfo> =
                                serde_json::from_value(user_val.clone()).ok();
                            if let Some(ref u) = user {
                                let mut app = state.lock().await;
                                app.user = Some(u.clone());
                                return Ok(AuthState {
                                    logged_in: true,
                                    user: Some(u.clone()),
                                    server_url,
                                });
                            }
                        }
                    }
                }
                // Parsed OK but no user — token invalid, clear it
                let mut app = state.lock().await;
                app.token = None;
                app.user = None;
                app.save_token();
            }
            Ok(resp) if resp.status() == reqwest::StatusCode::UNAUTHORIZED => {
                // Explicit 401 — token is definitely invalid
                let mut app = state.lock().await;
                app.token = None;
                app.user = None;
                app.save_token();
            }
            _ => {
                // Network error or non-401 failure — keep the token, try again later
                return Ok(AuthState {
                    logged_in: false,
                    user: None,
                    server_url,
                });
            }
        }
    }

    Ok(AuthState {
        logged_in: false,
        user: None,
        server_url,
    })
}

// ─── Archive Browsing ──────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ArchiveFile {
    #[serde(default)]
    pub uuid: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, alias = "paper_type")]
    pub file_type: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default, alias = "mime_type")]
    pub content_type: String,
    #[serde(default, alias = "file_size")]
    pub size: u64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub uploader_name: String,
    #[serde(default)]
    pub view_count: u64,
    #[serde(default)]
    pub download_count: u64,
    #[serde(default, alias = "abstract")]
    pub description: String,
}

/// Browse recent files from the archive.
#[tauri::command]
pub async fn browse_archive(
    state: State<'_, Arc<Mutex<AppState>>>,
    page: Option<u32>,
    file_type: Option<String>,
) -> Result<serde_json::Value, String> {
    let (token, server_url) = {
        let app = state.lock().await;
        (app.token.clone(), app.settings.server_url.clone())
    };

    let client = http_client();
    let page_num = page.unwrap_or(1);
    let offset = (page_num.saturating_sub(1)) * 20;
    let url = if let Some(ref ft) = file_type {
        format!("{}/api/papers?type={}&limit=20&offset={}", server_url, ft, offset)
    } else {
        format!("{}/api/papers/recent?limit=20", server_url)
    };

    let mut req = client.get(&url);
    if let Some(ref t) = token {
        req = req.bearer_auth(t);
    }

    let resp = req.send().await.map_err(|e| format!("Request failed: {e}"))?;
    let body: serde_json::Value = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
    Ok(body)
}

/// Search the archive.
#[tauri::command]
pub async fn search_archive(
    state: State<'_, Arc<Mutex<AppState>>>,
    query: String,
    file_type: Option<String>,
) -> Result<serde_json::Value, String> {
    let (token, server_url) = {
        let app = state.lock().await;
        (app.token.clone(), app.settings.server_url.clone())
    };

    let client = http_client();
    let mut url = format!("{}/api/papers?q={}", server_url, urlencoding::encode(&query));
    if let Some(ref ft) = file_type {
        url.push_str(&format!("&type={}", urlencoding::encode(ft)));
    }

    let mut req = client.get(&url);
    if let Some(ref t) = token {
        req = req.bearer_auth(t);
    }

    let resp = req.send().await.map_err(|e| format!("Request failed: {e}"))?;
    let body: serde_json::Value = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
    Ok(body)
}

/// Get details for a single file.
#[tauri::command]
pub async fn get_file_detail(
    state: State<'_, Arc<Mutex<AppState>>>,
    uuid: String,
) -> Result<serde_json::Value, String> {
    let (token, server_url) = {
        let app = state.lock().await;
        (app.token.clone(), app.settings.server_url.clone())
    };

    let client = http_client();
    let mut req = client.get(format!("{}/api/papers/{}", server_url, uuid));
    if let Some(ref t) = token {
        req = req.bearer_auth(t);
    }

    let resp = req.send().await.map_err(|e| format!("Request failed: {e}"))?;
    let body: serde_json::Value = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
    // Flatten: return the paper object directly if nested
    if let Some(paper) = body.get("paper") {
        Ok(paper.clone())
    } else {
        Ok(body)
    }
}

/// Download a file from the archive to local disk.
#[tauri::command]
pub async fn download_file(
    state: State<'_, Arc<Mutex<AppState>>>,
    uuid: String,
    destination: String,
) -> Result<String, String> {
    let (token, server_url) = {
        let app = state.lock().await;
        (app.token.clone(), app.settings.server_url.clone())
    };

    // For papers, uuid is the paper uuid — resolve primary file ID first
    let client = http_client();
    let mut detail_req = client.get(format!("{}/api/papers/{}", server_url, uuid));
    if let Some(ref t) = token {
        detail_req = detail_req.bearer_auth(t);
    }
    let detail_resp = detail_req.send().await.map_err(|e| format!("Detail fetch failed: {e}"))?;
    let detail: serde_json::Value = detail_resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
    let file_id = detail.get("paper")
        .and_then(|p| p.get("primaryFileId"))
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "No downloadable file found for this paper".to_string())?;

    let mut req = client.get(format!("{}/api/files/{}/download", server_url, file_id));
    if let Some(ref t) = token {
        req = req.bearer_auth(t);
    }

    let resp = req.send().await.map_err(|e| format!("Download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Server returned {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| format!("Read error: {e}"))?;
    tokio::fs::write(&destination, &bytes)
        .await
        .map_err(|e| format!("Write error: {e}"))?;

    Ok(destination)
}

/// Get available tags.
#[tauri::command]
pub async fn get_tags(state: State<'_, Arc<Mutex<AppState>>>) -> Result<serde_json::Value, String> {
    let server_url = {
        let app = state.lock().await;
        app.settings.server_url.clone()
    };

    let client = quick_client();
    let resp = client.get(format!("{}/api/tags", server_url)).send().await;
    match resp {
        Ok(r) => r.json().await.map_err(|e| e.to_string()),
        Err(e) => Err(e.to_string()),
    }
}

// ─── User Content ──────────────────────────────────────────

/// Get logged-in user's uploaded files.
#[tauri::command]
pub async fn get_my_files(state: State<'_, Arc<Mutex<AppState>>>) -> Result<serde_json::Value, String> {
    let (token, server_url) = {
        let app = state.lock().await;
        (app.token.clone(), app.settings.server_url.clone())
    };

    let token: String = token.ok_or_else(|| "Not logged in".to_string())?;
    let client = http_client();
    let resp = client
        .get(format!("{}/api/me/papers", server_url))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    resp.json().await.map_err(|e| e.to_string())
}

// ─── GrabNet Node ──────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct NodeStatus {
    pub grabnet_running: bool,
    pub grabnet_available: bool,
    pub grab_bin_found: bool,
    pub peer_id: Option<String>,
    pub hosted_sites: Vec<String>,
    pub pinning_archive: bool,
}

/// Get current node/GrabNet status.
#[tauri::command]
pub async fn get_node_status(state: State<'_, Arc<Mutex<AppState>>>) -> Result<NodeStatus, String> {
    let (has_process, grab_bin, gw_url) = {
        let app = state.lock().await;
        (
            app.grabnet_process.is_some(),
            app.grab_bin.clone(),
            app.grabnet_url.clone(),
        )
    };

    let client = quick_client();

    // Check gateway health and get status via HTTP API (avoids sled lock)
    let mut hosted: Vec<String> = Vec::new();
    let mut peer_id: Option<String> = None;
    let mut gw_alive = false;

    // GET /api/sites — returns { published: [...], hosted: [...] }
    if let Ok(resp) = client.get(format!("{}/api/sites", gw_url)).send().await {
        if resp.status().is_success() {
            gw_alive = true;
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                if let Some(arr) = body["hosted"].as_array() {
                    for item in arr {
                        if let Some(name) = item["name"].as_str() {
                            hosted.push(name.to_string());
                        }
                    }
                }
            }
        }
    }

    // GET /api/network — returns { peer_id, running, ... }
    if gw_alive {
        if let Ok(resp) = client.get(format!("{}/api/network", gw_url)).send().await {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                if let Some(pid) = body["peer_id"].as_str() {
                    peer_id = Some(pid.to_string());
                }
            }
        }
    }

    let pinning_archive = hosted.iter().any(|s| s.contains("rootedrevival"));

    Ok(NodeStatus {
        grabnet_running: has_process || gw_alive,
        grabnet_available: gw_alive,
        grab_bin_found: grab_bin.is_some(),
        peer_id,
        hosted_sites: hosted,
        pinning_archive,
    })
}

/// Start GrabNet node — detect existing gateway or launch one.
#[tauri::command]
pub async fn start_node(state: State<'_, Arc<Mutex<AppState>>>) -> Result<String, String> {
    let (grab_bin, _data_dir, already_running, gw_url) = {
        let app = state.lock().await;
        (
            app.grab_bin.clone(),
            app.settings.data_dir.clone(),
            app.grabnet_process.is_some(),
            app.grabnet_url.clone(),
        )
    };

    // Check if gateway is already reachable (e.g. systemd service)
    let client = quick_client();
    let gw_alive = client.get(format!("{}/health", gw_url)).send().await.is_ok();

    if gw_alive {
        // Gateway already running — no need to start another
        return Ok("GrabNet gateway already running".into());
    }

    if already_running {
        return Ok("Already running".into());
    }

    let bin = grab_bin.ok_or_else(|| "GrabNet binary not found. Install grab to participate in the network.".to_string())?;

    // Start gateway in background
    let child = tokio::process::Command::new(&bin)
        .args([
            "gateway",
            "--port", "8888",
            "--default-site", "rootedrevival",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start GrabNet: {e}"))?;

    {
        let mut app = state.lock().await;
        app.grabnet_process = Some(child);
    }

    // Wait for startup
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    Ok("GrabNet started".into())
}

/// Stop our GrabNet node (only if we started it).
#[tauri::command]
pub async fn stop_node(state: State<'_, Arc<Mutex<AppState>>>) -> Result<(), String> {
    {
        let mut app = state.lock().await;
        if let Some(ref mut child) = app.grabnet_process {
            let _ = child.kill().await.ok();
        }
        app.grabnet_process = None;
    }
    Ok(())
}

/// Pin a specific site via the running gateway's admin API.
#[tauri::command]
pub async fn pin_site(state: State<'_, Arc<Mutex<AppState>>>, site_name: String) -> Result<String, String> {
    let gw_url = {
        let app = state.lock().await;
        app.grabnet_url.clone()
    };

    let client = http_client();
    let resp = client
        .post(format!("{}/api/admin/host", gw_url))
        .json(&serde_json::json!({ "site": site_name }))
        .send()
        .await
        .map_err(|e| format!("Gateway request failed: {e}"))?;

    if resp.status().is_success() {
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let name = body["name"].as_str().unwrap_or(&site_name);
        Ok(format!("Pinned {name}"))
    } else {
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let err = body["error"].as_str().unwrap_or("Pin failed");
        Err(format!("Pin failed: {err}"))
    }
}

// ─── Heartbeat ─────────────────────────────────────────────

/// Send a heartbeat to the server (called periodically by the frontend).
#[tauri::command]
pub async fn send_heartbeat(state: State<'_, Arc<Mutex<AppState>>>) -> Result<(), String> {
    let (token, server_url, gw_url) = {
        let app = state.lock().await;
        (
            app.token.clone(),
            app.settings.server_url.clone(),
            app.grabnet_url.clone(),
        )
    };

    let token = match token {
        Some(t) => t,
        None => return Ok(()), // Not logged in, skip
    };

    // Gather node info from gateway HTTP API (not CLI — avoids sled lock)
    let client = quick_client();
    let mut peer_id: Option<String> = None;
    let mut hosted_count: u32 = 0;
    let mut gw_alive = false;

    // GET /api/sites
    if let Ok(resp) = client.get(format!("{}/api/sites", gw_url)).send().await {
        if resp.status().is_success() {
            gw_alive = true;
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                if let Some(arr) = body["hosted"].as_array() {
                    hosted_count = arr.len() as u32;
                }
            }
        }
    }

    // GET /api/network
    if gw_alive {
        if let Ok(resp) = client.get(format!("{}/api/network", gw_url)).send().await {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                if let Some(pid) = body["peer_id"].as_str() {
                    peer_id = Some(pid.to_string());
                }
            }
        }
    }

    // Send heartbeat to server (use http_client for longer timeout through Cloudflare)
    let server_client = http_client();
    let _ = server_client
        .post(format!("{}/api/me/node/heartbeat", server_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "peer_id": peer_id,
            "version": env!("CARGO_PKG_VERSION"),
            "grabnet_running": gw_alive,
            "content_pinned": hosted_count,
            "bytes_hosted": 0,
        }))
        .send()
        .await;

    Ok(())
}

// ─── Settings ──────────────────────────────────────────────

#[tauri::command]
pub async fn get_settings(state: State<'_, Arc<Mutex<AppState>>>) -> Result<Settings, String> {
    let app = state.lock().await;
    Ok(app.settings.clone())
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, Arc<Mutex<AppState>>>,
    server_url: Option<String>,
    auto_pin: Option<bool>,
) -> Result<Settings, String> {
    let mut app = state.lock().await;
    if let Some(url) = server_url {
        app.settings.server_url = url;
    }
    if let Some(ap) = auto_pin {
        app.settings.auto_pin = ap;
    }
    app.save_settings();
    Ok(app.settings.clone())
}

// ─── System Info ───────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct SystemInfo {
    pub version: String,
    pub grab_bin: Option<String>,
    pub data_dir: String,
    pub os: String,
}

#[tauri::command]
pub async fn get_system_info(state: State<'_, Arc<Mutex<AppState>>>) -> Result<SystemInfo, String> {
    let app = state.lock().await;
    Ok(SystemInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        grab_bin: app.grab_bin.as_ref().map(|p: &std::path::PathBuf| p.to_string_lossy().into_owned()),
        data_dir: app.settings.data_dir.clone(),
        os: std::env::consts::OS.to_string(),
    })
}
