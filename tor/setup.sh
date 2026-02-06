#!/bin/bash
# Tor Hidden Service Setup for Open Scholar & GrabNet
# Run with sudo

set -e

echo "🧅 Tor Hidden Service Setup"
echo "=========================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Please run with sudo"
    exit 1
fi

# Check if Tor is installed
if ! command -v tor &> /dev/null; then
    echo "📦 Installing Tor..."
    
    if command -v apt &> /dev/null; then
        apt update && apt install -y tor
    elif command -v dnf &> /dev/null; then
        dnf install -y tor
    elif command -v pacman &> /dev/null; then
        pacman -S --noconfirm tor
    else
        echo "❌ Could not detect package manager. Please install Tor manually."
        exit 1
    fi
fi

echo "✅ Tor is installed: $(tor --version | head -1)"

# Backup existing torrc
if [ -f /etc/tor/torrc ]; then
    cp /etc/tor/torrc /etc/tor/torrc.backup.$(date +%Y%m%d_%H%M%S)
    echo "📋 Backed up existing torrc"
fi

# Check if hidden services already configured
if grep -q "HiddenServiceDir /var/lib/tor/scholar" /etc/tor/torrc 2>/dev/null; then
    echo "⚠️  Scholar hidden service already configured"
else
    echo "" >> /etc/tor/torrc
    echo "# ========================================" >> /etc/tor/torrc
    echo "# Open Scholar Hidden Service" >> /etc/tor/torrc
    echo "# ========================================" >> /etc/tor/torrc
    echo "HiddenServiceDir /var/lib/tor/scholar/" >> /etc/tor/torrc
    echo "HiddenServicePort 80 127.0.0.1:8889" >> /etc/tor/torrc
    echo "✅ Added Scholar hidden service configuration"
fi

if grep -q "HiddenServiceDir /var/lib/tor/grabnet" /etc/tor/torrc 2>/dev/null; then
    echo "⚠️  GrabNet hidden service already configured"
else
    echo "" >> /etc/tor/torrc
    echo "# ========================================" >> /etc/tor/torrc
    echo "# GrabNet Gateway Hidden Service" >> /etc/tor/torrc
    echo "# ========================================" >> /etc/tor/torrc
    echo "HiddenServiceDir /var/lib/tor/grabnet/" >> /etc/tor/torrc
    echo "HiddenServicePort 80 127.0.0.1:8888" >> /etc/tor/torrc
    echo "✅ Added GrabNet hidden service configuration"
fi

# Restart Tor
echo ""
echo "🔄 Restarting Tor service..."
systemctl restart tor

# Wait for Tor to start and generate keys
echo "⏳ Waiting for Tor to generate hidden service keys..."
sleep 5

# Display .onion addresses
echo ""
echo "=========================================="
echo "🧅 Your .onion addresses:"
echo "=========================================="
echo ""

if [ -f /var/lib/tor/scholar/hostname ]; then
    SCHOLAR_ONION=$(cat /var/lib/tor/scholar/hostname)
    echo "📚 Open Scholar:"
    echo "   http://$SCHOLAR_ONION"
else
    echo "⚠️  Scholar .onion not ready yet. Try: sudo cat /var/lib/tor/scholar/hostname"
fi

echo ""

if [ -f /var/lib/tor/grabnet/hostname ]; then
    GRABNET_ONION=$(cat /var/lib/tor/grabnet/hostname)
    echo "🌐 GrabNet Gateway:"
    echo "   http://$GRABNET_ONION"
else
    echo "⚠️  GrabNet .onion not ready yet. Try: sudo cat /var/lib/tor/grabnet/hostname"
fi

echo ""
echo "=========================================="
echo "✅ Setup complete!"
echo ""
echo "Make sure Scholar (port 8889) and GrabNet (port 8888) are running."
echo "Users can now access your services via Tor Browser."
echo ""

# Enable Tor on boot
systemctl enable tor 2>/dev/null || true
echo "🚀 Tor is enabled to start on boot"
