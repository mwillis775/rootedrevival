#!/bin/bash
# Deploy script for Rooted Revival (Scholar + GrabNet)
# Usage: ./deploy/install.sh

set -e

echo "========================================="
echo "  Rooted Revival Deployment Script"
echo "========================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   exit 1
fi

# Configuration
INSTALL_DIR="/opt/revival"
SCHOLAR_USER="scholar"
GRABNET_USER="grabnet"
SCHOLAR_DATA="/var/lib/scholar"
GRABNET_DATA="/var/lib/grabnet"

echo -e "\n${YELLOW}Step 1: Creating users and directories${NC}"

# Create users
id -u $SCHOLAR_USER &>/dev/null || useradd -r -s /bin/false $SCHOLAR_USER
id -u $GRABNET_USER &>/dev/null || useradd -r -s /bin/false $GRABNET_USER

# Create directories
mkdir -p $INSTALL_DIR
mkdir -p $SCHOLAR_DATA/{content,static}
mkdir -p $GRABNET_DATA/{sites,chunks,keys}
mkdir -p /etc/scholar
mkdir -p /etc/grabnet

echo -e "${GREEN}✓ Users and directories created${NC}"

echo -e "\n${YELLOW}Step 2: Installing dependencies${NC}"

# Install dependencies
apt-get update
apt-get install -y curl ca-certificates libssl3

echo -e "${GREEN}✓ Dependencies installed${NC}"

echo -e "\n${YELLOW}Step 3: Building from source${NC}"

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
fi

# Build Scholar
echo "Building Scholar..."
cd $(dirname "$0")/..
cd scholar
cargo build --release
cp target/release/scholar /usr/local/bin/

# Build GrabNet
echo "Building GrabNet..."
cd ../grab
cargo build --release
cp target/release/grab /usr/local/bin/

echo -e "${GREEN}✓ Binaries built and installed${NC}"

echo -e "\n${YELLOW}Step 4: Installing systemd services${NC}"

# Copy service files
cp $(dirname "$0")/scholar.service /etc/systemd/system/
cp $(dirname "$0")/grabnet.service /etc/systemd/system/
cp $(dirname "$0")/grabnet-relay.service /etc/systemd/system/
cp $(dirname "$0")/revival-server.service /etc/systemd/system/

# Create environment files
cat > /etc/scholar/scholar.env << EOF
# Scholar configuration
SCHOLAR_PORT=8889
RUST_LOG=scholar=info
SCHOLAR_DATA_DIR=$SCHOLAR_DATA
EOF

cat > /etc/grabnet/grabnet.env << EOF
# GrabNet configuration
GRAB_GATEWAY_PORT=8080
GRAB_P2P_PORT=4001
RUST_LOG=grabnet=info
GRAB_DATA_DIR=$GRABNET_DATA
EOF

# Set permissions
chown -R $SCHOLAR_USER:$SCHOLAR_USER $SCHOLAR_DATA
chown -R $GRABNET_USER:$GRABNET_USER $GRABNET_DATA
chmod 600 /etc/scholar/scholar.env
chmod 600 /etc/grabnet/grabnet.env

# Reload systemd
systemctl daemon-reload

echo -e "${GREEN}✓ Systemd services installed${NC}"

echo -e "\n${YELLOW}Step 5: Setting up static files${NC}"

# Copy static files if they exist
STATIC_SRC="$HOME/.local/share/scholar/static"
if [[ -d "$STATIC_SRC" ]]; then
    cp -r $STATIC_SRC/* $SCHOLAR_DATA/static/
    chown -R $SCHOLAR_USER:$SCHOLAR_USER $SCHOLAR_DATA/static
    echo -e "${GREEN}✓ Static files copied${NC}"
else
    echo -e "${YELLOW}⚠ No static files found at $STATIC_SRC${NC}"
    echo "  Static files will need to be created or copied manually"
fi

echo -e "\n${YELLOW}Step 6: Starting services${NC}"

# Enable and start services
systemctl enable grabnet
systemctl enable scholar
systemctl enable grabnet-relay
systemctl start grabnet
sleep 3
systemctl start scholar
systemctl start grabnet-relay

echo -e "${GREEN}✓ Services started${NC}"

echo -e "\n${YELLOW}Step 7: Checking status${NC}"

# Check services
systemctl status grabnet --no-pager || true
echo ""
systemctl status scholar --no-pager || true

echo -e "\n========================================="
echo -e "${GREEN}  Installation Complete!${NC}"
echo "========================================="
echo ""
echo "Services:"
echo "  Scholar:  http://localhost:8889"
echo "  GrabNet:  http://localhost:8080"
echo ""
echo "Commands:"
echo "  sudo systemctl status scholar"
echo "  sudo systemctl status grabnet"
echo "  sudo journalctl -u scholar -f"
echo "  sudo journalctl -u grabnet -f"
echo ""
echo "Configuration:"
echo "  /etc/scholar/scholar.env"
echo "  /etc/grabnet/grabnet.env"
echo ""
echo "Data:"
echo "  $SCHOLAR_DATA"
echo "  $GRABNET_DATA"
echo ""
