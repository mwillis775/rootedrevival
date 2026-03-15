//! File handling - upload, download, streaming

use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio::fs;
use uuid::Uuid;

use crate::models::{NewFile, UploadMetadata};
use crate::AppState;

/// Query params for browse endpoints
#[derive(Debug, Deserialize)]
pub struct BrowseQuery {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub content_type: Option<String>,
    pub tag: Option<String>,
}

/// Search query
#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    pub limit: Option<u32>,
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

/// Upload a file
pub async fn upload(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> impl IntoResponse {
    // Authenticate
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Not authenticated" })),
            )
                .into_response();
        }
    };

    let (_, user) = match state.db.validate_session(&token) {
        Ok(Some(data)) => data,
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Invalid session" })),
            )
                .into_response();
        }
    };

    let mut file_data: Option<Vec<u8>> = None;
    let mut original_filename: Option<String> = None;
    let mut content_type: Option<String> = None;
    let mut metadata = UploadMetadata {
        title: None,
        description: None,
        tags: None,
        is_public: true,
        work_type: None,
    };

    // Process multipart fields
    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();

        match name.as_str() {
            "file" => {
                original_filename = field.file_name().map(|s| s.to_string());
                content_type = field.content_type().map(|s| s.to_string());

                match field.bytes().await {
                    Ok(bytes) => file_data = Some(bytes.to_vec()),
                    Err(e) => {
                        return (
                            StatusCode::BAD_REQUEST,
                            Json(json!({ "error": format!("Failed to read file: {}", e) })),
                        )
                            .into_response();
                    }
                }
            }
            "title" => {
                if let Ok(text) = field.text().await {
                    metadata.title = Some(text);
                }
            }
            "description" => {
                if let Ok(text) = field.text().await {
                    metadata.description = Some(text);
                }
            }
            "tags" => {
                if let Ok(text) = field.text().await {
                    metadata.tags = Some(text.split(',').map(|s| s.trim().to_string()).collect());
                }
            }
            "public" => {
                if let Ok(text) = field.text().await {
                    metadata.is_public = text == "true" || text == "1";
                }
            }
            _ => {}
        }
    }

    let data = match file_data {
        Some(d) => d,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "No file provided" })),
            )
                .into_response();
        }
    };

    let filename = original_filename.unwrap_or_else(|| "unnamed".to_string());
    let content_type = content_type.unwrap_or_else(|| "application/octet-stream".to_string());

    // Generate UUID and hash
    let uuid = Uuid::new_v4().to_string();
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = hex::encode(hasher.finalize());

    // Determine file extension
    let extension = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let stored_filename = if extension.is_empty() {
        uuid.clone()
    } else {
        format!("{}.{}", uuid, extension)
    };

    // Save to disk
    let file_path = state.content_dir.join(&stored_filename);
    if let Err(e) = fs::write(&file_path, &data).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save file: {}", e) })),
        )
            .into_response();
    }

    // Add to GrabNet
    let grabnet_cid = match state.grabnet.add_file(&file_path).await {
        Ok(cid) => Some(cid),
        Err(e) => {
            eprintln!("Warning: Failed to add to GrabNet: {}", e);
            None
        }
    };

    // Create database record
    // Parse work_type before moving metadata fields
    let work_type = metadata.parsed_work_type();

    let new_file = NewFile {
        uuid: uuid.clone(),
        user_id: user.id,
        filename: filename.clone(),
        original_filename: filename,
        content_type: content_type.clone(),
        size: data.len() as i64,
        hash,
        title: metadata.title,
        description: metadata.description,
        is_public: metadata.is_public,
        work_type,
        grabnet_cid,
    };

    match state.db.create_file(new_file, metadata.tags) {
        Ok(file) => {
            // Get URLs
            let local_url = format!("/content/{}", stored_filename);
            let grabnet_url = file
                .grabnet_cid
                .as_ref()
                .map(|cid| state.grabnet.get_file_url(cid));

            (
                StatusCode::CREATED,
                Json(json!({
                    "success": true,
                    "file": {
                        "uuid": file.uuid,
                        "filename": file.filename,
                        "content_type": file.content_type,
                        "size": file.size,
                        "work_type": file.work_type,
                        "review_criteria": file.review_criteria(),
                        "local_url": local_url,
                        "grabnet_url": grabnet_url,
                        "grabnet_cid": file.grabnet_cid,
                    }
                })),
            )
                .into_response()
        }
        Err(e) => {
            // Clean up file on failure
            let _ = std::fs::remove_file(&file_path);

            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to save to database: {}", e) })),
            )
                .into_response()
        }
    }
}

/// Get file metadata
pub async fn get_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> impl IntoResponse {
    match state.db.get_file_by_uuid(&uuid) {
        Ok(Some(file)) => {
            // Check if private
            if !file.is_public {
                let authorized = if let Some(token) = extract_token(&headers) {
                    if let Ok(Some((_, user))) = state.db.validate_session(&token) {
                        user.id == file.user_id
                    } else {
                        false
                    }
                } else {
                    false
                };

                if !authorized {
                    return (
                        StatusCode::FORBIDDEN,
                        Json(json!({ "error": "This file is private" })),
                    );
                }
            }

            let grabnet_url = file
                .grabnet_cid
                .as_ref()
                .map(|cid| state.grabnet.get_file_url(cid));

            (
                StatusCode::OK,
                Json(json!({
                    "file": {
                        "uuid": file.uuid,
                        "filename": file.filename,
                        "content_type": file.content_type,
                        "size": file.size,
                        "title": file.title,
                        "description": file.description,
                        "is_public": file.is_public,
                        "downloads": file.download_count,
                        "views": file.view_count,
                        "grabnet_cid": file.grabnet_cid,
                        "grabnet_url": grabnet_url,
                        "created_at": file.created_at,
                        "updated_at": file.updated_at,
                    }
                })),
            )
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "File not found" })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Update file metadata
pub async fn update_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(updates): Json<serde_json::Value>,
) -> impl IntoResponse {
    // Authenticate
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Not authenticated" })),
            );
        }
    };

    let (_, user) = match state.db.validate_session(&token) {
        Ok(Some(data)) => data,
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Invalid session" })),
            );
        }
    };

    // Get file
    let file = match state.db.get_file_by_uuid(&uuid) {
        Ok(Some(f)) => f,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "File not found" })),
            );
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            );
        }
    };

    // Check ownership
    if file.user_id != user.id {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You don't own this file" })),
        );
    }

    // Update
    let title = updates.get("title").and_then(|v| v.as_str());
    let description = updates.get("description").and_then(|v| v.as_str());
    let is_public = updates.get("is_public").and_then(|v| v.as_bool());

    match state.db.update_file(&uuid, title, description, is_public) {
        Ok(_) => (StatusCode::OK, Json(json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Delete file
pub async fn delete_file(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> impl IntoResponse {
    // Authenticate
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Not authenticated" })),
            );
        }
    };

    let (_, user) = match state.db.validate_session(&token) {
        Ok(Some(data)) => data,
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Invalid session" })),
            );
        }
    };

    // Get file
    let file = match state.db.get_file_by_uuid(&uuid) {
        Ok(Some(f)) => f,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "File not found" })),
            );
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            );
        }
    };

    // Check ownership
    if file.user_id != user.id {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "You don't own this file" })),
        );
    }

    // Delete from GrabNet if present
    if let Some(cid) = &file.grabnet_cid {
        let _ = state.grabnet.delete_file(cid).await;
    }

    // Delete file from disk
    let extension = std::path::Path::new(&file.filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let stored_filename = if extension.is_empty() {
        uuid.clone()
    } else {
        format!("{}.{}", uuid, extension)
    };

    let file_path = state.content_dir.join(&stored_filename);
    let _ = std::fs::remove_file(&file_path);

    // Delete from database
    match state.db.delete_file(&uuid) {
        Ok(_) => (StatusCode::OK, Json(json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Stream file content
pub async fn stream_file(State(state): State<Arc<AppState>>, Path(uuid): Path<String>) -> Response {
    let file = match state.db.get_file_by_uuid(&uuid) {
        Ok(Some(f)) => f,
        _ => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "File not found" })),
            )
                .into_response();
        }
    };

    // Find the actual file
    let extension = std::path::Path::new(&file.filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let stored_filename = if extension.is_empty() {
        uuid.clone()
    } else {
        format!("{}.{}", uuid, extension)
    };

    let file_path = state.content_dir.join(&stored_filename);

    match fs::read(&file_path).await {
        Ok(data) => {
            // Increment view count
            let _ = state.db.increment_view_count(&uuid);

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, &file.content_type)
                .header(header::CONTENT_LENGTH, data.len())
                .body(Body::from(data))
                .unwrap()
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "File not found on disk" })),
        )
            .into_response(),
    }
}

/// Download file with content-disposition
pub async fn download_file(
    State(state): State<Arc<AppState>>,
    Path(uuid): Path<String>,
) -> Response {
    let file = match state.db.get_file_by_uuid(&uuid) {
        Ok(Some(f)) => f,
        _ => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "File not found" })),
            )
                .into_response();
        }
    };

    let extension = std::path::Path::new(&file.filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let stored_filename = if extension.is_empty() {
        uuid.clone()
    } else {
        format!("{}.{}", uuid, extension)
    };

    let file_path = state.content_dir.join(&stored_filename);

    match fs::read(&file_path).await {
        Ok(data) => {
            // Increment download count
            let _ = state.db.increment_download_count(&uuid);

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, &file.content_type)
                .header(header::CONTENT_LENGTH, data.len())
                .header(
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"{}\"", file.original_filename),
                )
                .body(Body::from(data))
                .unwrap()
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "File not found on disk" })),
        )
            .into_response(),
    }
}

/// Browse recent files
pub async fn browse_recent(
    State(state): State<Arc<AppState>>,
    Query(query): Query<BrowseQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(20);
    let offset = query.offset.unwrap_or(0);

    match state.db.get_recent_files(limit, offset) {
        Ok(files) => (StatusCode::OK, Json(json!({ "files": files }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Browse by content type
pub async fn browse_by_type(
    State(state): State<Arc<AppState>>,
    Path(content_type): Path<String>,
    Query(query): Query<BrowseQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(20);
    let offset = query.offset.unwrap_or(0);

    // Convert shorthand to actual content type
    let actual_type = match content_type.as_str() {
        "pdf" | "pdfs" => "application/pdf",
        "images" | "image" => "image/%",
        "videos" | "video" => "video/%",
        "audio" => "audio/%",
        "documents" | "docs" => "application/%",
        "text" => "text/%",
        other => other,
    };

    match state.db.get_files_by_type(actual_type, limit, offset) {
        Ok(files) => (StatusCode::OK, Json(json!({ "files": files }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Search files
pub async fn search_files(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(50);

    match state.db.search_files(&query.q, limit) {
        Ok(files) => (
            StatusCode::OK,
            Json(json!({ "files": files, "query": query.q })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Get files needing review
pub async fn needs_review(
    State(state): State<Arc<AppState>>,
    Query(query): Query<BrowseQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(20);
    let offset = query.offset.unwrap_or(0);

    match state.db.get_files_needing_review(limit, offset) {
        Ok(files) => (StatusCode::OK, Json(json!({ "files": files }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Get popular tags
pub async fn get_tags(
    State(state): State<Arc<AppState>>,
    Query(query): Query<BrowseQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(50);

    match state.db.get_popular_tags(limit) {
        Ok(tags) => (StatusCode::OK, Json(json!({ "tags": tags }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Get files by tag
pub async fn browse_by_tag(
    State(state): State<Arc<AppState>>,
    Path(tag): Path<String>,
    Query(query): Query<BrowseQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(20);
    let offset = query.offset.unwrap_or(0);

    match state.db.get_files_by_tag(&tag, limit, offset) {
        Ok(files) => (StatusCode::OK, Json(json!({ "files": files, "tag": tag }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}
