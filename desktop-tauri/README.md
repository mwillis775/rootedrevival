# Rooted Revival Desktop Application

Native desktop application for Rooted Revival, built with [Tauri](https://tauri.app/).

## Overview

This desktop application provides a native interface for:
- Running Scholar (knowledge management server) locally
- Running a GrabNet node for P2P content distribution
- Managing files offline-first with sync when connected
- Secure key management and identity

## Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Node.js](https://nodejs.org/) 18+
- Platform-specific dependencies (see below)

### Linux

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

### macOS

```bash
xcode-select --install
```

### Windows

- Visual Studio Build Tools 2022
- WebView2 (included in Windows 11, must install on Windows 10)

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Architecture

```
desktop-tauri/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs       # Application entry point
│   │   ├── commands.rs   # Tauri command handlers
│   │   └── state.rs      # Application state
│   ├── Cargo.toml        # Rust dependencies
│   └── tauri.conf.json   # Tauri configuration
├── package.json          # Node.js dependencies
└── README.md
```

## Features

### Embedded Services

The desktop app can run Scholar and GrabNet as child processes:

- **Scholar**: Local API server for file management
- **GrabNet**: P2P node for content distribution

### Offline-First

- Files are stored locally first
- Synced to GrabNet when connected
- Continue working without internet

### Secure Key Management

- Generate and store ed25519 keypairs
- Export encrypted backups
- Import from other devices

## Available Commands

The app exposes these Tauri commands to the frontend:

### Service Management
- `start_scholar` / `stop_scholar`
- `start_grabnet` / `stop_grabnet`
- `get_status`

### Network
- `get_peer_id`
- `get_connected_peers`
- `get_published_sites`
- `publish_site`
- `pin_site`

### Files
- `get_files`
- `upload_file`
- `download_file`

### Stats
- `get_network_stats`
- `get_storage_stats`

### Identity
- `export_identity`
- `import_identity`

## Building for Distribution

### Linux (AppImage, deb)

```bash
npm run tauri build
```

Outputs:
- `src-tauri/target/release/bundle/appimage/rooted-revival_*.AppImage`
- `src-tauri/target/release/bundle/deb/rooted-revival_*.deb`

### macOS

```bash
npm run tauri build
```

Outputs:
- `src-tauri/target/release/bundle/macos/Rooted Revival.app`
- `src-tauri/target/release/bundle/dmg/Rooted Revival_*.dmg`

### Windows

```bash
npm run tauri build
```

Outputs:
- `src-tauri/target/release/bundle/msi/Rooted Revival_*.msi`

## License

MIT OR Apache-2.0
