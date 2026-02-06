# Rooted Revival OS - Desktop Application

A cross-platform desktop application integrating **Rooted Revival** sustainable technology platform and **OpenSource Scholar** open access academia, with a built-in IPFS node for decentralized content hosting.

## Features

### 🌱 Rooted Revival
- Sustainable technology R&D documentation
- Controlled Environment Agriculture (CEA) resources
- Botanical genetics research
- Fabrication lab designs and CAD files
- Open source hardware designs

### 📚 OpenSource Scholar
- Upload and share research papers, books, and datasets
- Generate citations in APA, MLA, Chicago, IEEE, BibTeX, RIS
- Browse papers across academic disciplines
- Community moderation and peer review

### 🛰️ Built-in IPFS Node
- Automatic IPFS node startup
- Content pinning and hosting
- Help preserve open access knowledge
- Decentralized, censorship-resistant storage

## Installation

### From Releases (Recommended)
Download the latest release for your platform:
- **Windows**: `.exe` installer or portable `.zip`
- **macOS**: `.dmg` disk image
- **Linux**: `.AppImage`, `.deb`, or `.rpm`

### From Source

```bash
# Clone the repository
git clone https://github.com/rootedrevival/rootedrevival.git
cd rootedrevival/desktop

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for your platform
npm run build

# Build for all platforms
npm run build:all
```

## System Requirements

- **OS**: Windows 10+, macOS 10.13+, Ubuntu 18.04+ (or equivalent)
- **RAM**: 4 GB minimum, 8 GB recommended
- **Storage**: 1 GB for app + space for IPFS repository
- **Network**: Internet connection for IPFS peering

## Architecture

```
desktop/
├── main.js           # Electron main process
├── preload.js        # Secure IPC bridge
├── package.json      # App configuration
├── renderer/
│   ├── launcher.html # Main launcher UI
│   └── revival.html  # Rooted Revival content
└── build/
    ├── icon.png      # App icons
    └── ...
```

## IPFS Integration

When you run Rooted Revival OS, you become a node in the global IPFS network. Your participation:

1. **Helps preserve knowledge** - Papers and resources are mirrored across nodes
2. **Improves availability** - Content loads faster with more seeds
3. **Resists censorship** - No single point of failure

### IPFS Settings

Access via Menu → IPFS or the launcher dashboard:
- **Auto-start**: Enable/disable IPFS on app launch
- **Pin content**: Choose what to store locally
- **View peers**: See connected nodes

## Development

### Technology Stack
- **Electron 28** - Cross-platform desktop framework
- **IPFS Core** - Embedded JavaScript IPFS node
- **Express** - Local server for OpenSource Scholar
- **better-sqlite3** - Local database

### Scripts

```bash
# Development with DevTools
npm run dev

# Production build
npm run build

# Platform-specific builds
npm run build:win
npm run build:mac
npm run build:linux
```

### Environment Variables

```bash
NODE_ENV=development  # Enables DevTools
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

### Areas for Contribution
- UI/UX improvements
- IPFS optimization
- New features
- Documentation
- Translations

## License

AGPL-3.0 - This software must remain open source. Any modifications or derivative works must also be open source.

## Contact

- **Email**: michaelwillisbotany@proton.me
- **GitHub**: https://github.com/rootedrevival
- **Discord**: https://discord.gg/rootedrevival

## Related Projects

- [OpenSource Scholar Server](../server/) - Backend API
- [IPFS Pinning Service](../pinning-service/) - Community pinning
- [Kubo IPFS](../kubo/) - Reference IPFS implementation

---

**Earth over greed. Biological integrity over speculative growth.**

*Built with ❤️ in Tulsa, Oklahoma*
