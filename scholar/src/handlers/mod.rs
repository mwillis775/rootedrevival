//! HTTP request handlers

mod admin;
mod auth;
mod files;
mod moderation;
mod reviews;
mod static_files;

use std::sync::Arc;
use axum::{
    routing::{get, post, put, delete},
    Router,
    extract::State,
    response::Json,
};
use serde_json::json;

use crate::AppState;
use crate::middleware;

pub use static_files::static_routes;

/// Create API routes
pub fn api_routes() -> Router<Arc<AppState>> {
    Router::new()
        // Health check
        .route("/health", get(health))
        .route("/status", get(status))
        
        // CSRF token
        .route("/csrf-token", get(middleware::get_csrf_token))
        
        // Tor status
        .route("/tor", get(tor_status))
        
        // GrabNet status
        .route("/grabnet", get(grabnet_status))
        
        // Work types (protocol-level types with review criteria)
        .route("/work-types", get(get_work_types))
        .route("/work-types/:work_type", get(get_work_type_info))
        
        // Authentication
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        
        // Password reset
        .route("/auth/forgot-password", post(auth::forgot_password))
        .route("/auth/reset-password", post(auth::reset_password))
        .route("/auth/verify-email", post(auth::verify_email))
        .route("/auth/resend-verification", post(auth::resend_verification))
        
        // User profiles
        .route("/profiles/:username", get(auth::get_profile))
        .route("/profiles/me", put(auth::update_profile))
        
        // Files
        .route("/files", post(files::upload))
        .route("/files/:uuid", get(files::get_file))
        .route("/files/:uuid", put(files::update_file))
        .route("/files/:uuid", delete(files::delete_file))
        .route("/files/:uuid/stream", get(files::stream_file))
        .route("/files/:uuid/download", get(files::download_file))
        
        // Browsing
        .route("/browse/recent", get(files::browse_recent))
        .route("/browse/type/:content_type", get(files::browse_by_type))
        .route("/browse/tag/:tag", get(files::browse_by_tag))
        .route("/browse/search", get(files::search_files))
        .route("/browse/needs-review", get(files::needs_review))
        .route("/tags", get(files::get_tags))
        
        // Reviews
        .route("/files/:file_uuid/reviews", get(reviews::get_reviews))
        .route("/files/:file_uuid/reviews", post(reviews::create_review))
        .route("/files/:file_uuid/reviews/:review_id/vote", post(reviews::vote_review))
        .route("/reviews/recent", get(reviews::recent_reviews))
        
        // Site management
        .route("/site/publish", post(static_files::publish_site))
        .route("/site/status", get(static_files::site_status))
        
        // User reports (authenticated)
        .route("/reports", post(moderation::create_report))
        
        // Moderation routes (admin/moderator only)
        .route("/moderation/reports", get(moderation::get_pending_reports))
        .route("/moderation/reports/:report_id", put(moderation::review_report))
        .route("/moderation/bans", get(moderation::get_active_bans))
        .route("/moderation/bans", post(moderation::ban_user))
        .route("/moderation/bans/:user_id", delete(moderation::unban_user))
        .route("/moderation/flags", get(moderation::get_flagged_content))
        .route("/moderation/flags", post(moderation::flag_content))
        .route("/moderation/flags/:file_uuid", delete(moderation::unflag_content))
        .route("/moderation/log", get(moderation::get_moderation_log))
        .route("/moderation/check-ban", get(moderation::check_user_ban))
        
        // Admin routes
        .route("/admin/stats", get(admin::get_stats))
        .route("/admin/users", get(admin::list_users))
        .route("/admin/users/:user_id/role", put(admin::update_user_role))
        .route("/admin/users/:user_id", delete(admin::delete_user))
        .route("/admin/files", get(admin::list_files))
        .route("/admin/files/:file_uuid", delete(admin::admin_delete_file))
        .route("/admin/system", get(admin::system_status))
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "service": "scholar",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

async fn status(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let grabnet_available = state.grabnet.is_available();
    
    Json(json!({
        "status": "ok",
        "grabnet": {
            "available": grabnet_available,
        }
    }))
}

async fn tor_status(request: axum::extract::Request) -> Json<serde_json::Value> {
    let is_tor = middleware::is_tor_request(&request);
    
    Json(json!({
        "tor": {
            "detected": is_tor,
            "message": if is_tor {
                "You are accessing this service via Tor 🧅"
            } else {
                "You are not using Tor"
            }
        }
    }))
}

async fn grabnet_status(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    match state.grabnet.get_network_status().await {
        Ok(status) => {
            Json(json!({
                "grabnet": {
                    "available": state.grabnet.is_available(),
                    "gateway_url": state.grabnet.gateway_url,
                    "peer_viewer": state.grabnet.get_peer_viewer_url(),
                    "network": {
                        "running": status.running,
                        "peer_id": status.peer_id,
                        "connected_peers": status.connected_peers,
                        "published_sites": status.published_sites,
                        "hosted_sites": status.hosted_sites,
                    }
                }
            }))
        }
        Err(_) => {
            Json(json!({
                "grabnet": {
                    "available": state.grabnet.is_available(),
                    "gateway_url": state.grabnet.gateway_url,
                    "network": {
                        "running": false,
                        "error": "Failed to get network status"
                    }
                }
            }))
        }
    }
}

/// Get all work types with their review criteria
async fn get_work_types() -> Json<serde_json::Value> {
    use crate::models::{WorkType, WorkTypeInfo};
    
    let work_types: Vec<WorkTypeInfo> = WorkType::all()
        .iter()
        .map(|wt| WorkTypeInfo::from(*wt))
        .collect();
    
    Json(json!({
        "work_types": work_types,
        "description": "Work types define the nature of scholarly work and set review expectations. These are NOT categories of worth - all types are equally valid. They establish what KIND of contribution is being made and how it should be evaluated."
    }))
}

/// Get info for a specific work type
async fn get_work_type_info(
    axum::extract::Path(work_type): axum::extract::Path<String>,
) -> axum::response::Response {
    use crate::models::{WorkType, WorkTypeInfo};
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    
    match WorkType::from_str(&work_type) {
        Some(wt) => {
            let info = WorkTypeInfo::from(wt);
            Json(json!(info)).into_response()
        }
        None => {
            let valid_types: Vec<&str> = WorkType::all()
                .iter()
                .map(|wt| wt.as_str())
                .collect();
            
            (
                StatusCode::NOT_FOUND,
                Json(json!({
                    "error": format!("Unknown work type: {}", work_type),
                    "valid_types": valid_types
                }))
            ).into_response()
        }
    }
}
