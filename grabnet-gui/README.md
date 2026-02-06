# GrabNet Desktop

A graphical user interface for publishing and managing decentralized websites on **GrabNet** - the permanent web.

![GrabNet Desktop](https://grabnet.io/assets/desktop-preview.png)

## Features

### 🚀 Easy Website Publishing
- **Drag & drop publishing** - Select your website folder and publish with one click
- **Project management** - Keep track of all your sites in one place
- **Live updates** - Watch mode automatically republishes on file changes
- **SPA support** - Built-in support for single-page applications with fallback routing
- **Clean URLs** - Automatically remove `.html` extensions

### 🛰️ Decentralized Hosting
- **Pin remote sites** - Help host other people's websites
- **Built-in P2P node** - Your computer becomes part of the network
- **Local gateway** - Browse GrabNet sites through your local HTTP server
- **No servers required** - Sites are served directly from the P2P network

### 🔑 Identity Management
- **Cryptographic keys** - Secure site ownership with Ed25519 keys
- **Key generation** - Create new identities for publishing
- **Key export/import** - Backup and restore your publishing keys

### 🌐 HTTP Gateway
- **Local web server** - Serve GrabNet sites over regular HTTP
- **Default site** - Configure which site appears at the root URL
- **Custom ports** - Run the gateway on any available port

## Installation

### Pre-built Binaries

Download the latest release for your platform:

- **Windows**: `GrabNet-Setup-1.0.0.exe` or `GrabNet-1.0.0-portable.exe`
- **macOS**: `GrabNet-1.0.0.dmg`
- **Linux**: `GrabNet-1.0.0.AppImage`, `.deb`, or `.rpm`

### Build from Source

```bash
# Clone the repository
git clone https://github.com/grabnet/grabnet-gui
cd grabnet-gui

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

## Requirements

### GrabNet Binary

GrabNet Desktop requires the `grab` CLI binary to be installed. The app will attempt to auto-detect it in common locations:

1. Bundled with the app (in packaged releases)
2. `~/.cargo/bin/grab` (if installed via Cargo)
3. `/usr/local/bin/grab` or `/usr/bin/grab`
4. Custom path configured in Settings

To install the `grab` binary:

```bash
# Using Cargo (Rust package manager)
cargo install grabnet

# Or build from source
git clone https://github.com/grabnet/grab
cd grab
cargo build --release
```

## Usage

### Publishing Your First Site

1. **Open GrabNet Desktop**
2. **Create a new project** - Click "New Project" and select your website folder
3. **Configure options** - Set the entry point, enable SPA mode if needed
4. **Publish** - Click "Publish to GrabNet"
5. **Share your Site ID** - Copy the unique Site ID to share with others

### Hosting Sites

Help the network by hosting (pinning) other people's sites:

1. Go to **Browse Network**
2. Enter the **Site ID** you want to host
3. Click **Pin Site**

The site will be downloaded and served from your node.

### Using the Gateway

The HTTP gateway lets you access GrabNet sites through a regular web browser:

1. Go to **Gateway**
2. Configure the port (default: 8080)
3. Click **Start Gateway**
4. Visit `http://localhost:8080/SITE_ID/` in your browser

## Architecture

```
grabnet-gui/
├── main.js           # Electron main process
├── preload.js        # Secure bridge between main and renderer
├── package.json      # Project configuration
└── renderer/
    ├── index.html    # Main UI
    └── app.js        # Application logic
```

GrabNet Desktop is built with:

- **Electron** - Cross-platform desktop framework
- **Vanilla JavaScript** - No heavy frameworks, just clean code
- **Terminal aesthetic** - Retro-futuristic design inspired by classic terminals

## Development

```bash
# Start in development mode with DevTools
npm run dev

# Build for all platforms
npm run build:all

# Build for specific platform
npm run build:linux
npm run build:mac
npm run build:win
```

## License

MIT License - See [LICENSE](LICENSE) for details.

## Related Projects

- [grab](https://github.com/grabnet/grab) - The GrabNet CLI and core library
- [Open Scholar](https://github.com/grabnet/open-scholar) - Decentralized academic publishing on GrabNet

---

**GrabNet** - Publish websites that live forever on the permanent web.
