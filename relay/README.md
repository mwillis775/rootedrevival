# GrabNet WebSocket Relay

This service bridges browser-based libp2p-js clients to the native Rust GrabNet P2P network.

## Purpose

Browsers can't directly connect to native libp2p nodes using TCP. This relay:

1. Accepts WebSocket connections from browser clients
2. Provides circuit relay v2 for NAT traversal
3. Bridges GossipSub messages between browser and native peers
4. Participates in the Kademlia DHT for content discovery

## Running

```bash
# Install dependencies
npm install

# Run the relay
npm start

# Or with file watching for development
npm run dev
```

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 4001 | TCP | Native libp2p peers |
| 4002 | WebSocket | Browser clients |
| 8099 | HTTP | Status API |

## Status API

- `GET /health` - Health check
- `GET /status` - Full relay status (peer ID, connections, stats)
- `GET /peers` - List of connected peers

## Environment Variables

- `DATA_DIR` - Directory for persistent data (default: `./data/relay`)
- `BOOTSTRAP_NODES` - Comma-separated multiaddrs of bootstrap nodes

## Production Deployment

For production with nginx + SSL:

```nginx
server {
    listen 443 ssl http2;
    server_name relay.rootedrevival.us;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://127.0.0.1:4002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

## Systemd Service

```ini
[Unit]
Description=GrabNet WebSocket Relay
After=network.target

[Service]
Type=simple
User=grabnet
WorkingDirectory=/opt/grabnet-relay
ExecStart=/usr/bin/node ws-relay.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```
