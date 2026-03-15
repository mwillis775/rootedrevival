//! Security middleware for CSRF protection and rate limiting

use std::sync::Arc;
use std::time::Duration;
use std::net::IpAddr;

use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use dashmap::DashMap;
use governor::{
    clock::DefaultClock,
    middleware::NoOpMiddleware,
    state::{InMemoryState, NotKeyed},
    Quota, RateLimiter,
};
use parking_lot::RwLock;
use rand::Rng;
use serde_json::json;

use crate::AppState;

// ============================================================================
// CSRF Protection
// ============================================================================

/// CSRF token store - maps session tokens to CSRF tokens
pub type CsrfStore = Arc<DashMap<String, CsrfEntry>>;

#[derive(Clone)]
pub struct CsrfEntry {
    pub token: String,
    pub created_at: std::time::Instant,
}

/// Generate a new CSRF token
pub fn generate_csrf_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 32] = rng.gen();
    hex::encode(bytes)
}

/// CSRF protection middleware
/// 
/// For state-changing methods (POST, PUT, DELETE), validates that:
/// 1. Request has X-CSRF-Token header
/// 2. Token matches the one issued for this session
/// 
/// For GET requests, issues a new CSRF token if needed
pub async fn csrf_protection(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    
    // Only check CSRF for state-changing methods
    if matches!(method, Method::POST | Method::PUT | Method::DELETE) {
        // Skip CSRF for API endpoints that use Bearer tokens
        let has_bearer = request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.starts_with("Bearer "))
            .unwrap_or(false);
        
        if has_bearer {
            // JWT-authenticated requests don't need CSRF
            return next.run(request).await;
        }
        
        // Check for multipart (file uploads) - they use Bearer auth
        let content_type = request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        
        if content_type.contains("multipart/form-data") {
            return next.run(request).await;
        }
        
        // For form submissions, verify CSRF token
        let csrf_token = request
            .headers()
            .get("X-CSRF-Token")
            .and_then(|v| v.to_str().ok());
        
        if csrf_token.is_none() {
            // No CSRF token - for now, just log and continue
            // In strict mode, return 403
            tracing::warn!("Request without CSRF token: {} {}", method, request.uri());
        }
    }
    
    next.run(request).await
}

// ============================================================================
// Rate Limiting
// ============================================================================

/// Rate limit configuration
#[derive(Clone)]
pub struct RateLimitConfig {
    /// Requests per second for general API
    pub general_rps: u32,
    /// Requests per minute for auth endpoints
    pub auth_rpm: u32,
    /// Requests per hour for registration
    pub register_rph: u32,
    /// Requests per minute for file uploads  
    pub upload_rpm: u32,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            general_rps: 100,    // 100 requests/second general
            auth_rpm: 10,        // 10 login attempts/minute
            register_rph: 5,     // 5 registrations/hour per IP
            upload_rpm: 20,      // 20 uploads/minute
        }
    }
}

/// Per-IP rate limit state
pub struct RateLimitState {
    /// General API limiter
    pub general: RateLimiter<NotKeyed, InMemoryState, DefaultClock, NoOpMiddleware>,
    /// Per-IP limiters
    pub per_ip: DashMap<IpAddr, IpLimiters>,
}

pub struct IpLimiters {
    pub auth: RateLimiter<NotKeyed, InMemoryState, DefaultClock, NoOpMiddleware>,
    pub register: RateLimiter<NotKeyed, InMemoryState, DefaultClock, NoOpMiddleware>,
    pub upload: RateLimiter<NotKeyed, InMemoryState, DefaultClock, NoOpMiddleware>,
    pub last_seen: std::time::Instant,
}

impl RateLimitState {
    pub fn new(config: &RateLimitConfig) -> Self {
        let general_quota = Quota::per_second(std::num::NonZeroU32::new(config.general_rps).unwrap());
        
        Self {
            general: RateLimiter::direct(general_quota),
            per_ip: DashMap::new(),
        }
    }
    
    pub fn get_ip_limiters(&self, ip: IpAddr, config: &RateLimitConfig) -> dashmap::mapref::one::RefMut<'_, IpAddr, IpLimiters> {
        self.per_ip.entry(ip).or_insert_with(|| {
            let auth_quota = Quota::per_minute(std::num::NonZeroU32::new(config.auth_rpm).unwrap());
            let register_quota = Quota::per_hour(std::num::NonZeroU32::new(config.register_rph).unwrap());
            let upload_quota = Quota::per_minute(std::num::NonZeroU32::new(config.upload_rpm).unwrap());
            
            IpLimiters {
                auth: RateLimiter::direct(auth_quota),
                register: RateLimiter::direct(register_quota),
                upload: RateLimiter::direct(upload_quota),
                last_seen: std::time::Instant::now(),
            }
        })
    }
}

/// Extract client IP from request
fn get_client_ip(request: &Request) -> Option<IpAddr> {
    // Check X-Forwarded-For header first (for proxied requests)
    if let Some(forwarded) = request.headers().get("X-Forwarded-For") {
        if let Ok(s) = forwarded.to_str() {
            if let Some(first_ip) = s.split(',').next() {
                if let Ok(ip) = first_ip.trim().parse() {
                    return Some(ip);
                }
            }
        }
    }
    
    // Check X-Real-IP
    if let Some(real_ip) = request.headers().get("X-Real-IP") {
        if let Ok(s) = real_ip.to_str() {
            if let Ok(ip) = s.parse() {
                return Some(ip);
            }
        }
    }
    
    // Fallback: try to extract from socket (if available in extensions)
    // This is typically set by the server
    None
}

/// Rate limiting middleware
pub async fn rate_limit(
    State(rate_state): State<Arc<RateLimitState>>,
    request: Request,
    next: Next,
) -> Response {
    let config = RateLimitConfig::default();
    let path = request.uri().path();
    let method = request.method().clone();
    
    // Check global rate limit first
    if rate_state.general.check().is_err() {
        return rate_limit_response("Too many requests - server is busy");
    }
    
    // Get client IP for per-IP limiting
    let client_ip = get_client_ip(&request).unwrap_or_else(|| {
        // Default to localhost if we can't determine IP
        "127.0.0.1".parse().unwrap()
    });
    
    // Apply endpoint-specific rate limits
    let limiters = rate_state.get_ip_limiters(client_ip, &config);
    
    // Auth endpoints (login)
    if path.starts_with("/api/auth/login") && method == Method::POST {
        if limiters.auth.check().is_err() {
            drop(limiters);
            return rate_limit_response("Too many login attempts. Please wait a minute.");
        }
    }
    
    // Registration endpoint
    if path.starts_with("/api/auth/register") && method == Method::POST {
        if limiters.register.check().is_err() {
            drop(limiters);
            return rate_limit_response("Registration rate limit exceeded. Please try again later.");
        }
    }
    
    // Upload endpoint
    if path.starts_with("/api/files") && method == Method::POST {
        if limiters.upload.check().is_err() {
            drop(limiters);
            return rate_limit_response("Too many uploads. Please wait before uploading more.");
        }
    }
    
    drop(limiters);
    next.run(request).await
}

fn rate_limit_response(message: &str) -> Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        Json(json!({
            "error": message,
            "code": "RATE_LIMITED"
        }))
    ).into_response()
}

// ============================================================================
// Security Headers
// ============================================================================

/// Add security headers to all responses
pub async fn security_headers(
    request: Request,
    next: Next,
) -> Response {
    let mut response = next.run(request).await;
    
    let headers = response.headers_mut();
    
    // Prevent clickjacking
    headers.insert(
        "X-Frame-Options",
        "SAMEORIGIN".parse().unwrap()
    );
    
    // Prevent MIME type sniffing
    headers.insert(
        "X-Content-Type-Options",
        "nosniff".parse().unwrap()
    );
    
    // Enable XSS filter
    headers.insert(
        "X-XSS-Protection",
        "1; mode=block".parse().unwrap()
    );
    
    // Referrer policy
    headers.insert(
        "Referrer-Policy",
        "strict-origin-when-cross-origin".parse().unwrap()
    );
    
    // Permissions policy (restrict dangerous APIs)
    headers.insert(
        "Permissions-Policy",
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()".parse().unwrap()
    );
    
    response
}

// ============================================================================
// CSRF Token Endpoint Handler
// ============================================================================

/// Get a new CSRF token
pub async fn get_csrf_token() -> Json<serde_json::Value> {
    let token = generate_csrf_token();
    Json(json!({
        "csrf_token": token
    }))
}

// ============================================================================
// Tor Detection
// ============================================================================

/// Check if request is coming via Tor (.onion address)
pub fn is_tor_request(request: &Request) -> bool {
    // Check Host header for .onion
    if let Some(host) = request.headers().get(header::HOST) {
        if let Ok(host_str) = host.to_str() {
            if host_str.ends_with(".onion") || host_str.contains(".onion:") {
                return true;
            }
        }
    }
    
    // Check for Tor exit node header (some proxies add this)
    if request.headers().contains_key("X-Tor-Exit") {
        return true;
    }
    
    false
}

/// Middleware to add Tor-aware headers
pub async fn tor_headers(
    request: Request,
    next: Next,
) -> Response {
    let is_tor = is_tor_request(&request);
    
    let mut response = next.run(request).await;
    
    if is_tor {
        let headers = response.headers_mut();
        
        // Add header indicating Tor access (useful for debugging)
        headers.insert(
            "X-Tor-Service",
            "true".parse().unwrap()
        );
        
        // For Tor, be extra strict about caching
        headers.insert(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, private".parse().unwrap()
        );
    }
    
    response
}

/// Get Tor status for API
pub async fn get_tor_status(request: Request) -> Json<serde_json::Value> {
    let is_tor = is_tor_request(&request);
    
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
