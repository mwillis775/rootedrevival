//! Moderation handlers for reports, bans, and content flags

use std::sync::Arc;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    Extension,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::AppState;
use crate::models::User;
use crate::moderation::{
    self, ReportReason, ReportTarget, ReportStatus, BanType, ContentFlag,
};

/// Report submission request
#[derive(Debug, Deserialize)]
pub struct CreateReportRequest {
    pub target_type: String,
    pub target_id: String,
    pub reason: String,
    pub description: Option<String>,
}

/// Response for report creation
#[derive(Debug, Serialize)]
pub struct ReportResponse {
    pub id: i64,
    pub status: String,
    pub message: String,
}

/// Ban user request
#[derive(Debug, Deserialize)]
pub struct BanUserRequest {
    pub user_id: i64,
    pub ban_type: String,
    pub reason: String,
    pub expires_at: Option<String>,
}

/// Flag content request
#[derive(Debug, Deserialize)]
pub struct FlagContentRequest {
    pub file_uuid: String,
    pub flag_type: String,
    pub note: Option<String>,
}

/// Review action request
#[derive(Debug, Deserialize)]
pub struct ReviewReportRequest {
    pub action: String, // "approve", "dismiss", "resolve"
    pub notes: Option<String>,
}

/// Submit a report
pub async fn create_report(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
    Json(req): Json<CreateReportRequest>,
) -> Result<Json<ReportResponse>, (StatusCode, Json<Value>)> {
    // Parse target type
    let target_type = match req.target_type.to_lowercase().as_str() {
        "file" => ReportTarget::File(req.target_id.clone()),
        "user" => {
            let user_id = req.target_id.parse::<i64>()
                .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid user ID"}))))?;
            ReportTarget::User(user_id)
        }
        "review" => {
            let review_id = req.target_id.parse::<i64>()
                .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid review ID"}))))?;
            ReportTarget::Review(review_id)
        }
        "comment" => {
            let comment_id = req.target_id.parse::<i64>()
                .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid comment ID"}))))?;
            ReportTarget::Comment(comment_id)
        }
        _ => return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid target type"})))),
    };

    // Parse reason
    let reason = match req.reason.to_lowercase().as_str() {
        "spam" => ReportReason::Spam,
        "harassment" => ReportReason::Harassment,
        "plagiarism" => ReportReason::Plagiarism,
        "misinformation" => ReportReason::Misinformation,
        "copyright" => ReportReason::CopyrightViolation,
        "inappropriate" => ReportReason::InappropriateContent,
        "other" => ReportReason::Other,
        _ => return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid reason"})))),
    };

    // Create the report
    let report_id = moderation::create_report(
        &*state.db.conn(),
        user.id,
        target_type,
        reason,
        req.description.as_deref(),
    ).map_err(|e| {
        tracing::error!("Failed to create report: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to create report"})))
    })?;

    Ok(Json(ReportResponse {
        id: report_id,
        status: "pending".into(),
        message: "Report submitted successfully".into(),
    }))
}

/// Get pending reports (admin only)
pub async fn get_pending_reports(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if user.role != "admin" {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Admin access required"}))));
    }

    let reports = moderation::get_pending_reports(&*state.db.conn(), 100)
        .map_err(|e| {
            tracing::error!("Failed to get reports: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to get reports"})))
        })?;

    Ok(Json(json!({ "reports": reports })))
}

/// Review a report (admin only)
pub async fn review_report(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
    Path(report_id): Path<i64>,
    Json(req): Json<ReviewReportRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if user.role != "admin" {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Admin access required"}))));
    }

    let status = match req.action.to_lowercase().as_str() {
        "approve" | "resolve" => ReportStatus::Resolved,
        "dismiss" => ReportStatus::Dismissed,
        _ => return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid action"})))),
    };

    moderation::update_report_status(&*state.db.conn(), report_id, status, Some(user.id), req.notes.as_deref())
        .map_err(|e| {
            tracing::error!("Failed to update report: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update report"})))
        })?;

    Ok(Json(json!({"success": true, "message": "Report updated"})))
}

/// Ban a user (admin only)
pub async fn ban_user(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
    Json(req): Json<BanUserRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if user.role != "admin" {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Admin access required"}))));
    }

    let ban_type = match req.ban_type.to_lowercase().as_str() {
        "temporary" => BanType::Temporary,
        "permanent" => BanType::Permanent,
        "suspended" => BanType::Suspended,
        "shadow" => BanType::ShadowBan,
        _ => return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid ban type"})))),
    };

    let expires_at = req.expires_at.as_deref();

    moderation::ban_user(&*state.db.conn(), req.user_id, ban_type, &req.reason, user.id, expires_at)
        .map_err(|e| {
            tracing::error!("Failed to ban user: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to ban user"})))
        })?;

    Ok(Json(json!({"success": true, "message": "User banned"})))
}

/// Unban a user (admin only)
pub async fn unban_user(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
    Path(user_id): Path<i64>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if user.role != "admin" {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Admin access required"}))));
    }

    moderation::unban_user(&*state.db.conn(), user_id)
        .map_err(|e| {
            tracing::error!("Failed to unban user: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to unban user"})))
        })?;

    Ok(Json(json!({"success": true, "message": "User unbanned"})))
}

/// Get active bans (admin only)
pub async fn get_active_bans(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if user.role != "admin" {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Admin access required"}))));
    }

    let bans = moderation::get_active_bans(&*state.db.conn())
        .map_err(|e| {
            tracing::error!("Failed to get bans: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to get bans"})))
        })?;

    Ok(Json(json!({ "bans": bans })))
}

/// Flag content (admin only)
pub async fn flag_content(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
    Json(req): Json<FlagContentRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if user.role != "admin" && user.role != "moderator" {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Moderator access required"}))));
    }

    moderation::flag_content(&*state.db.conn(), &req.file_uuid, &req.flag_type, user.id, req.note.as_deref())
        .map_err(|e| {
            tracing::error!("Failed to flag content: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to flag content"})))
        })?;

    Ok(Json(json!({"success": true, "message": "Content flagged"})))
}

/// Remove content flag (admin only)
pub async fn unflag_content(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
    Path(file_uuid): Path<String>,
    Json(req): Json<serde_json::Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if user.role != "admin" && user.role != "moderator" {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Moderator access required"}))));
    }

    let flag_type = req.get("flag_type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "flag_type required"}))))?;

    moderation::remove_flag(&*state.db.conn(), &file_uuid, flag_type)
        .map_err(|e| {
            tracing::error!("Failed to remove flag: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to remove flag"})))
        })?;

    Ok(Json(json!({"success": true, "message": "Flag removed"})))
}

/// Get content flags (admin only)
pub async fn get_flagged_content(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if user.role != "admin" && user.role != "moderator" {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Moderator access required"}))));
    }

    let flags = moderation::get_flagged_content(&*state.db.conn())
        .map_err(|e| {
            tracing::error!("Failed to get flags: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to get flagged content"})))
        })?;

    Ok(Json(json!({ "flags": flags })))
}

/// Get moderation log (admin only)
pub async fn get_moderation_log(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if user.role != "admin" {
        return Err((StatusCode::FORBIDDEN, Json(json!({"error": "Admin access required"}))));
    }

    let limit = params.get("limit")
        .and_then(|l| l.parse().ok())
        .unwrap_or(100);

    let log = moderation::get_moderation_log(&*state.db.conn(), limit)
        .map_err(|e| {
            tracing::error!("Failed to get moderation log: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to get moderation log"})))
        })?;

    Ok(Json(json!({ "log": log })))
}

/// Check if user is banned (middleware helper)
pub async fn check_user_ban(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<User>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let is_banned = moderation::is_user_banned(&*state.db.conn(), user.id)
        .map_err(|e| {
            tracing::error!("Failed to check ban status: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to check ban status"})))
        })?;

    Ok(Json(json!({
        "banned": is_banned,
        "user_id": user.id
    })))
}
