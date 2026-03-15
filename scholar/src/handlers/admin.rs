//! Admin handlers for moderation and system management

use std::sync::Arc;
use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::Json,
    Extension,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::AppState;
use crate::models::User;

/// Admin dashboard statistics
#[derive(Debug, Serialize)]
pub struct AdminStats {
    pub total_users: i64,
    pub total_files: i64,
    pub total_reviews: i64,
    pub total_storage_bytes: i64,
    pub active_sessions: i64,
    pub pending_reports: i64,
    pub recent_registrations: Vec<UserSummary>,
    pub recent_uploads: Vec<FileSummary>,
}

#[derive(Debug, Serialize)]
pub struct UserSummary {
    pub id: i64,
    pub username: String,
    pub email: Option<String>,
    pub created_at: String,
    pub is_admin: bool,
    pub is_moderator: bool,
    pub total_uploads: i64,
    pub reputation_score: i64,
}

#[derive(Debug, Serialize)]
pub struct FileSummary {
    pub uuid: String,
    pub filename: String,
    pub title: Option<String>,
    pub username: String,
    pub content_type: String,
    pub size: i64,
    pub created_at: String,
    pub is_public: bool,
}

/// Check if user is admin (used as extractor)
pub async fn require_admin(
    State(state): State<Arc<AppState>>,
    user: User,
) -> Result<User, (StatusCode, Json<serde_json::Value>)> {
    if !user.is_admin {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Admin access required"
            }))
        ));
    }
    Ok(user)
}

/// Get admin dashboard statistics
pub async fn get_stats(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Verify admin
    if !user.is_admin {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Admin access required" }))
        ));
    }
    
    let stats = state.db.get_admin_stats()
        .map_err(|e| (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() }))
        ))?;
    
    Ok(Json(json!(stats)))
}

/// List all users (with pagination)
#[derive(Debug, Deserialize)]
pub struct ListUsersQuery {
    pub page: Option<i64>,
    pub limit: Option<i64>,
    pub search: Option<String>,
}

pub async fn list_users(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
    axum::extract::Query(query): axum::extract::Query<ListUsersQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if !user.is_admin && !user.is_moderator {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Admin or moderator access required" }))
        ));
    }
    
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    let offset = (page - 1) * limit;
    
    let (users, total) = state.db.list_users_admin(offset, limit, query.search.as_deref())
        .map_err(|e| (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() }))
        ))?;
    
    Ok(Json(json!({
        "users": users,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) / limit
    })))
}

/// Update user role (admin/moderator/verified)
#[derive(Debug, Deserialize)]
pub struct UpdateUserRole {
    pub is_admin: Option<bool>,
    pub is_moderator: Option<bool>,
    pub is_verified: Option<bool>,
}

pub async fn update_user_role(
    State(state): State<Arc<AppState>>,
    Extension(admin): Extension<User>,
    Path(user_id): Path<i64>,
    Json(body): Json<UpdateUserRole>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if !admin.is_admin {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Admin access required" }))
        ));
    }
    
    // Prevent self-demotion
    if user_id == admin.id && body.is_admin == Some(false) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cannot remove your own admin status" }))
        ));
    }
    
    state.db.update_user_role(user_id, body.is_admin, body.is_moderator, body.is_verified)
        .map_err(|e| (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() }))
        ))?;
    
    Ok(Json(json!({
        "success": true,
        "message": "User role updated"
    })))
}

/// Delete a user (admin only)
pub async fn delete_user(
    State(state): State<Arc<AppState>>,
    Extension(admin): Extension<User>,
    Path(user_id): Path<i64>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if !admin.is_admin {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Admin access required" }))
        ));
    }
    
    // Prevent self-deletion
    if user_id == admin.id {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cannot delete yourself" }))
        ));
    }
    
    state.db.delete_user(user_id)
        .map_err(|e| (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() }))
        ))?;
    
    Ok(Json(json!({
        "success": true,
        "message": "User deleted"
    })))
}

/// List all files (admin view)
pub async fn list_files(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
    axum::extract::Query(query): axum::extract::Query<ListUsersQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if !user.is_admin && !user.is_moderator {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Admin or moderator access required" }))
        ));
    }
    
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    let offset = (page - 1) * limit;
    
    let (files, total) = state.db.list_files_admin(offset, limit, query.search.as_deref())
        .map_err(|e| (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() }))
        ))?;
    
    Ok(Json(json!({
        "files": files,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) / limit
    })))
}

/// Delete any file (admin/mod)
pub async fn admin_delete_file(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
    Path(file_uuid): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if !user.is_admin && !user.is_moderator {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Admin or moderator access required" }))
        ));
    }
    
    // Get file info first
    let file = state.db.get_file_by_uuid(&file_uuid)
        .map_err(|e| (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() }))
        ))?
        .ok_or_else(|| (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "File not found" }))
        ))?;
    
    // Delete file from disk
    let file_path = state.content_dir.join(&file.filename);
    if file_path.exists() {
        let _ = std::fs::remove_file(&file_path);
    }
    
    // Delete from GrabNet if it has a CID
    if let Some(cid) = &file.grabnet_cid {
        let _ = state.grabnet.delete_file(cid).await;
    }
    
    // Delete from database
    state.db.delete_file_by_uuid(&file_uuid)
        .map_err(|e| (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() }))
        ))?;
    
    Ok(Json(json!({
        "success": true,
        "message": "File deleted"
    })))
}

/// Get system status
pub async fn system_status(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if !user.is_admin {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Admin access required" }))
        ));
    }
    
    let grabnet_available = state.grabnet.is_available();
    
    // Get disk usage
    let content_size = dir_size(&state.content_dir).unwrap_or(0);
    let data_size = dir_size(&state.data_dir).unwrap_or(0);
    
    Ok(Json(json!({
        "grabnet": {
            "available": grabnet_available,
            "gateway_url": state.grabnet.gateway_url,
        },
        "storage": {
            "content_bytes": content_size,
            "data_bytes": data_size,
            "content_human": format_bytes(content_size),
            "data_human": format_bytes(data_size),
        },
        "paths": {
            "data_dir": state.data_dir.display().to_string(),
            "content_dir": state.content_dir.display().to_string(),
            "static_dir": state.static_dir.display().to_string(),
        }
    })))
}

/// Calculate directory size recursively
fn dir_size(path: &std::path::Path) -> std::io::Result<u64> {
    let mut total = 0;
    if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                total += dir_size(&path)?;
            } else {
                total += entry.metadata()?.len();
            }
        }
    }
    Ok(total)
}

/// Format bytes as human-readable string
fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    
    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}
