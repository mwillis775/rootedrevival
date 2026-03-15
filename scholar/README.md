# 📚 Open Scholar

**Decentralized Academic Publishing Platform**

Open Scholar is a peer-to-peer academic publishing and knowledge sharing platform built on [GrabNet](https://github.com/mwillis775/grab), a content-addressed P2P network.

## ✨ Features

- **Decentralized Storage** - Files are distributed across the [GrabNet](https://github.com/mwillis775/grab) P2P network
- **User Accounts** - Registration with automatic ed25519 identity generation
- **File Management** - Upload any file type with automatic hashing and pinning
- **Peer Review System** - Community-driven quality assurance with ratings
- **Full-Text Search** - SQLite FTS5 powered search
- **Admin Dashboard** - User and content management
- **Moderation Tools** - Report system, user bans, content flags
- **Client-Side Encryption** - AES-256-GCM file encryption before upload
- **Email Verification** - SMTP-based account verification and password reset
- **Tor Support** - Anonymous access via Tor hidden service

## 🚀 Quick Start

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install system dependencies (Ubuntu/Debian)
sudo apt install libssl-dev pkg-config
```

### Build & Run

```bash
# Clone the repository
git clone https://github.com/mwillis775/open-scholar.git
cd open-scholar

# Build release binary
cargo build --release

# Run (starts on port 8889)
./target/release/scholar
```

### With GrabNet

For full P2P functionality, run GrabNet alongside Scholar:

```bash
# In another terminal
git clone https://github.com/mwillis775/grab.git
cd grab
cargo build --release
./target/release/grab gateway --port 8080
```

## 📡 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Current user info |
| GET | `/api/auth/profile/:user` | User profile |
| PUT | `/api/auth/profile` | Update profile |
| POST | `/api/auth/forgot-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password |
| POST | `/api/auth/verify-email` | Verify email |

### Files
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/files` | Upload file (multipart) |
| GET | `/api/files/:uuid` | File metadata |
| PUT | `/api/files/:uuid` | Update metadata |
| DELETE | `/api/files/:uuid` | Delete file |
| GET | `/api/files/:uuid/stream` | Stream content |
| GET | `/api/files/:uuid/download` | Download file |

### Browse
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/browse/recent` | Recent uploads |
| GET | `/api/browse/search` | Full-text search |
| GET | `/api/browse/tags` | Popular tags |
| GET | `/api/browse/tag/:tag` | Files by tag |
| GET | `/api/browse/needs-review` | Files needing reviews |

### Reviews
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reviews/:file_uuid` | Reviews for file |
| POST | `/api/reviews/:file_uuid` | Create review |
| POST | `/api/reviews/:file_uuid/:id/vote` | Vote on review |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | Dashboard statistics |
| GET | `/api/admin/users` | User management |
| PUT | `/api/admin/users/:id/role` | Update user role |
| GET | `/api/admin/files` | File management |
| DELETE | `/api/admin/files/:uuid` | Delete file |

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│           Open Scholar (Rust)           │
│              Port: 8889                 │
├─────────────────────────────────────────┤
│  Auth │ Files │ Reviews │ Admin │ Static│
├───────┴───────┴─────────┴───────┴───────┤
│     SQLite DB     │   GrabNet Client    │
└───────────────────┴─────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────┐
│              GrabNet (P2P)              │
│         Port: 4001 (P2P) / 8080 (HTTP)  │
└─────────────────────────────────────────┘
```

## 📁 Project Structure

```
scholar/
├── Cargo.toml              # Dependencies
├── openapi.yaml            # API documentation
├── src/
│   ├── main.rs             # Entry point
│   ├── app.rs              # Application state
│   ├── models.rs           # Data models
│   ├── middleware.rs       # Security middleware
│   ├── email.rs            # Email service
│   ├── moderation.rs       # Moderation system
│   ├── grabnet_client.rs   # GrabNet integration
│   ├── db/
│   │   ├── mod.rs          # Database wrapper
│   │   ├── schema.rs       # SQL schema
│   │   ├── users.rs        # User CRUD
│   │   ├── files.rs        # File CRUD
│   │   └── reviews.rs      # Review CRUD
│   └── handlers/
│       ├── mod.rs          # Router
│       ├── auth.rs         # Auth endpoints
│       ├── files.rs        # File endpoints
│       ├── reviews.rs      # Review endpoints
│       ├── admin.rs        # Admin endpoints
│       ├── moderation.rs   # Moderation endpoints
│       └── static_files.rs # Static file serving
├── static/
│   └── js/
│       ├── keys.js         # Key management UI
│       └── encryption.js   # Client-side encryption
└── tests/
    ├── unit_tests.rs       # Unit tests
    └── integration_tests.rs # Integration tests
```

## 🔧 Configuration

Environment variables:

```bash
# Server
PORT=8889
RUST_LOG=scholar=info

# Database
DATABASE_URL=~/.local/share/scholar/scholar.db

# Email (optional)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=user@example.com
SMTP_PASSWORD=secret
SMTP_FROM=noreply@example.com

# GrabNet
GRABNET_GATEWAY=http://localhost:8080
```

## 🐳 Docker

```bash
# Build image
docker build -t open-scholar .

# Run with docker-compose
docker-compose up -d
```

## 🧪 Testing

```bash
# Run all tests
cargo test

# Run with logging
RUST_LOG=debug cargo test -- --nocapture
```

## 📜 License

MIT License - see [LICENSE](LICENSE)

## 🔗 Related Projects

- [GrabNet](https://github.com/mwillis775/grab) - P2P content-addressed network
- [Rooted Revival](https://rootedrevival.us) - Parent project

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a pull request.

---

Built with ❤️ by [Rooted Revival](https://rootedrevival.us)
