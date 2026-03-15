//! Authentication handlers

use std::sync::Arc;
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json},
};
use serde_json::json;

use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;

use crate::models::{LoginRequest, NewUser, RegisterRequest};
use crate::AppState;

/// Extract session token from headers
fn extract_token(headers: &HeaderMap) -> Option<String> {
    // Try Authorization header first
    if let Some(auth) = headers.get(header::AUTHORIZATION) {
        if let Ok(value) = auth.to_str() {
            if value.starts_with("Bearer ") {
                return Some(value[7..].to_string());
            }
        }
    }
    
    // Try cookie
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

/// Register a new user
pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterRequest>,
) -> impl IntoResponse {
    // Validate input
    if req.username.len() < 3 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Username must be at least 3 characters" })),
        );
    }
    
    if req.password.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Password must be at least 8 characters" })),
        );
    }
    
    // Check if username exists
    if let Ok(Some(_)) = state.db.get_user_by_username(&req.username) {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "Username already taken" })),
        );
    }
    
    // Generate GrabNet identity (ed25519 keypair)
    let signing_key = SigningKey::generate(&mut OsRng);
    let public_key = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
    
    // TODO: Store private key securely for the user
    // For now, we'll return it so they can save it
    let private_key = bs58::encode(signing_key.to_bytes()).into_string();
    
    // Create user
    let new_user = NewUser {
        username: req.username.clone(),
        email: req.email,
        password: req.password,
        public_key: public_key.clone(),
        display_name: req.display_name,
    };
    
    match state.db.create_user(new_user) {
        Ok(user) => {
            // Create session
            match state.db.create_session(user.id, None, None) {
                Ok(session) => {
                    (
                        StatusCode::CREATED,
                        Json(json!({
                            "success": true,
                            "user": user.public_view(),
                            "token": session.token,
                            "grabnet_identity": {
                                "public_key": public_key,
                                "private_key": private_key,
                                "warning": "Save your private key securely! You'll need it to prove ownership of your content."
                            }
                        })),
                    )
                }
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": format!("Failed to create session: {}", e) })),
                ),
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to create user: {}", e) })),
        ),
    }
}

/// Login
pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginRequest>,
) -> impl IntoResponse {
    match state.db.authenticate_user(&req.username, &req.password) {
        Ok(Some(user)) => {
            match state.db.create_session(user.id, None, None) {
                Ok(session) => {
                    (
                        StatusCode::OK,
                        Json(json!({
                            "success": true,
                            "user": user.public_view(),
                            "token": session.token,
                        })),
                    )
                }
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": format!("Failed to create session: {}", e) })),
                ),
            }
        }
        Ok(None) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid credentials" })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Authentication error: {}", e) })),
        ),
    }
}

/// Logout
pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(token) = extract_token(&headers) {
        let _ = state.db.delete_session(&token);
    }
    
    Json(json!({ "success": true }))
}

/// Get current user
pub async fn me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Not authenticated" })),
            );
        }
    };
    
    match state.db.validate_session(&token) {
        Ok(Some((_, user))) => {
            (StatusCode::OK, Json(json!({ "user": user.public_view() })))
        }
        _ => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid session" })),
        ),
    }
}

/// Get user profile
pub async fn get_profile(
    State(state): State<Arc<AppState>>,
    Path(username): Path<String>,
) -> impl IntoResponse {
    match state.db.get_user_by_username(&username) {
        Ok(Some(user)) => {
            // Get user's files
            let files = state.db.get_files_by_user(user.id, 20, 0).unwrap_or_default();
            
            (
                StatusCode::OK,
                Json(json!({
                    "user": user.public_view(),
                    "files": files,
                })),
            )
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "User not found" })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Update profile
pub async fn update_profile(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(updates): Json<serde_json::Value>,
) -> impl IntoResponse {
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Not authenticated" })),
            );
        }
    };
    
    match state.db.validate_session(&token) {
        Ok(Some((_, user))) => {
            let display_name = updates.get("display_name").and_then(|v| v.as_str());
            let bio = updates.get("bio").and_then(|v| v.as_str());
            let affiliation = updates.get("affiliation").and_then(|v| v.as_str());
            
            match state.db.update_user(user.id, display_name, bio, affiliation) {
                Ok(_) => (StatusCode::OK, Json(json!({ "success": true }))),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": e.to_string() })),
                ),
            }
        }
        _ => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid session" })),
        ),
    }
}

/// Forgot password - request password reset email
pub async fn forgot_password(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let email = match req.get("email").and_then(|v| v.as_str()) {
        Some(e) => e,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Email is required" })),
            );
        }
    };
    
    // Always return success to prevent email enumeration attacks
    let success_response = (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "If an account exists with this email, a password reset link will be sent."
        })),
    );
    
    // Find user by email
    let user = match state.db.get_user_by_email(email) {
        Ok(Some(u)) => u,
        _ => return success_response,
    };
    
    // Generate reset token
    use rand::Rng;
    let token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    
    // Store reset token with expiry (1 hour)
    if let Err(e) = state.db.store_reset_token(user.id, &token) {
        tracing::error!("Failed to store reset token: {}", e);
        return success_response;
    }
    
    // Send email (use configured base URL or default to localhost)
    let base_url = std::env::var("BASE_URL").unwrap_or_else(|_| "http://localhost:8889".to_string());
    if let Err(e) = state.email.send_password_reset(&user.email.unwrap_or_default(), &user.username, &token, &base_url).await {
        tracing::error!("Failed to send password reset email: {}", e);
    }
    
    success_response
}

/// Reset password using token
pub async fn reset_password(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let token = match req.get("token").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Reset token is required" })),
            );
        }
    };
    
    let new_password = match req.get("password").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "New password is required" })),
            );
        }
    };
    
    if new_password.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Password must be at least 8 characters" })),
        );
    }
    
    // Validate reset token
    let user_id = match state.db.validate_reset_token(token) {
        Ok(Some(id)) => id,
        Ok(None) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid or expired reset token" })),
            );
        }
        Err(e) => {
            tracing::error!("Failed to validate reset token: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to validate token" })),
            );
        }
    };
    
    // Update password
    if let Err(e) = state.db.update_password(user_id, new_password) {
        tracing::error!("Failed to update password: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to update password" })),
        );
    }
    
    // Invalidate all sessions for this user
    let _ = state.db.delete_all_user_sessions(user_id);
    
    // Delete the reset token
    let _ = state.db.delete_reset_token(token);
    
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "Password has been reset. Please log in with your new password."
        })),
    )
}

/// Verify email address
pub async fn verify_email(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let token = match req.get("token").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Verification token is required" })),
            );
        }
    };
    
    // Validate verification token
    let user_id = match state.db.validate_email_token(token) {
        Ok(Some(id)) => id,
        Ok(None) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid or expired verification token" })),
            );
        }
        Err(e) => {
            tracing::error!("Failed to validate email token: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to validate token" })),
            );
        }
    };
    
    // Mark email as verified
    if let Err(e) = state.db.verify_user_email(user_id) {
        tracing::error!("Failed to verify email: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to verify email" })),
        );
    }
    
    // Delete the verification token
    let _ = state.db.delete_email_token(token);
    
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "Email has been verified."
        })),
    )
}

/// Resend email verification
pub async fn resend_verification(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Not authenticated" })),
            );
        }
    };
    
    let user = match state.db.validate_session(&token) {
        Ok(Some((_, u))) => u,
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Invalid session" })),
            );
        }
    };
    
    let email = match user.email {
        Some(e) => e,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "No email address on account" })),
            );
        }
    };
    
    if user.email_verified {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Email already verified" })),
        );
    }
    
    // Generate verification token
    use rand::Rng;
    let verify_token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    
    // Store verification token
    if let Err(e) = state.db.store_email_token(user.id, &verify_token) {
        tracing::error!("Failed to store email token: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to generate verification token" })),
        );
    }
    
    // Send verification email
    let base_url = std::env::var("BASE_URL").unwrap_or_else(|_| "http://localhost:8889".to_string());
    if let Err(e) = state.email.send_verification(&email, &user.username, &verify_token, &base_url).await {
        tracing::error!("Failed to send verification email: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to send verification email" })),
        );
    }
    
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "Verification email sent."
        })),
    )
}
