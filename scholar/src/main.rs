//! Open Scholar - Decentralized Knowledge Sharing
//! 
//! A Rust-based application for uploading, pinning, and serving
//! any type of file on the GrabNet P2P network.
//! 
//! This is the primary interface for users to:
//! - Create accounts and manage their GrabNet identity
//! - Upload and organize files (papers, datasets, media, etc.)
//! - Discover and access content from other users
//! - Participate in open peer review

mod app;
mod db;
mod email;
mod handlers;
mod models;
mod moderation;
mod grabnet_client;
mod middleware;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{middleware as axum_mw, Router};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub use app::AppState;
use middleware::{RateLimitConfig, RateLimitState};

/// Default port for Open Scholar
pub const DEFAULT_PORT: u16 = 8889;

/// Open Scholar site ID on GrabNet (will be set after first publish)
pub const SCHOLAR_SITE_ID: Option<&str> = None; // TODO: Set after publishing

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "scholar=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Parse command line args
    let args: Vec<String> = std::env::args().collect();
    
    let port = args
        .iter()
        .position(|a| a == "--port" || a == "-p")
        .and_then(|i| args.get(i + 1))
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT);

    let data_dir = args
        .iter()
        .position(|a| a == "--data-dir" || a == "-d")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("scholar")
        });

    // Initialize application state
    let state = AppState::new(data_dir).await?;
    let state = Arc::new(state);

    // Build router
    let app = create_router(state);

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    
    println!();
    println!("📚 Open Scholar");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("  Server:     http://localhost:{}", port);
    println!("  GrabNet:    Connected ✓");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("  Ready for decentralized knowledge sharing! 🎓");
    println!();

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

fn create_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Initialize rate limiting state
    let rate_config = RateLimitConfig::default();
    let rate_state = Arc::new(RateLimitState::new(&rate_config));

    Router::new()
        // API routes
        .nest("/api", handlers::api_routes())
        // Static files and SPA fallback
        .merge(handlers::static_routes())
        // Security middleware (applied in order: bottom to top)
        .layer(axum_mw::from_fn(middleware::security_headers))
        .layer(axum_mw::from_fn_with_state(rate_state, middleware::rate_limit))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
