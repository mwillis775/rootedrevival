# Rooted Revival — Quickstart Guide

This guide walks you through setting up every piece of the Rooted Revival stack from scratch. Follow it in order. Skip sections for components you don't need.

---

## Prerequisites

| Tool | Minimum Version | Check With |
|------|----------------|------------|
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| Rust | 1.70+ | `rustc --version` |
| Cargo | 1.70+ | `cargo --version` |
| Git | any | `git --version` |
| SQLite3 | 3.x (optional CLI) | `sqlite3 --version` |

### Install missing tools

```bash
# Node.js (via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

---

## 1. Clone the Repository

```bash
git clone https://github.com/your-org/rootedrevival.git
cd rootedrevival
```

---

## 2. Node.js API Server (port 3000)

The server handles authentication, CMS, messaging, file uploads, and GrabNet orchestration.

```bash
cd server

# Option A: Automated setup (recommended)
./setup.sh

# Option B: Manual setup
npm install
cp .env.example .env 2>/dev/null || cat > .env << 'EOF'
PORT=3000
HOST=0.0.0.0
BASE_URL=http://localhost:3000
SESSION_SECRET=$(openssl rand -hex 32)
EOF
npm run db:init        # Create SQLite tables
npm run db:seed        # Optional: seed test data
```

### Run the server

```bash
# Development (auto-reload on changes)
npm run dev

# Production
npm start
```

### Create your admin account

With the server running, register at `http://localhost:3000` or via the API:

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"youradmin","password":"strongpassword","email":"you@example.com"}'
```

Then promote to admin in SQLite:

```bash
sqlite3 data/scholar.db "UPDATE users SET role='admin' WHERE username='youradmin';"
```

### Run tests

```bash
npm test
```

---

## 3. GrabNet — Decentralized Site Hosting (port 8888)

GrabNet is a Rust-based content-addressed publishing system. The gateway serves the live site.

```bash
cd grab

# Build (optimized)
cargo build --release

# Run tests
cargo test
```

### Publish the site for the first time

```bash
./target/release/grab publish ../site/ --name rootedrevival
```

### Update after changes

```bash
./target/release/grab update rootedrevival
```

### Start the gateway

```bash
./target/release/grab gateway --port 8888 --default-site rootedrevival
```

The site is now served at `http://localhost:8888`.

---

## 4. Scholar — Academic API Service (port 8889)

A Rust service for academic paper moderation and search.

```bash
cd scholar

# Build
cargo build --release

# Run
cargo run --release -- --port 8889

# Run tests
cargo test
```

---

## 5. WebSocket Relay (port 8080)

Bridges browser libp2p peers for P2P content sharing.

```bash
cd relay
npm install

# Development
npm run dev

# Production
npm start
```

---

## 6. Pinning Service

Pins content to IPFS and manages Cloudflare DNSLink records.

```bash
cd pinning-service

# Automated setup (installs IPFS Kubo, configures systemd, sets up tunnel)
./setup.sh

# Or manual
npm install
cp .env.example .env   # Edit with your Cloudflare credentials
npm run dev
```

---

## 7. Desktop Apps (optional)

### Electron Desktop Client

```bash
cd desktop
npm install
npm run dev           # Development
npm run build         # Build for current platform
npm run build:all     # Build for all platforms
```

### GrabNet GUI

```bash
cd grabnet-gui
npm install
npm run dev
```

### Tauri Desktop Client

```bash
cd desktop-tauri
npm install
npm run tauri:dev     # Development
npm run tauri:build   # Production build
```

---

## 8. Running Everything Together (Development)

Open separate terminals for each service you need:

```bash
# Terminal 1 — Node API server
cd server && npm run dev

# Terminal 2 — GrabNet gateway
cd grab && ./target/release/grab gateway --port 8888 --default-site rootedrevival

# Terminal 3 — Scholar (if doing academic features)
cd scholar && cargo run --release -- --port 8889

# Terminal 4 — Relay (if doing P2P browser features)
cd relay && npm run dev
```

Or use Docker for the full stack:

```bash
docker-compose up -d          # Start all services
docker-compose logs -f        # Follow logs
docker-compose down           # Stop everything
```

---

## 9. Production Deployment

### Full automated install (requires root)

```bash
sudo ./deploy/install.sh
```

This builds Rust binaries, creates system users, installs systemd services, and configures everything.

### Systemd services

After installation, manage services with:

```bash
# Start / stop / restart
sudo systemctl start revival-server    # Node.js API (port 3000)
sudo systemctl start grab-gateway      # GrabNet gateway (port 8888)
sudo systemctl start grabnet-relay     # P2P WebSocket relay (ports 4003/4004)
sudo systemctl start cloudflared       # Cloudflare tunnel
sudo systemctl start pinning           # IPFS pinning service

# Enable on boot
sudo systemctl enable revival-server grab-gateway grabnet-relay cloudflared pinning

# View logs
sudo journalctl -u revival-server -f
sudo journalctl -u grab-gateway -f
sudo journalctl -u scholar -f
```

### Publishing site changes to production

The Node server's publish flow (triggered from admin panel) automatically:
1. Stops the GrabNet gateway via systemd
2. Runs `grab update rootedrevival`
3. Restarts the gateway via systemd

To publish manually:

```bash
sudo systemctl stop grab-gateway
cd grab && ./target/release/grab update rootedrevival
sudo systemctl start grab-gateway
```

### Cloudflare Tunnel

The production site uses Cloudflare Tunnel (not nginx) to expose services:

| Domain | Routes To |
|--------|-----------|
| `rootedrevival.us` | GrabNet gateway (localhost:8888) |
| `scholar.rootedrevival.us` | Node.js server (localhost:3000) |
| `pin.rootedrevival.us` | Node.js server (localhost:3000) |

Configure in `~/.cloudflared/config.yml`.

### Tor Hidden Services (optional)

```bash
sudo ./tor/setup.sh
```

---

## 10. IPFS Content Pinning

To pin and deploy content to IPFS with Cloudflare DNSLink:

```bash
./deploy.sh index.html --update-dns
```

---

## Architecture Overview

```
Visitors
    │
    ▼
Cloudflare Edge (SSL, DDoS protection)
    │
    ▼
Cloudflare Tunnel (cloudflared)
    │
    ├── rootedrevival.us ──────► GrabNet Gateway (:8888)
    │                              Serves published site snapshot (content-addressed)
    │
    ├── scholar.rootedrevival.us ► Node.js Server (:3000)
    │                              Auth, CMS, uploads, admin, messaging, GrabNet orchestration
    │
    └── pin.rootedrevival.us ───► Node.js Server (:3000)
                                   IPFS pinning API

Other local services:
    Scholar API (:8889) ── Rust academic moderation service
    Relay (:8080) ──────── WebSocket relay for browser P2P
    IPFS (:5001) ───────── Content pinning daemon
```

### Key directories

| Path | Purpose |
|------|---------|
| `site/` | Published site source — GrabNet publishes this directory |
| `site/content/<user>/` | User-uploaded files (managed by CMS) |
| `server/src/` | Node.js API server source |
| `server/data/` | SQLite database and uploads |
| `scholar/src/` | Rust scholar service source |
| `grab/src/` | Rust GrabNet core source |
| `static/js/` | Shared browser P2P scripts |
| `deploy/` | Systemd service files and install script |

### How site publishing works

1. You edit files in `site/` (directly or via the CMS admin panel)
2. Publishing runs `grab update rootedrevival` which:
   - Diffs the site directory against the last published revision
   - Chunks and content-addresses changed files
   - Stores the new revision in GrabNet's local database
3. The GrabNet gateway serves the latest published snapshot
4. Changes are NOT live until published — editing `site/` files alone does nothing

---

## Troubleshooting

### Server won't start
- Check `.env` exists in `server/` with a valid `SESSION_SECRET`
- Run `npm run db:init` if the database doesn't exist
- Check port 3000 isn't in use: `sudo lsof -i :3000`

### GrabNet gateway won't start
- Check port 8888 isn't in use: `sudo lsof -i :8888`
- Make sure the site was published at least once: `grab publish ./site/ --name rootedrevival`
- Check the grab binary exists: `ls grab/target/release/grab`

### Site changes not appearing on rootedrevival.us
- The GrabNet gateway serves a **published snapshot**, not live files
- Republish: `sudo systemctl stop grab-gateway && cd grab && ./target/release/grab update rootedrevival && sudo systemctl start grab-gateway`
- Purge Cloudflare cache if needed

### Port already in use
```bash
sudo lsof -i :<port>      # Find what's using the port
sudo kill <pid>            # Kill the process
```

### Database is locked
- Another process has the SQLite database open
- The GrabNet gateway locks its DB — stop the gateway before publishing

### P2P errors in browser console
- Browser P2P is currently disabled (needs real bootstrap relay peers)
- The `[GrabNet] P2P disabled` or `fallback mode` messages are expected
- These don't affect site functionality — uploads and downloads use the API
