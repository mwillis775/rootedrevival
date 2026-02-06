#!/bin/bash
# OpenSource Scholar - Setup Script
# Run this to initialize a fresh installation

set -e

echo "📚 OpenSource Scholar - Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check Node.js version
echo -e "\n${YELLOW}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}✗ Node.js 18+ required. Found: $(node -v)${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm $(npm -v)${NC}"

# Install dependencies
echo -e "\n${YELLOW}Installing dependencies...${NC}"
npm install

echo -e "${GREEN}✓ Dependencies installed${NC}"

# Create .env if not exists
if [ ! -f .env ]; then
    echo -e "\n${YELLOW}Creating .env file...${NC}"
    
    # Generate random session secret
    SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p | tr -d '\n' | head -c 64)
    
    cat > .env << EOF
# OpenSource Scholar Configuration
# Generated on $(date)

# Server
PORT=3000
HOST=0.0.0.0
BASE_URL=http://localhost:3000

# Security (auto-generated, keep secret!)
SESSION_SECRET=${SESSION_SECRET}
BCRYPT_ROUNDS=12

# Paths
DATA_DIR=./data
UPLOADS_DIR=./data/uploads
DB_PATH=./data/scholar.db

# IPFS
IPFS_ENABLED=true
IPFS_API_URL=http://127.0.0.1:5001
IPFS_GATEWAY_URL=http://127.0.0.1:8080

# Rate Limiting (requests per minute)
RATE_LIMIT_GENERAL=100
RATE_LIMIT_UPLOAD=10
RATE_LIMIT_AUTH=20

# Features
REGISTRATION_ENABLED=true
EOF
    
    echo -e "${GREEN}✓ Created .env with secure defaults${NC}"
else
    echo -e "${GREEN}✓ .env already exists${NC}"
fi

# Initialize database
echo -e "\n${YELLOW}Initializing database...${NC}"
npm run db:init

echo -e "${GREEN}✓ Database initialized${NC}"

# Create data directories
mkdir -p data/uploads
echo -e "${GREEN}✓ Data directories created${NC}"

# Check for IPFS
echo -e "\n${YELLOW}Checking IPFS...${NC}"
if command -v ipfs &> /dev/null; then
    echo -e "${GREEN}✓ IPFS found: $(ipfs version 2>/dev/null || echo 'installed')${NC}"
    
    # Check if daemon is running
    if curl -s http://127.0.0.1:5001/api/v0/id > /dev/null 2>&1; then
        echo -e "${GREEN}✓ IPFS daemon is running${NC}"
    else
        echo -e "${YELLOW}! IPFS daemon not running. Start with: ipfs daemon${NC}"
    fi
else
    echo -e "${YELLOW}! IPFS not installed. Install from https://docs.ipfs.tech/install/${NC}"
    echo -e "  The platform will work without IPFS, but community hosting will be unavailable."
fi

# Summary
echo -e "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo "To start the server:"
echo -e "  ${YELLOW}npm start${NC}"
echo ""
echo "Or in development mode:"
echo -e "  ${YELLOW}npm run dev${NC}"
echo ""
echo "The server will be available at:"
echo -e "  ${GREEN}http://localhost:3000${NC}"
echo ""
echo "To create an admin user, register normally then run:"
echo -e "  ${YELLOW}sqlite3 data/scholar.db \"UPDATE users SET is_admin=1 WHERE username='yourusername'\"${NC}"
echo ""
