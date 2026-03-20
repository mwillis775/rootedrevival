# Rooted Revival - Copilot Instructions

## Mission
Rooted Revival is not a single app. This repository combines the public site, the Node-based CMS and admin backend, the Rust-based Open Scholar service, the GrabNet P2P network, browser P2P helpers, relay and pinning services, and desktop clients. Treat changes as belonging to a specific subsystem. Do not assume one folder is an implementation detail of another.

## System Map
- Repo root: static HTML pages such as `index.html`, `admin.html`, `profile.html`, `view.html`. No bundler, no framework.
- `site/`: the GrabNet-published site tree. CMS site-file editing and GrabNet publishing operate on this directory.
- `server/`: Node.js API server, SQLite DB, CMS routes, moderation, WebAuthn/U2F, and GrabNet orchestration.
- `scholar/`: Rust academic API and moderation service with its own handlers, models, tests, and OpenAPI spec.
- `grab/`: Rust GrabNet core for site publishing, content addressing, replication, gateway, storage, and networking.
- `relay/`: WebSocket relay for browser libp2p peers.
- `pinning-service/`: Node.js content pinning service.
- `desktop/`, `desktop-tauri/`, `grabnet-gui/`: desktop clients and launcher surfaces.
- `static/`: shared browser-side GrabNet and P2P scripts.

## Frontend Ownership Rules
- There is no frontend build step. Prefer direct HTML, CSS, and JS edits in the owning file.
- Before editing a page, identify which surface owns it: repo root, `site/`, `server/public/`, desktop renderer, or shared `static/` assets.
- `site/` is the source used by CMS site-file APIs and by GrabNet publish/update flows.
- Root-level pages often overlap with files in `site/`. Do not assume they stay in sync automatically. If a page exists in both places and the change is meant to affect the public site, inspect both and keep them aligned unless there is a documented reason to diverge.
- `server/public/` belongs to the standalone Node server frontend, not the main static site.
- Preserve the existing design language unless the user explicitly asks for a redesign: terminal-inspired aesthetics, CSS custom properties, Share Tech Mono and Inter, and theme-aware styling.
- `admin.html` is a large single-file admin app. Make targeted edits and avoid broad rewrites.

## Server Conventions
- The server uses a custom micro-framework in `server/src/http.js`, not Express. Reuse `createApp()`, `auth()`, `cors()`, `rateLimit()`, and `parseMultipart()` patterns.
- Database access is synchronous SQLite through `better-sqlite3`. Follow the existing repository modules in `server/src/db/` instead of issuing ad hoc SQL throughout route files.
- Response conventions are `res.json(...)` for success and `res.error(message, statusCode)` for failure.
- Use `server/src/config.js` for environment-driven configuration. Do not hardcode local paths, secrets, or domains when a config value already exists.
- Existing upload, MIME-type, and size restrictions are intentional. Extend them only when the task requires it.

## Security-Critical Rules
- Do not weaken authentication, authorization, CORS, upload validation, or path traversal protections.
- Auth is tiered:
	1. Session auth via the `session` cookie or bearer token.
	2. Admin or moderator role checks from the user record.
	3. Hardware-key elevation via `u2f_verified` for destructive admin actions.
- `req.u2fVerified` is populated in `server/src/http.js` from the `u2f_verified` cookie. Preserve that flow.
- Destructive CMS and admin operations are intentionally gated by `requireU2FAdmin()`, `requireElevatedAdmin()`, or `requireProtectedAdminAction()`. Do not replace those with weaker checks.
- WebAuthn is implemented in-house in `server/src/webauthn.js`. Be cautious with ceremony logic, challenge verification, CBOR parsing, signature handling, RP ID/origin checks, and sign-count updates.
- CORS is credentialed. Do not combine wildcard origins with credentialed requests.
- Keep secrets and operational values in environment variables. Never commit tokens, passwords, or private keys.
- Preserve file-safety checks around CMS site-file editing. Current code intentionally limits editable extensions and uses `path.basename()` to block traversal.

## Publishing And P2P Rules
- `server/src/grab.js` publishes the `site/` directory under the site name `rootedrevival`.
- The publish flow kills the GrabNet gateway, waits for the DB lock to clear, then republishes and restarts the gateway. Avoid concurrent publish-related changes and do not assume the gateway stays up during publish.
- User-uploaded site content is stored under `site/content/<username>/` and includes sidecar metadata files.
- Do not make speculative changes to `grab/`, the relay protocol, or browser libp2p behavior unless the user explicitly asks for network-layer work.

## Scholar And Multi-Service Boundaries
- `server/` and `scholar/` are separate backends with different stacks and runtime models. Do not conflate their APIs, tests, or persistence logic.
- `scholar/` is Rust-based and should follow its existing handler, middleware, and DB patterns.
- Desktop clients are separate products. UI or IPC changes there should stay localized to the relevant app.
- The relay and pinning services are operational components. Avoid breaking protocol assumptions or port expectations without updating related docs and configs.

## Current Product Reality
- The admin/CMS layer includes more than pages and media. It also handles navigation, themes, components, site files, contact messages, and user-to-user messaging.
- Messaging exists in the Node server CMS layer, including inbox, sent, compose, and admin-side message management. Be careful not to remove or bypass those flows when editing profile, admin, or CMS behavior.
- Rooted Revival mixes public-facing site content, academic archive functionality, and decentralized hosting infrastructure. Seemingly small UI changes can affect moderation, publishing, or user workflows.

## Working Style For This Repo
- Trace the full path before changing behavior: UI -> route -> DB/service module -> published/static surface.
- Prefer small, surgical changes over broad refactors, especially in `admin.html`, `server/src/http.js`, `server/src/cms-routes.js`, `server/src/admin-routes.js`, and security-sensitive Rust handlers.
- When changing a feature that spans mirrored files or multiple surfaces, update all relevant copies in the same task or clearly document what was intentionally left separate.
- Update docs when behavior, commands, ports, security expectations, or editing ownership rules change.
- Do not introduce unnecessary dependencies, bundlers, or framework migrations.

## Useful Commands
- Server: `cd server && npm run db:init`, `npm run dev`, `npm test`
- Scholar: `cd scholar && cargo run`, `cargo test`
- GrabNet: `cd grab && cargo build --release`, `cargo test`
- Relay: `cd relay && npm start`
- Desktop: `cd desktop && npm run dev`
- GrabNet GUI: `cd grabnet-gui && npm run dev`

## Avoid
- Do not bypass U2F or moderator/admin checks for convenience.
- Do not edit only one copy of a duplicated page without verifying ownership and deployment impact.
- Do not replace the custom Node server patterns with Express-style assumptions.
- Do not hardcode production-only domains or local-machine paths where configuration already exists.
- Do not make unrelated GrabNet, relay, or Scholar changes during a frontend or CMS task.
