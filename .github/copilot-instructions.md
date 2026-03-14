# Rooted Revival — Project Instructions

## Architecture Overview

Rooted Revival is a decentralized academic archive running at **rootedrevival.us**.

### Stack
- **Frontend**: Static HTML pages served from repo root (`admin.html`, `index.html`, etc.) — no build step, no framework
- **API Server** (`server/`): Node.js with custom micro-framework (`src/http.js`), SQLite via `better-sqlite3`
- **P2P Layer** (`grab/`): Rust crate — content-addressed storage, libp2p, Merkle trees, replication
- **Scholar API** (`scholar/`): Rust/Actix-web academic API with moderation, peer review, GrabNet publishing
- **Relay**: WebSocket relay (`relay/ws-relay.js`) for P2P signaling
- **Pinning Service**: Node.js service (`pinning-service/`) for persistent content pinning
- **Desktop Apps**: Electron (`desktop/`) and Tauri (`desktop-tauri/`) clients

### Deployment
- P2P-served via GrabNet through Cloudflare tunnel
- Internet Archive provides downtime protection / archival
- Domain: `rootedrevival.us`
- API base: `https://scholar.rootedrevival.us/api`

## Security Model

### Authentication Tiers
1. **Session auth**: Cookie-based (`session` cookie), standard login
2. **Admin auth**: `isAdmin` flag on user record, grants read access to moderation tools
3. **U2F-elevated admin**: Hardware security key (Flipper Zero) verification sets `u2f_verified` cookie — required for destructive/write admin operations (page edits, user bans, site settings changes)

### WebAuthn / Flipper Zero
- Backend: `server/src/webauthn.js` — registration & authentication ceremony, CBOR decoder, credential storage
- Middleware: `server/src/http.js` line ~321 maps `u2f_verified` cookie → `req.u2fVerified`
- CMS routes: `server/src/cms-routes.js` — `requireU2FAdmin()` gates write operations
- Frontend: `admin.html` — WebAuthn API calls with binary↔base64url conversion
- RP ID: `rootedrevival.us`, configurable via `WEBAUTHN_RP_ID` env var

### CORS
- Allowed origins: `rootedrevival.us`, `scholar.rootedrevival.us`, `localhost:*`
- Credentials: always included (`credentials: 'include'` on fetch, `Allow-Credentials: true` on server)

## Database

SQLite at `server/data/scholar.db`. Key tables:
- `users` — accounts with `is_admin` flag
- `papers` — uploaded academic content with moderation status
- `webauthn_credentials` — hardware key registrations (credential_id, public_key, sign_count)
- `cms_pages` — editable site pages (slug, content, status, template, custom CSS/JS)
- `cms_media` — uploaded media assets
- `cms_settings` — key-value site configuration
- `cms_nav_items` — navigation menu entries
- `cms_components` — reusable HTML blocks (header, footer, sidebar)
- `cms_themes` — theme definitions with CSS variable overrides

DB modules: `server/src/db/` — `users.js`, `papers.js`, `cms.js`, `moderation.js`, `files.js`, etc.

## Admin Panel (`admin.html`)

Single-page app, ~1500 lines. Sections:
- **Dashboard**: Stats, recent activity
- **Pages**: WYSIWYG editor with toolbar, HTML mode toggle, revision history
- **Media**: Grid/upload with drag-drop, detail editor, folder filtering
- **Navigation**: Drag-reorder nav items per menu
- **Themes**: CSS variable editor with live preview
- **Settings**: Grouped key-value pairs (general, appearance, seo, advanced)
- **Components**: Editable HTML blocks (header, footer, sidebar, scripts)
- **GrabNet**: P2P publishing controls, node status, pinning
- **Moderation**: Pending queue, approve/reject, user management, audit logs
- **Security Keys**: Register/delete U2F keys, session elevation status

### UI Conventions
- Dark terminal aesthetic (green-on-black) as default theme
- 4 themes: `terminal`, `vapor`, `midnight`, `paper`
- Monospace font: Share Tech Mono; Sans: Inter
- Toast notifications for feedback
- Modal dialogs for confirmations and detail views
- Sidebar navigation with active states and badge counts

## API Endpoints

### Auth
- `POST /api/auth/login` — username + password
- `POST /api/auth/register` — create account
- `GET /api/auth/me` — current session

### WebAuthn
- `GET /api/webauthn/status` — check registered keys
- `POST /api/webauthn/register/begin` → `/register/complete` — register new key
- `POST /api/webauthn/auth/begin` → `/auth/complete` — authenticate with key
- `DELETE /api/webauthn/credentials/:id` — remove key

### CMS
- `GET/POST /api/cms/pages` — list/create pages
- `GET/PUT/DELETE /api/cms/pages/:uuid` — single page CRUD
- `GET /api/cms/pages/:uuid/revisions` — revision history
- `POST /api/cms/pages/:uuid/revisions/:id/restore` — restore revision
- `GET/POST /api/cms/media` — list/upload media (multipart)
- `GET /api/cms/media/:uuid/file` — serve media file
- `PUT/DELETE /api/cms/media/:uuid` — update/delete media
- `GET/PUT /api/cms/settings` — site settings
- `GET/PUT /api/cms/navigation/:menu` — nav menus
- `GET /api/cms/components` — list components
- `PUT /api/cms/components/:name` — update component
- `GET/POST /api/cms/theme` — list/create themes
- `POST /api/cms/theme/:name/activate` — activate theme
- `GET /api/cms/export` — export full site

### Admin / Moderation
- `GET /api/admin/stats` — dashboard stats
- `GET /api/admin/pending` — moderation queue
- `POST /api/admin/moderate/:id` — approve/reject
- `GET /api/admin/users` — user list
- `POST /api/admin/users/:id/ban` — ban user
- `POST /api/admin/users/:id/unban` — unban user
- `POST /api/admin/users/:id/role` — change role
- `GET /api/admin/logs` — audit logs

## Coding Conventions
- No build tools, no bundler — vanilla HTML/CSS/JS for frontend
- Server uses custom `createApp()` from `http.js` (Express-like but hand-rolled)
- All DB access via synchronous `better-sqlite3` prepared statements
- Crypto: Node.js built-in `crypto` module only — no external auth libraries
- File uploads: custom multipart parser in `http.js`
- Error responses: `res.error(message, statusCode)`
- Success responses: `res.json(data)`
