//! Rooted Revival Desktop Application
//!
//! Native desktop app that connects to rootedrevival.us,
//! runs a GrabNet node to pin the knowledge archive,
//! and helps maintain the decentralized network.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod state;

use state::AppState;
use std::sync::Arc;
use tokio::sync::Mutex;

fn main() {
    let mut app_state = AppState::new();
    app_state.load_settings();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Arc::new(Mutex::new(app_state)))
        .invoke_handler(tauri::generate_handler![
            commands::login,
            commands::logout,
            commands::check_auth,
            commands::browse_archive,
            commands::search_archive,
            commands::get_file_detail,
            commands::download_file,
            commands::get_tags,
            commands::get_my_files,
            commands::get_node_status,
            commands::start_node,
            commands::stop_node,
            commands::pin_site,
            commands::send_heartbeat,
            commands::get_settings,
            commands::update_settings,
            commands::get_system_info,
        ])
        .run(tauri::generate_context!())
        .expect("Error running Tauri application");
}
