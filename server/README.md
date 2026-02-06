# OpenSource Scholar

**Open access academia club for free knowledge sharing.**

Upload research, papers, books, and ideas under your discipline. Build clean citations, keep access free for every member, and preserve knowledge with community-hosted IPFS storage.

## 🌟 Features

- **Free Membership**: No paywalls, no ads, no data sales. We store only what you upload.
- **Upload Research**: Papers, books, theses, preprints, datasets, and notes
- **Discipline Organization**: Organize by field with rich metadata
- **Citation Generation**: APA, MLA, Chicago, IEEE, BibTeX, RIS, CSL-JSON
- **Version Control**: Track updates and errata over time
- **Full-Text Search**: Find papers by content, author, keyword, or discipline
- **IPFS Preservation**: Community members can pin and mirror the entire library
- **Open Source**: AGPL-3.0 licensed, transparent governance

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- grab

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/opensource-scholar.git
cd opensource-scholar/server

# Install dependencies
npm install

# Initialize the database
npm run db:init

# Start the server
npm start
```

The server will start at `http://localhost:3000`.

### Environment Variables

Create a `.env` file in the `server` directory:

```bash
# Server
PORT=3000
HOST=0.0.0.0
BASE_URL=http://localhost:3000

# Security (IMPORTANT: Change in production!)
SESSION_SECRET=your-random-64-char-hex-string

# Paths
DATA_DIR=./data
UPLOADS_DIR=./data/uploads
DB_PATH=./data/scholar.db

# IPFS (optional)
IPFS_ENABLED=true
IPFS_API_URL=http://127.0.0.1:5001
IPFS_GATEWAY_URL=http://127.0.0.1:8080

# Rate Limiting
RATE_LIMIT_GENERAL=100
RATE_LIMIT_UPLOAD=10
RATE_LIMIT_AUTH=20

# Features
REGISTRATION_ENABLED=true
```

## 📖 API Reference

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Create new account |
| `/api/auth/login` | POST | Log in |
| `/api/auth/logout` | POST | Log out |
| `/api/auth/me` | GET | Get current user |

### Papers

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/papers` | GET | Search papers |
| `/api/papers` | POST | Create paper (auth) |
| `/api/papers/recent` | GET | Get recent papers |
| `/api/papers/:uuid` | GET | Get paper details |
| `/api/papers/:uuid` | PUT | Update paper (auth) |
| `/api/papers/:uuid/publish` | POST | Publish paper (auth) |
| `/api/papers/:uuid/files` | POST | Upload file (auth) |
| `/api/papers/:uuid/cite/:format` | GET | Get citation |

### Citations

Supported formats: `apa`, `mla`, `chicago`, `ieee`, `bibtex`, `ris`, `csl-json`

### IPFS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ipfs/status` | GET | Check IPFS node status |
| `/api/ipfs/pins` | GET | List pinned CIDs |
| `/api/papers/:uuid/pin` | POST | Pin paper files (auth) |
| `/api/ipfs/mirrors` | POST | Register mirror (auth) |
| `/api/ipfs/mirrors/:cid` | GET | Get mirrors for CID |

### Collections

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/collections` | GET | List public collections |
| `/api/collections` | POST | Create collection (auth) |
| `/api/collections/:uuid` | GET | Get collection |
| `/api/me/collections` | GET | Get my collections (auth) |
| `/api/me/bookmarks` | GET | Get my bookmarks (auth) |

## 🛰️ IPFS Hosting

Anyone can help host the library by running an IPFS node:

1. Install [IPFS/Kubo](https://docs.ipfs.tech/install/)
2. Start your daemon: `ipfs daemon`
3. Pin the library: `ipfs pin add <CID>`
4. Register your mirror via the API

No API keys required. The community controls the infrastructure.

## 🔧 Development

```bash
# Run in development mode (auto-restart)
npm run dev

# Run database initialization
npm run db:init

# Run tests
npm test
```

## 🏗️ Project Structure

```
server/
├── src/
│   ├── index.js          # Entry point
│   ├── config.js         # Configuration
│   ├── http.js           # HTTP server & router
│   ├── routes.js         # API routes
│   ├── admin-routes.js   # Admin/mod routes
│   ├── crypto.js         # Encryption utilities
│   ├── citations.js      # Citation generation
│   ├── ipfs.js           # IPFS integration
│   └── db/
│       ├── index.js      # Database connection
│       ├── schema.sql    # SQLite schema
│       ├── init.js       # DB initialization
│       ├── users.js      # User repository
│       ├── papers.js     # Paper repository
│       ├── collections.js # Collection repository
│       └── moderation.js # Moderation repository
├── public/
│   ├── index.html        # Frontend SPA
│   ├── css/app.css       # Styles
│   └── js/app.js         # Frontend JS
├── data/                 # Database & uploads
└── package.json
```

## 🚢 Production Deployment

### Using systemd

Create `/etc/systemd/system/scholar.service`:

```ini
[Unit]
Description=OpenSource Scholar
After=network.target

[Service]
Type=simple
User=scholar
WorkingDirectory=/opt/scholar/server
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable scholar
sudo systemctl start scholar
```

### Using Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --only=production
COPY server/ .
RUN npm run db:init
EXPOSE 3000
CMD ["node", "src/index.js"]
```

### Reverse Proxy (nginx)

```nginx
server {
    listen 80;
    server_name scholar.example.com;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 100M;
    }
}
```

## 📜 License

AGPL-3.0 — Free as in freedom.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

All contributions must be AGPL-3.0 compatible.

## 🛡️ Security

- Passwords are hashed with bcrypt (12 rounds)
- Sessions use secure random tokens
- All inputs are validated and sanitized
- Rate limiting on all endpoints
- CORS properly configured

Report security issues privately to security@opensourcescholar.org.

## 💬 Community

- Matrix: #opensource-scholar:matrix.org
- Forum: discourse.opensourcescholar.org
- IRC: #scholar on Libera.Chat

---

*"Knowledge wants to be free."*
