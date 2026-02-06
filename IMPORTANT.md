# 🌱 Rooted Revival - Complete Architecture & Implementation Plan

> **Last Updated:** June 3, 2025  
> **Status:** ✅ Feature Complete (All Phases Implemented)

---

## 📋 Table of Contents

1. [Vision & Overview](#vision--overview)
2. [System Architecture](#system-architecture)
3. [Component Details](#component-details)
4. [Data Flow](#data-flow)
5. [Implementation Status](#implementation-status)
6. [Remaining Work](#remaining-work)
7. [Build & Run Instructions](#build--run-instructions)
8. [File Structure](#file-structure)

---

## 🎯 Vision & Overview

**Rooted Revival** is a landscaping company with a multitalented founder who built
**Open Scholar** which is a decentralized platform for academic publishing and knowledge sharing, built on top of **GrabNet** which is a peer-to-peer content-addressed network also created by the Rooted Revival team to host rootedrevival.us

### Core Principles

1. **Decentralization** - Content is distributed across the network, not controlled by any single entity
2. **Permanence** - Once published, content is pinned and replicated across peers
3. **Open Access** - Academic knowledge should be freely accessible
4. **Peer Review** - Community-driven quality assurance through transparent reviews
5. **Identity Ownership** - Users control their cryptographic identity (ed25519 keys)

### Key Components

| Component | Technology | Port | Purpose |
|-----------|------------|------|---------|
| **Open Scholar** | Rust (Axum) | 8889 | Main web application for uploads, accounts, reviews |
| **GrabNet (Grab)** | Rust | 4001 (P2P), 8080 (Gateway) | P2P network, content addressing, file distribution |
| **GrabNet GUI** | Electron | N/A | Desktop app (`/grabnet-gui`) for publishing/managing websites |
| **Desktop Launcher** | Electron | N/A | Combined launcher (`/desktop`) for Revival + Open Scholar |
| **Tor Integration** | Tor | Hidden Service | Anonymous access via Tor (`/tor`) |

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACES                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────────┐      ┌──────────────────┐      ┌────────────────┐│
│   │   Web Browser    │      │   Desktop App    │      │   CLI Tools    ││
│   │   (any modern)   │      │   (Electron)     │      │   (grab-cli)   ││
│   └────────┬─────────┘      └────────┬─────────┘      └───────┬────────┘│
│            │                         │                        │          │
└────────────┼─────────────────────────┼────────────────────────┼──────────┘
             │                         │                        │
             ▼                         ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         OPEN SCHOLAR (Rust)                              │
│                         Port: 8889                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│   │   Auth      │  │   Files     │  │   Reviews   │  │   Static    │   │
│   │   Handler   │  │   Handler   │  │   Handler   │  │   Files     │   │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │
│          │                │                │                │           │
│          └────────────────┴────────────────┴────────────────┘           │
│                                    │                                     │
│                          ┌─────────┴─────────┐                          │
│                          │                   │                          │
│                    ┌─────▼─────┐      ┌──────▼──────┐                   │
│                    │  SQLite   │      │  GrabNet    │                   │
│                    │  Database │      │  Client     │                   │
│                    └───────────┘      └──────┬──────┘                   │
│                                              │                          │
└──────────────────────────────────────────────┼──────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           GRABNET (Rust)                                 │
│                    P2P Port: 4001 | Gateway: 8080                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    │
│   │   P2P Network   │    │   Content       │    │   HTTP Gateway  │    │
│   │   (libp2p)      │◄──►│   Store         │◄──►│   (sites/files) │    │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘    │
│                                                                          │
│   • Content-addressed storage (CIDs)                                    │
│   • Peer discovery & DHT                                                │
│   • Site publishing (static sites)                                      │
│   • File pinning & replication                                          │
│   • Network health monitoring                                           │
│   • Bootstrap node system                                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🌐 Browser P2P Layer (NEW)

### libp2p-js Integration (`/static/js/grabnet-p2p.js`)

True peer-to-peer in the browser using WebRTC and GossipSub:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      BROWSER P2P ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐           │
│   │   Browser 1  │◄───►│   Browser 2  │◄───►│   Browser 3  │           │
│   │  (libp2p-js) │     │  (libp2p-js) │     │  (libp2p-js) │           │
│   └──────┬───────┘     └──────┬───────┘     └──────┬───────┘           │
│          │                    │                    │                    │
│          └────────────────────┼────────────────────┘                    │
│                               │                                         │
│                    ┌──────────▼──────────┐                             │
│                    │   WebSocket Relay   │                             │
│                    │   (relay/ws-relay)  │                             │
│                    │   Port 4002 (WSS)   │                             │
│                    └──────────┬──────────┘                             │
│                               │                                         │
│                    ┌──────────▼──────────┐                             │
│                    │   Native GrabNet    │                             │
│                    │   (Rust libp2p)     │                             │
│                    │   Port 4001 (TCP)   │                             │
│                    └─────────────────────┘                             │
│                                                                          │
│   PROTOCOLS:                                                             │
│   • WebRTC - Browser-to-browser direct connections                      │
│   • Circuit Relay v2 - NAT traversal                                   │
│   • GossipSub - Pub/sub messaging (announcements, search)              │
│   • Kademlia DHT - Content discovery                                   │
│   • Noise - Encryption                                                  │
│   • Yamux - Stream multiplexing                                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Features

- **Hybrid Mode**: P2P when peers available, API fallback otherwise
- **Content Caching**: IndexedDB-backed local store for offline access
- **P2P Search**: Broadcasts search queries to all connected peers
- **Content Announcements**: Peers announce what content they have
- **File Streaming**: Download from nearest peer with CID verification
- **Status UI**: Live peer count and network mode indicator

#### Files

| File | Purpose |
|------|---------|
| `static/js/grabnet-p2p.js` | Core libp2p-js node with WebRTC, GossipSub, DHT |
| `static/js/grabnet-api.js` | Drop-in API replacement with P2P+HTTP hybrid |
| `relay/ws-relay.js` | Node.js WebSocket relay bridge to native network |

#### Usage in HTML Pages

```html
<script type="module">
    import { initGrabNet } from './static/js/grabnet-p2p.js';
    window.grabnet = await initGrabNet({ showUI: true });
</script>
```

---

## 🔧 Component Details

### 1. Open Scholar (`/scholar`)

The main web application, written entirely in Rust using Axum.

#### Features

- **User Accounts**
  - Registration with automatic GrabNet identity generation (ed25519)
  - Login/logout with session tokens
  - User profiles with bio, affiliation, reputation

- **File Management**
  - Upload any file type (PDFs, images, videos, data, etc.)
  - Automatic hashing (SHA-256) for integrity
  - Automatic pinning to GrabNet
  - Tagging and categorization
  - Full-text search (SQLite FTS5)
  - Public/private visibility

- **Peer Review System**
  - Submit reviews with ratings (1-5 stars)
  - Detailed scoring (methodology, clarity, reproducibility, significance)
  - Vote on review helpfulness
  - Review statistics per file

- **API Endpoints**
  ```
  GET  /api/health              - Health check
  GET  /api/status              - Server status with GrabNet info
  
  POST /api/auth/register       - Create account
  POST /api/auth/login          - Login
  POST /api/auth/logout         - Logout
  GET  /api/auth/me             - Current user
  GET  /api/auth/profile/:user  - User profile
  PUT  /api/auth/profile        - Update profile
  
  POST /api/files               - Upload file (multipart)
  GET  /api/files/:uuid         - File metadata
  PUT  /api/files/:uuid         - Update metadata
  DELETE /api/files/:uuid       - Delete file
  GET  /api/files/:uuid/stream  - Stream content
  GET  /api/files/:uuid/download - Download with filename
  
  GET  /api/browse/recent       - Recent uploads
  GET  /api/browse/type/:type   - By content type
  GET  /api/browse/search       - Full-text search
  GET  /api/browse/needs-review - Files needing reviews
  GET  /api/browse/tags         - Popular tags
  GET  /api/browse/tag/:tag     - Files by tag
  
  GET  /api/reviews/:file_uuid  - Reviews for file
  POST /api/reviews/:file_uuid  - Create review
  POST /api/reviews/:file_uuid/:id/vote - Vote on review
  GET  /api/reviews/recent      - Recent reviews
  
  POST /api/site/publish        - Publish to GrabNet
  GET  /api/site/status         - GrabNet connection status
  
  GET  /api/grabnet             - GrabNet network status
  GET  /api/admin/stats         - Admin dashboard stats
  GET  /api/admin/users         - User management (paginated)
  PUT  /api/admin/users/:id/role - Update user role
  GET  /api/admin/files         - File management (paginated)
  DELETE /api/admin/files/:uuid - Admin file deletion
  GET  /api/admin/system        - System status
  
  GET  /api/csrf-token          - Get CSRF token
  GET  /api/tor                 - Tor status endpoint
  ```

#### Database Schema (SQLite)

```sql
-- Users with GrabNet identity
users (
    id, username, email, password_hash, public_key,
    display_name, bio, affiliation, avatar_hash,
    is_admin, is_moderator, is_verified,
    total_uploads, total_reviews, reputation_score,
    created_at, last_login
)

-- Session tokens
sessions (
    id, user_id, token, expires_at, ip_address, user_agent, created_at
)

-- Uploaded files
files (
    id, uuid, user_id, filename, original_filename,
    content_type, size, hash, grabnet_cid,
    title, description, is_public,
    view_count, download_count,
    created_at, updated_at
)

-- File tags (many-to-many)
file_tags (file_id, tag)

-- Peer reviews
reviews (
    id, file_id, reviewer_id, rating, content,
    methodology_score, clarity_score, reproducibility_score, significance_score,
    helpful_count, unhelpful_count,
    created_at, updated_at
)

-- Review votes
review_votes (id, review_id, user_id, is_helpful, created_at)

-- Full-text search
files_fts (title, description, filename) -- FTS5 virtual table
```

### 2. GrabNet (`/grab`)

The P2P network layer, providing decentralized content distribution.

#### Key Features

- **Content Addressing** - Files identified by CID (Content ID based on hash)
- **P2P Distribution** - Files replicated across peers
- **Site Publishing** - Publish static sites with human-readable names
- **HTTP Gateway** - Access content via browser at `http://localhost:8080`
- **Network Monitoring** - Peer viewer UI at `/peers`
- **Bootstrap System** - Configurable bootstrap nodes for peer discovery

#### GrabNet API Endpoints

```
GET  /                    - Gateway homepage
GET  /peers               - Peer viewer dashboard (HTML)
GET  /api/network         - Full network status (JSON)
GET  /api/network/peers   - Connected peers list
GET  /api/network/stats   - Storage and network statistics
GET  /sites/:site_id/*    - Serve published sites
```

#### Integration with Scholar

When Scholar starts, it should:
1. Check if GrabNet is running
2. If not, optionally start it
3. Auto-pin the Scholar static site
4. Use GrabNet for all file storage

### 3. Desktop App (`/desktop`)

Electron-based desktop application providing native OS integration.

#### Features (Planned)

- System tray icon showing network status
- Native file drag-and-drop for uploads
- Background syncing
- Desktop notifications for reviews
- Offline mode with local cache

---

## 🔄 Data Flow

### User Registration Flow

```
1. User submits: username, email, password
2. Scholar generates ed25519 keypair
3. Password hashed with Argon2
4. User record created with public_key
5. Session token generated
6. Private key returned to user (they must save it!)
```

### File Upload Flow

```
1. User uploads file via multipart form
2. Scholar receives file + metadata (title, description, tags)
3. File saved to local content directory
4. SHA-256 hash computed
5. File added to GrabNet → returns CID
6. Database record created with CID
7. Response includes local URL + GrabNet URL
```

### File Access Flow

```
Option A: Direct (localhost)
  GET /content/{filename} → Scholar serves from disk

Option B: GrabNet Gateway
  GET http://localhost:8080/ipfs/{CID} → GrabNet serves from network

Option C: GrabNet Site
  GET http://localhost:8080/ipns/{site_id}/path → Site access
```

---

## 📊 Implementation Status

### ✅ Completed

- [x] Scholar project structure (`/scholar`)
- [x] Cargo.toml with all dependencies
- [x] Main entry point (`main.rs`)
- [x] Application state (`app.rs`)
- [x] Database wrapper (`db/mod.rs`)
- [x] Database schema (`db/schema.rs`)
- [x] User management (`db/users.rs`)
- [x] File management (`db/files.rs`)
- [x] Review management (`db/reviews.rs`)
- [x] Data models (`models.rs`)
- [x] GrabNet client wrapper (`grabnet_client.rs`)
- [x] Handler module structure (`handlers/mod.rs`)
- [x] Auth handlers (`handlers/auth.rs`)
- [x] File handlers (`handlers/files.rs`)
- [x] Review handlers (`handlers/reviews.rs`)
- [x] Static file handlers (`handlers/static_files.rs`)
- [x] Admin handlers (`handlers/admin.rs`)
- [x] Security middleware (`middleware.rs`)
- [x] GrabNet GUI desktop app (`/grabnet-gui`)
- [x] Desktop launcher app (`/desktop`)

### 🛡️ Security Completed

- [x] Created `.gitignore` to exclude `.env` files
- [x] Removed hardcoded Cloudflare API keys from pinning-service
- [x] Added `escapeHtml()` XSS protection to browse.html, search.html, view.html
- [x] Deleted obsolete `temp.html`
- [x] Added navigation links to index.html (Scholar, App)
- [x] Stripped IPFS from project, replaced with native GrabNet
- [x] Disabled IPFS systemd service
- [x] Updated Cloudflare tunnel config (removed ipfs subdomain)
- [x] Created new GrabNet pinning service (`pinning-service/grabnet-server.js`)

### ✅ Phase 1 Complete: Scholar Compiles

- [x] Fixed GrabNet client method signatures
- [x] Fixed `add_content` → `add_file` method calls
- [x] Fixed `delete_content` → `delete_file` method calls
- [x] Fixed `publish_site` return type handling
- [x] Added `Serialize` derive to `PublishResult`
- [x] Removed erroneous `.await` on sync functions
- [x] Fixed Argon2 error handling (map_err instead of ?)
- [x] Installed libssl-dev for OpenSSL compilation
- [x] Built release binary successfully

### ✅ Phase 2 Complete: Scholar Testing & Frontend

- [x] Tested all API endpoints (health, status, auth, files, browse)
- [x] Verified GrabNet integration works (upload returns grabnet_cid)
- [x] Created Scholar frontend (HTML/CSS/JS)
  - [x] `~/.local/share/scholar/static/index.html` - Main SPA
  - [x] `~/.local/share/scholar/static/css/app.css` - Modern CSS framework
  - [x] `~/.local/share/scholar/static/js/app.js` - Full SPA with routing
- [x] Frontend features:
  - [x] User registration with GrabNet identity generation
  - [x] User login/logout with JWT tokens
  - [x] File upload with drag-and-drop
  - [x] File browsing and search
  - [x] File detail view with download
  - [x] User profiles
  - [x] Responsive modern design

### 🔄 In Progress

- [ ] End-to-end user testing
- [ ] Performance optimization

### ✅ Phase 3 Complete: Security & Admin

- [x] CSRF protection (token endpoint, security headers)
  - X-Frame-Options: SAMEORIGIN
  - X-Content-Type-Options: nosniff
  - X-XSS-Protection: 1; mode=block
  - Referrer-Policy: strict-origin-when-cross-origin
  - Permissions-Policy (disable dangerous APIs)
- [x] Rate limiting with Governor
  - 100 req/s general limit
  - 10 login attempts/minute per IP
  - 5 registrations/hour per IP
  - 20 uploads/minute per IP
- [x] GrabNet auto-start from Scholar
  - Auto-detects if GrabNet is running
  - Starts grab binary if not found
  - Searches common paths for grab binary
- [x] Admin dashboard
  - /api/admin/stats - Dashboard statistics
  - /api/admin/users - User management with pagination
  - /api/admin/users/:id/role - Role updates (admin/mod/verified)
  - /api/admin/files - File management with pagination
  - /api/admin/files/:uuid - Admin file deletion
  - /api/admin/system - System status
  - Frontend admin panel with tabs

### ✅ Phase 4 Complete: Tor Integration

- [x] Created `/tor` directory with setup scripts
- [x] Tor hidden service configuration (`torrc.conf`)
- [x] Automated setup script (`setup.sh`)
- [x] Tor detection middleware in Scholar
- [x] /api/tor endpoint for Tor status
- [x] Documentation for Tor setup

### ✅ Phase 5 Complete: GrabNet Enhancements

- [x] **Peer Viewer Web UI** (`/peers` endpoint)
  - Real-time dashboard with network status
  - Connected peers list with peer IDs
  - Published/hosted sites display
  - Storage stats (chunks, total size)
  - Auto-refresh every 10 seconds
- [x] **Network Status API**
  - `/api/network` - Full network status
  - `/api/network/peers` - List of connected peers
  - `/api/network/stats` - Storage and network statistics
- [x] **Bootstrap Node System** (`network/bootstrap.rs`)
  - Configurable bootstrap nodes (official, community, custom)
  - CLI commands: `grab bootstrap list|add|remove|test`
  - Connectivity testing for bootstrap nodes
  - mDNS local discovery support
- [x] **Scholar ↔ GrabNet Integration**
  - Enhanced `add_file()` uploads to GrabNet gateway
  - `/api/grabnet` endpoint for network status
  - `get_network_status()` method in GrabNet client
  - Peer viewer URL accessible from Scholar
- [x] **Content Replication** (`network/replication.rs`)
  - `ReplicationPolicy` with min/max replicas
  - `ReplicationManager` for tracking site hosts
  - `SiteHealth` status tracking (Healthy/Degraded/Critical)
  - Auto-replication triggers
  - Replication statistics
- [x] **CLI Improvements**
  - `grab node peers` - List connected peers
  - `grab node status` - Enhanced with listen addresses
  - `grab bootstrap list|add|remove|test` - Bootstrap management
- [x] **Network Health Monitoring** (`network/health.rs`)
  - `PeerScore` - Reputation tracking per peer
  - `HealthMonitor` - Centralized health tracking
  - `NetworkMetrics` - Aggregated network statistics
  - `HealthSummary` - High-level health overview
  - Rolling average latency calculation
  - Success/failure tracking per peer

### ✅ Phase 6 Complete: Production Features

- [x] **OpenAPI Documentation** (`scholar/openapi.yaml`)
  - Complete OpenAPI 3.1.0 specification
  - All endpoints documented with parameters and schemas
  - Authentication schemes defined

- [x] **Test Suites**
  - Unit tests (`scholar/tests/unit_tests.rs`)
    - Database operations
    - Model validation
    - Password hashing
    - Ed25519 signing
  - Integration tests (`scholar/tests/integration_tests.rs`)
    - Full API endpoint testing
    - Authentication flows
    - File operations

- [x] **Production Deployment**
  - `Dockerfile` - Multi-stage build for Scholar + GrabNet
  - `docker-compose.yml` - Full orchestration with Tor, nginx
  - `deploy/scholar.service` - Systemd service with security hardening
  - `deploy/grabnet.service` - Systemd service for GrabNet node
  - `deploy/install.sh` - Automated deployment script
  - `deploy/nginx.conf` - Production reverse proxy configuration

- [x] **CI/CD Pipeline** (`.github/workflows/ci.yml`)
  - Lint (cargo fmt, cargo clippy)
  - Build matrix (Ubuntu, macOS)
  - Integration tests
  - Security audit (cargo-audit)
  - Docker image build
  - Release automation
  - Deployment to production

- [x] **Password Reset & Email** (`scholar/src/email.rs`)
  - SMTP email service using lettre
  - Password reset flow with secure tokens
  - Email templates for reset/verification
  - Configurable via environment variables

- [x] **Email Verification**
  - Verification tokens stored in database
  - `/api/auth/verify-email` endpoint
  - `/api/auth/resend-verification` endpoint
  - `email_verified` column on users table

- [x] **Private Key Management UI** (`scholar/static/js/keys.js`)
  - AES-GCM encrypted backup export
  - Password-protected key storage
  - Import/export functionality
  - Local storage with encryption

- [x] **Moderation System** (`scholar/src/moderation.rs`)
  - Report types: spam, harassment, plagiarism, misinformation, copyright
  - Report targets: files, users, reviews, comments
  - User bans: temporary, permanent, suspended, shadow
  - Content flags with moderator notes
  - Moderation log for audit trail
  - API endpoints:
    - `POST /api/reports` - Submit report
    - `GET /api/moderation/reports` - View pending reports
    - `PUT /api/moderation/reports/:id` - Review report
    - `POST /api/moderation/bans` - Ban user
    - `DELETE /api/moderation/bans/:user_id` - Unban user
    - `POST /api/moderation/flags` - Flag content
    - `GET /api/moderation/log` - View moderation log

- [x] **File Encryption** (`scholar/static/js/encryption.js`)
  - Client-side AES-256-GCM encryption
  - Password-based key derivation (PBKDF2)
  - Encrypted file format with metadata
  - Progress callbacks for large files
  - Decryption modal for downloads

- [x] **Desktop Rust Integration** (`desktop-tauri/`)
  - Tauri 2.0 desktop application
  - Native process management (Scholar, GrabNet)
  - Commands for:
    - Service start/stop
    - Network status
    - File upload/download
    - Peer management
    - Identity export/import
  - Cross-platform builds (Linux, macOS, Windows)

### ✅ All Features Complete

All originally planned features have been implemented! 🎉

---

## 📝 Remaining Work

### Future Enhancements (Optional)

1. **Performance Optimizations**
   - Connection pooling tuning
   - CDN integration
   - Edge caching

2. **Additional Features**
   - Real-time notifications (WebSockets)
   - Collaborative editing
   - DOI integration
   - Citation export (BibTeX, RIS)

3. **Mobile App**
   - React Native or Flutter
   - Offline-first sync

4. **Federation**
   - Multi-instance communication
   - Shared moderation policies

---

## 🚀 Build & Run Instructions

### Prerequisites

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable

# Node.js (for desktop app)
# Install via nvm or package manager
```

### Building Scholar

```bash
cd /home/michael/projects/rootedrevival/scholar

# Check for errors
cargo check

# Build debug
cargo build

# Build release
cargo build --release

# Run
cargo run -- --port 8889
```

### Building GrabNet

```bash
cd /home/michael/projects/rootedrevival/grab

cargo build --release
./target/release/grab
```

### Running Everything

```bash
# Terminal 1: GrabNet
cd grab && cargo run -- node

# Terminal 2: Scholar
cd scholar && cargo run

# Access:
# Scholar: http://localhost:8889
# GrabNet Gateway: http://localhost:8080
# GrabNet Peer Viewer: http://localhost:8080/peers
# GrabNet API: http://localhost:8080/api/network
```

### GrabNet CLI Commands

```bash
# Publish a website
grab publish ./my-site --name "mysite"

# Start a node
grab node

# List connected peers
grab node peers

# Show node status
grab node status

# Bootstrap node management
grab bootstrap list
grab bootstrap add "/ip4/1.2.3.4/tcp/4001/p2p/12D3..."
grab bootstrap remove 0
grab bootstrap test
```

---

## 📁 File Structure

```
/home/michael/projects/rootedrevival/
├── IMPORTANT.md              # This file - complete project documentation
├── README.md                 # Project overview
├── deploy.sh                 # Deployment script
│
├── scholar/                  # Rust web application (Port 8889)
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs           # Entry point
│       ├── app.rs            # AppState
│       ├── models.rs         # Data types
│       ├── middleware.rs     # CSRF, rate limiting, security
│       ├── grabnet_client.rs # GrabNet integration
│       ├── db/
│       │   ├── mod.rs        # Database wrapper
│       │   ├── schema.rs     # SQL schema
│       │   ├── users.rs      # User CRUD
│       │   ├── files.rs      # File CRUD
│       │   └── reviews.rs    # Review CRUD
│       └── handlers/
│           ├── mod.rs        # Router setup
│           ├── admin.rs      # Admin endpoints
│           ├── auth.rs       # Auth endpoints
│           ├── files.rs      # File endpoints
│           ├── reviews.rs    # Review endpoints
│           └── static_files.rs # Static serving
│
├── grab/                     # GrabNet P2P network
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs            # Library exports
│       ├── types.rs          # Core types
│       ├── bin/
│       │   └── grab.rs       # CLI binary
│       ├── content/          # Content management
│       │   ├── mod.rs
│       │   └── uploads.rs
│       ├── crypto/           # Cryptography
│       │   ├── mod.rs
│       │   ├── hash.rs
│       │   ├── merkle.rs
│       │   └── signing.rs
│       ├── gateway/          # HTTP gateway (Port 8080)
│       │   ├── mod.rs
│       │   └── server.rs     # Gateway with /peers, /api/network
│       ├── network/          # P2P networking
│       │   ├── mod.rs
│       │   ├── behaviour.rs  # libp2p behaviour
│       │   ├── bootstrap.rs  # Bootstrap node system
│       │   ├── health.rs     # Network health monitoring
│       │   ├── node.rs       # P2P node
│       │   ├── protocol.rs   # Wire protocol
│       │   └── replication.rs # Content replication
│       ├── publisher/        # Site publishing
│       │   ├── mod.rs
│       │   └── bundle.rs
│       └── storage/          # Persistent storage
│           ├── mod.rs
│           ├── bundles.rs
│           ├── chunks.rs
│           └── keys.rs
│
├── grabnet-gui/              # Electron desktop app for GrabNet
│   ├── package.json
│   ├── main.js
│   ├── preload.js
│   └── renderer/
│
├── desktop/                  # Electron launcher app
│   ├── package.json
│   ├── main.js
│   ├── preload.js
│   └── renderer/
│       ├── launcher.html
│       └── revival.html
│
├── desktop-tauri/            # Native Rust desktop app (Tauri 2.0)
│   ├── package.json
│   ├── tauri.conf.json
│   ├── README.md
│   └── src-tauri/
│       ├── Cargo.toml
│       ├── build.rs
│       └── src/
│           ├── main.rs       # Tauri entry point
│           ├── commands.rs   # Tauri commands
│           └── state.rs      # Application state
│
├── deploy/                   # Production deployment
│   ├── install.sh            # Automated deployment script
│   ├── scholar.service       # Systemd service (Scholar)
│   ├── grabnet.service       # Systemd service (GrabNet)
│   └── nginx.conf            # Production reverse proxy
│
├── .github/workflows/        # CI/CD
│   └── ci.yml                # GitHub Actions workflow
│
├── tor/                      # Tor hidden service setup
│   ├── README.md
│   ├── setup.sh
│   └── torrc.conf
│
├── server/                   # 🔴 Legacy Node.js (deprecated)
│   └── ...
│
└── site/                     # Static site content
    ├── index.html
    ├── grab.html
    ├── scholar.html
    └── content/
```

### Data Directories

```
~/.local/share/scholar/       # Scholar data
├── scholar.db                # SQLite database
├── content/                  # Uploaded files
└── static/                   # Frontend files
    ├── index.html
    ├── css/app.css
    └── js/
        ├── app.js
        ├── keys.js           # Key management UI
        └── encryption.js     # File encryption

~/.grab/                      # GrabNet data
├── sites/                    # Published sites
├── chunks/                   # Content chunks + db
├── keys/                     # Identity keys
└── config.json              # Node configuration
```

---

## 🎯 Production Deployment

All deployment infrastructure is now in place:

1. **Docker Deployment**
   ```bash
   docker-compose up -d
   ```

2. **Systemd Deployment**
   ```bash
   cd deploy && sudo ./install.sh
   ```

3. **CI/CD**
   - Push to main branch triggers build/test
   - Tagged releases create production builds
   - Automatic Docker image publishing

4. **Tor Hidden Service**
   ```bash
   cd tor && ./setup.sh
   ```

---

## 💡 Design Decisions

### Why Rust?

- Memory safety without garbage collection
- Excellent async performance (tokio)
- Strong type system catches bugs at compile time
- Single binary deployment
- Direct integration with GrabNet (also Rust)

### Why SQLite?

- Zero configuration
- Single file database
- Perfect for single-node deployments
- Full-text search built-in (FTS5)
- Can scale to millions of rows

### Why Axum?

- Built on tokio and hyper
- Type-safe extractors
- Tower middleware ecosystem
- Active development
- Excellent performance

### Why ed25519?

- Fast signature generation/verification
- Small key sizes (32 bytes)
- Widely used in crypto (Solana, IPFS, etc.)
- Compatible with GrabNet identity

---

## 📞 Contact & Resources

- **GitHub Repositories**:
  - **Open Scholar**: https://github.com/mwillis775/open-scholar
  - **GrabNet**: https://github.com/mwillis775/grab
- **Local Project**: /home/michael/projects/rootedrevival
- **Scholar Frontend**: `~/.local/share/scholar/static/`
- **GrabNet Data**: `~/.grab/`
- **Cloudflare Tunnel**: Routes `rootedrevival.us` → localhost:8080

---

*This document was last updated June 3, 2025. Update as the project evolves.*
