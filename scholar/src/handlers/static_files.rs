//! Static file serving and site publishing

use std::sync::Arc;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Json, Response},
    routing::get,
    Router,
};
use serde_json::json;
use tokio::fs;

use crate::AppState;

/// Create static file routes
pub fn static_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(index))
        .route("/static/*path", get(static_file))
        .route("/content/*filename", get(content_file))
}

/// Extract session token from headers
fn extract_token(headers: &HeaderMap) -> Option<String> {
    if let Some(auth) = headers.get(header::AUTHORIZATION) {
        if let Ok(value) = auth.to_str() {
            if value.starts_with("Bearer ") {
                return Some(value[7..].to_string());
            }
        }
    }
    
    if let Some(cookie) = headers.get(header::COOKIE) {
        if let Ok(value) = cookie.to_str() {
            for part in value.split(';') {
                let part = part.trim();
                if part.starts_with("session=") {
                    return Some(part[8..].to_string());
                }
            }
        }
    }
    
    None
}

/// Serve the main index.html
pub async fn index(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let index_path = state.static_dir.join("index.html");
    
    match fs::read_to_string(&index_path).await {
        Ok(content) => Html(content).into_response(),
        Err(_) => {
            // Fallback to embedded minimal HTML
            Html(r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Open Scholar</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container { text-align: center; padding: 2rem; }
        h1 { font-size: 3rem; margin-bottom: 1rem; }
        h1 span { color: #00d9ff; }
        p { color: #aaa; margin-bottom: 2rem; }
        .status { 
            background: rgba(255,255,255,0.1); 
            padding: 1rem 2rem; 
            border-radius: 8px;
            display: inline-block;
        }
        .status.ok { border-left: 4px solid #00ff88; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📚 Open <span>Scholar</span></h1>
        <p>Decentralized academic publishing on GrabNet</p>
        <div class="status ok">
            ✓ Server Running | <a href="/api/status" style="color: #00d9ff;">API Status</a>
        </div>
    </div>
</body>
</html>"#).into_response()
        }
    }
}

/// Serve static files (CSS, JS, images)
pub async fn static_file(
    State(state): State<Arc<AppState>>,
    Path(path): Path<String>,
) -> Response {
    // Sanitize path to prevent directory traversal
    let clean_path = path
        .replace("..", "")
        .trim_start_matches('/')
        .to_string();
    
    let file_path = state.static_dir.join(&clean_path);
    
    // Check if file exists and is within static_dir
    if !file_path.starts_with(&state.static_dir) {
        return (StatusCode::FORBIDDEN, "Access denied").into_response();
    }
    
    match fs::read(&file_path).await {
        Ok(content) => {
            // Determine content type
            let content_type = match file_path.extension().and_then(|e| e.to_str()) {
                Some("html") => "text/html; charset=utf-8",
                Some("css") => "text/css; charset=utf-8",
                Some("js") => "application/javascript; charset=utf-8",
                Some("json") => "application/json; charset=utf-8",
                Some("png") => "image/png",
                Some("jpg") | Some("jpeg") => "image/jpeg",
                Some("gif") => "image/gif",
                Some("svg") => "image/svg+xml",
                Some("ico") => "image/x-icon",
                Some("woff") => "font/woff",
                Some("woff2") => "font/woff2",
                Some("ttf") => "font/ttf",
                Some("eot") => "application/vnd.ms-fontobject",
                _ => "application/octet-stream",
            };
            
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CACHE_CONTROL, "public, max-age=3600")
                .body(Body::from(content))
                .unwrap()
        }
        Err(_) => (StatusCode::NOT_FOUND, "File not found").into_response(),
    }
}

/// Serve content files (user uploads)
pub async fn content_file(
    State(state): State<Arc<AppState>>,
    Path(filename): Path<String>,
) -> Response {
    // Sanitize filename
    let clean_filename = filename
        .replace("..", "")
        .trim_start_matches('/')
        .to_string();
    
    let file_path = state.content_dir.join(&clean_filename);
    
    // Check bounds
    if !file_path.starts_with(&state.content_dir) {
        return (StatusCode::FORBIDDEN, "Access denied").into_response();
    }
    
    match fs::read(&file_path).await {
        Ok(content) => {
            // Try to determine content type from extension
            let content_type = match file_path.extension().and_then(|e| e.to_str()) {
                Some("pdf") => "application/pdf",
                Some("html") => "text/html; charset=utf-8",
                Some("txt") => "text/plain; charset=utf-8",
                Some("md") => "text/markdown; charset=utf-8",
                Some("png") => "image/png",
                Some("jpg") | Some("jpeg") => "image/jpeg",
                Some("gif") => "image/gif",
                Some("svg") => "image/svg+xml",
                Some("mp4") => "video/mp4",
                Some("webm") => "video/webm",
                Some("mp3") => "audio/mpeg",
                Some("ogg") => "audio/ogg",
                Some("wav") => "audio/wav",
                Some("zip") => "application/zip",
                Some("tar") => "application/x-tar",
                Some("gz") => "application/gzip",
                Some("json") => "application/json",
                Some("xml") => "application/xml",
                Some("csv") => "text/csv",
                _ => "application/octet-stream",
            };
            
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CONTENT_LENGTH, content.len())
                .body(Body::from(content))
                .unwrap()
        }
        Err(_) => (StatusCode::NOT_FOUND, "File not found").into_response(),
    }
}

/// Publish site to GrabNet
pub async fn publish_site(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // This requires authentication
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Not authenticated" })),
            );
        }
    };
    
    // Validate session
    match state.db.validate_session(&token) {
        Ok(Some(_)) => {}
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Invalid session" })),
            );
        }
    }
    
    // Publish to GrabNet
    match state.grabnet.publish_site(&state.static_dir).await {
        Ok(result) => {
            let site_url = state.grabnet.get_site_url(&result.site_id);
            
            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "site_id": result.site_id,
                    "revision": result.revision,
                    "url": site_url,
                })),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to publish: {}", e) })),
        ),
    }
}

/// Get site status
pub async fn site_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let grabnet_available = state.grabnet.is_available();
    
    (
        StatusCode::OK,
        Json(json!({
            "grabnet_available": grabnet_available,
            "static_dir": state.static_dir.to_string_lossy(),
            "content_dir": state.content_dir.to_string_lossy(),
        })),
    )
}
