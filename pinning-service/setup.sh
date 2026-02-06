#!/bin/bash
# Rooted Revival IPFS Pinning Service Setup Script
# This sets up your own IPFS pinning infrastructure with Cloudflare Tunnel

set -e

echo "🌱 Rooted Revival Pinning Service Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Step 1: Install IPFS if not present
echo -e "\n${YELLOW}Step 1: Checking IPFS installation...${NC}"
if ! command -v ipfs &> /dev/null && [ ! -f /tmp/kubo/ipfs ]; then
    echo "Installing IPFS Kubo..."
    cd /tmp
    wget -q https://dist.ipfs.tech/kubo/v0.24.0/kubo_v0.24.0_linux-amd64.tar.gz
    tar -xzf kubo_v0.24.0_linux-amd64.tar.gz
    sudo ./kubo/install.sh
    cd "$SCRIPT_DIR"
fi

# Initialize IPFS if needed
if [ ! -d ~/.ipfs ]; then
    echo "Initializing IPFS..."
    ipfs init || /tmp/kubo/ipfs init
fi
echo -e "${GREEN}✓ IPFS ready${NC}"

# Step 2: Create .env file if not exists
echo -e "\n${YELLOW}Step 2: Configuring environment...${NC}"
if [ ! -f .env ]; then
    # Generate a random auth token
    AUTH_TOKEN=$(openssl rand -hex 32)
    
    cat > .env << EOF
# Rooted Revival Pinning Service Configuration
PIN_SERVICE_PORT=3000
IPFS_API_URL=http://127.0.0.1:5001
IPFS_GATEWAY_URL=http://127.0.0.1:8080

# Cloudflare configuration (set your own values)
CF_EMAIL=\${CF_EMAIL:-your-cloudflare-email}
CF_API_KEY=\${CF_API_KEY:-your-cloudflare-api-key}
CF_ZONE_ID=\${CF_ZONE_ID:-your-cloudflare-zone-id}
CF_WEB3_HOSTNAME_ID=\${CF_WEB3_HOSTNAME_ID:-your-web3-hostname-id}

# Authentication token for API access
AUTH_TOKEN=$AUTH_TOKEN

# Data directory
DATA_DIR=$SCRIPT_DIR/data
EOF
    echo -e "${GREEN}✓ Created .env file${NC}"
    echo -e "${YELLOW}  Auth token: $AUTH_TOKEN${NC}"
    echo "  (Save this token! You'll need it to access the API)"
else
    echo -e "${GREEN}✓ .env already exists${NC}"
fi

# Step 3: Create data directory
mkdir -p data
echo -e "${GREEN}✓ Data directory ready${NC}"

# Step 4: Install systemd services
echo -e "\n${YELLOW}Step 3: Installing systemd services...${NC}"
sudo cp ipfs.service /etc/systemd/system/
sudo cp pinning.service /etc/systemd/system/
sudo systemctl daemon-reload
echo -e "${GREEN}✓ Systemd services installed${NC}"

# Step 5: Setup Cloudflare Tunnel
echo -e "\n${YELLOW}Step 4: Setting up Cloudflare Tunnel...${NC}"
if ! command -v cloudflared &> /dev/null; then
    echo "Installing cloudflared..."
    curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    sudo dpkg -i /tmp/cloudflared.deb
fi

# Check if tunnel is already authenticated
if [ ! -f ~/.cloudflared/cert.pem ]; then
    echo ""
    echo "You need to authenticate cloudflared with your Cloudflare account."
    echo "A browser window will open. Log in and authorize the tunnel."
    echo ""
    read -p "Press Enter to continue..."
    cloudflared tunnel login
fi

# Create tunnel if it doesn't exist
TUNNEL_NAME="rootedrevival-ipfs"
if ! cloudflared tunnel list | grep -q "$TUNNEL_NAME"; then
    echo "Creating tunnel: $TUNNEL_NAME"
    cloudflared tunnel create "$TUNNEL_NAME"
fi

# Get tunnel ID
TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
echo -e "${GREEN}✓ Tunnel ID: $TUNNEL_ID${NC}"

# Create tunnel config
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: /home/michael/.cloudflared/${TUNNEL_ID}.json

ingress:
  # IPFS Gateway - serves your pinned content
  - hostname: ipfs.rootedrevival.us
    service: http://localhost:8080
  
  # Pinning API - for managing pins
  - hostname: pin.rootedrevival.us
    service: http://localhost:3000
  
  # Catch-all
  - service: http_status:404
EOF

echo -e "${GREEN}✓ Tunnel config created${NC}"

# Step 6: Create DNS records for tunnel
echo -e "\n${YELLOW}Step 5: Creating DNS records...${NC}"
cloudflared tunnel route dns "$TUNNEL_NAME" ipfs.rootedrevival.us || true
cloudflared tunnel route dns "$TUNNEL_NAME" pin.rootedrevival.us || true
echo -e "${GREEN}✓ DNS records configured${NC}"

# Step 7: Install tunnel as service
echo -e "\n${YELLOW}Step 6: Installing tunnel service...${NC}"
sudo cloudflared service install || true
echo -e "${GREEN}✓ Tunnel service installed${NC}"

# Step 8: Start everything
echo -e "\n${YELLOW}Step 7: Starting services...${NC}"
sudo systemctl enable ipfs
sudo systemctl start ipfs
sleep 3

sudo systemctl enable pinning
sudo systemctl start pinning

sudo systemctl enable cloudflared
sudo systemctl start cloudflared

echo -e "${GREEN}✓ All services started${NC}"

# Final summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}🌱 Setup Complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Your IPFS Pinning Service is now running!"
echo ""
echo "Endpoints:"
echo "  • IPFS Gateway: https://ipfs.rootedrevival.us"
echo "  • Pinning API:  https://pin.rootedrevival.us"
echo "  • Main Site:    https://rootedrevival.us"
echo ""
echo "To pin new content:"
echo "  curl -X POST https://pin.rootedrevival.us/pin \\"
echo "    -H 'Authorization: Bearer YOUR_AUTH_TOKEN' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"content\": \"<html>...</html>\", \"updateDnslink\": true}'"
echo ""
echo "Check service status:"
echo "  sudo systemctl status ipfs"
echo "  sudo systemctl status pinning"
echo "  sudo systemctl status cloudflared"
echo ""
