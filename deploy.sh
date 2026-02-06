#!/bin/bash
# Deploy content to your IPFS pinning service
# Usage: ./deploy.sh [file] [--update-dns]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load config
if [ -f pinning-service/.env ]; then
    source pinning-service/.env
fi

# Default to index.html if no file specified
FILE="${1:-index.html}"
UPDATE_DNS="${2:---update-dns}"

if [ ! -f "$FILE" ]; then
    echo "Error: File '$FILE' not found"
    exit 1
fi

echo "🌱 Deploying $FILE to IPFS..."

# Read file content
CONTENT=$(cat "$FILE" | jq -Rs .)

# Determine if we should update DNSLink
UPDATE_DNSLINK="false"
if [ "$UPDATE_DNS" == "--update-dns" ]; then
    UPDATE_DNSLINK="true"
fi

# Pin via local API
RESULT=$(curl -s -X POST "http://localhost:3000/pin" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"content\": $CONTENT, \"name\": \"$FILE\", \"updateDnslink\": $UPDATE_DNSLINK}")

CID=$(echo "$RESULT" | jq -r '.cid')

if [ "$CID" == "null" ] || [ -z "$CID" ]; then
    echo "Error: Failed to pin content"
    echo "$RESULT"
    exit 1
fi

echo ""
echo "✓ Successfully pinned!"
echo ""
echo "CID: $CID"
echo ""
echo "Access via:"
echo "  • Local:    http://localhost:8080/ipfs/$CID"
echo "  • Tunnel:   https://ipfs.rootedrevival.us/ipfs/$CID"
if [ "$UPDATE_DNSLINK" == "true" ]; then
    echo "  • Domain:   https://rootedrevival.us"
fi
echo ""
