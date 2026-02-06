# 🌱 Rooted Revival IPFS Infrastructure

Your self-hosted, decentralized web infrastructure.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Your Machine  │     │ Cloudflare Tunnel│     │   Cloudflare    │
│                 │     │                  │     │                 │
│  ┌───────────┐  │     │                  │     │  ┌───────────┐  │
│  │   IPFS    │◄─┼─────┼──────────────────┼─────┼──│   Edge    │  │
│  │  Daemon   │  │     │    Encrypted     │     │  │  Network  │  │
│  └───────────┘  │     │     Tunnel       │     │  └───────────┘  │
│        │        │     │                  │     │        │        │
│  ┌───────────┐  │     │                  │     │  ┌───────────┐  │
│  │  Pinning  │◄─┼─────┼──────────────────┼─────┼──│   DNS     │  │
│  │  Service  │  │     │                  │     │  │  + SSL    │  │
│  └───────────┘  │     │                  │     │  └───────────┘  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
                                                 ┌─────────────────┐
                                                 │    Visitors     │
                                                 │                 │
                                                 │ rootedrevival.us│
                                                 └─────────────────┘
```

## Quick Start

```bash
# 1. Run the setup script
cd pinning-service
./setup.sh

# 2. Deploy your website
cd ..
./deploy.sh index.html --update-dns
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| IPFS Daemon | 5001 (API), 8080 (Gateway) | Stores and serves content |
| Pinning Service | 3000 | REST API for managing pins |
| Cloudflare Tunnel | - | Exposes services securely |

## URLs

- **Main Site**: https://rootedrevival.us
- **IPFS Gateway**: https://ipfs.rootedrevival.us
- **Pinning API**: https://pin.rootedrevival.us

## API Endpoints

### Public

- `GET /health` - Health check
- `GET /ipfs/:cid` - Fetch content by CID

### Protected (requires `Authorization: Bearer <token>`)

- `POST /pin` - Pin new content
  ```json
  {
    "content": "<html>...</html>",
    "name": "my-page",
    "updateDnslink": true
  }
  ```

- `GET /pins` - List all pins

- `DELETE /pin/:cid` - Unpin content

- `POST /dnslink` - Update Cloudflare DNSLink
  ```json
  { "cid": "Qm..." }
  ```

## Managing Services

```bash
# Check status
sudo systemctl status ipfs
sudo systemctl status pinning
sudo systemctl status cloudflared

# View logs
journalctl -u ipfs -f
journalctl -u pinning -f
journalctl -u cloudflared -f

# Restart
sudo systemctl restart ipfs
sudo systemctl restart pinning
sudo systemctl restart cloudflared
```

## Updating Content

When you update `index.html`:

```bash
./deploy.sh index.html --update-dns
```

This will:
1. Add the file to IPFS
2. Pin it locally
3. Update the DNSLink so rootedrevival.us points to the new CID

## Why This Approach?

1. **No Dynamic IP Issues** - Cloudflare Tunnel connects outbound, so your roaming IP doesn't matter
2. **Decentralized Storage** - Content is on IPFS, addressable by hash
3. **Free SSL** - Cloudflare handles HTTPS automatically
4. **DDoS Protection** - Traffic goes through Cloudflare's edge
5. **Self-Hosted** - You control your data and infrastructure
6. **Content Integrity** - CIDs are cryptographic hashes, content can't be tampered with

## Backup

Your pins are stored in:
- IPFS: `~/.ipfs`
- Pin database: `pinning-service/data/pins.json`
