//! Rooted Revival Desktop Application
//!
//! Native desktop app built with Tauri that integrates
//! Scholar and GrabNet for offline-first decentralized knowledge sharing.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;

use state::AppState;
use std::sync::Arc;
use tokio::sync::Mutex;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Arc::new(Mutex::new(AppState::new())))
        .invoke_handler(tauri::generate_handler![
            commands::start_scholar,
            commands::stop_scholar,
            commands::start_grabnet,
            commands::stop_grabnet,
            commands::get_status,
            commands::get_peer_id,
            commands::get_connected_peers,
            commands::get_published_sites,
            commands::publish_site,
            commands::pin_site,
            commands::unpin_site,
            commands::get_files,
            commands::search_content,
            commands::upload_file,
            commands::download_file,
            commands::get_network_stats,
            commands::get_storage_stats,
            commands::export_identity,
            commands::import_identity,
            commands::get_config,
            commands::set_offline_mode,
        ])
        .run(tauri::generate_context!())
        .expect("Error running Tauri application");
}
