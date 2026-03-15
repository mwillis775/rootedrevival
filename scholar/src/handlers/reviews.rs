//! Review handlers - peer review system

use std::sync::Arc;
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::models::{NewReview, ReviewRequest};
use crate::AppState;

/// Query for review listing
#[derive(Debug, Deserialize)]
pub struct ReviewQuery {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// Vote request
#[derive(Debug, Deserialize)]
pub struct VoteRequest {
    pub helpful: bool,
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

/// Get reviews for a file
pub async fn get_reviews(
    State(state): State<Arc<AppState>>,
    Path(file_uuid): Path<String>,
    Query(query): Query<ReviewQuery>,
) -> impl IntoResponse {
    // First get the file
    let file = match state.db.get_file_by_uuid(&file_uuid) {
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
    
    let limit = query.limit.unwrap_or(20);
    let offset = query.offset.unwrap_or(0);
    
    match state.db.get_reviews_for_file(file.id, limit, offset) {
        Ok(reviews) => {
            // Get stats
            let stats = state.db.get_review_stats(file.id).ok();
            
            (
                StatusCode::OK,
                Json(json!({
                    "file_uuid": file_uuid,
                    "reviews": reviews,
                    "stats": stats,
                })),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Create a review
pub async fn create_review(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(file_uuid): Path<String>,
    Json(req): Json<ReviewRequest>,
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
    
    // Get the file
    let file = match state.db.get_file_by_uuid(&file_uuid) {
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
    
    // Check if user already reviewed this file
    match state.db.has_user_reviewed(file.id, user.id) {
        Ok(true) => {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": "You have already reviewed this file" })),
            );
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e.to_string() })),
            );
        }
        _ => {}
    }
    
    // Cannot review own file
    if file.user_id == user.id {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "You cannot review your own file" })),
        );
    }
    
    // Validate rating
    if req.rating < 1 || req.rating > 5 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Rating must be between 1 and 5" })),
        );
    }
    
    // Create review
    let new_review = NewReview {
        file_id: file.id,
        reviewer_id: user.id,
        rating: req.rating,
        content: req.content,
        methodology_score: req.methodology_score,
        clarity_score: req.clarity_score,
        reproducibility_score: req.reproducibility_score,
        significance_score: req.significance_score,
        criteria_scores: req.criteria_scores.clone(),
    };
    
    match state.db.create_review(new_review) {
        Ok(review) => (
            StatusCode::CREATED,
            Json(json!({
                "success": true,
                "review": review,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Vote on a review
pub async fn vote_review(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((file_uuid, review_id)): Path<(String, i64)>,
    Json(req): Json<VoteRequest>,
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
    
    // Verify the file exists
    match state.db.get_file_by_uuid(&file_uuid) {
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
        _ => {}
    }
    
    // Vote
    match state.db.vote_on_review(review_id, user.id, req.helpful) {
        Ok(_) => (StatusCode::OK, Json(json!({ "success": true }))),
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("UNIQUE constraint failed") {
                (
                    StatusCode::CONFLICT,
                    Json(json!({ "error": "You have already voted on this review" })),
                )
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": error_msg })),
                )
            }
        }
    }
}

/// Get recent reviews across all files
pub async fn recent_reviews(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ReviewQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(20);
    
    match state.db.get_recent_reviews(limit) {
        Ok(reviews) => (StatusCode::OK, Json(json!({ "reviews": reviews }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}
