# Tor Hidden Service Setup for Open Scholar & GrabNet

This directory contains configuration and scripts for running Open Scholar and GrabNet as Tor hidden services (.onion addresses).

## Overview

Running as a Tor hidden service provides:
- **Privacy**: Users can access Scholar/GrabNet without revealing their IP
- **Censorship resistance**: No DNS needed, works even if domain is blocked
- **Anonymity**: Server IP is hidden from users

## Prerequisites

```bash
# Install Tor (Debian/Ubuntu)
sudo apt update && sudo apt install -y tor

# Install Tor (Fedora/RHEL)
sudo dnf install -y tor

# Install Tor (Arch)
sudo pacman -S tor
```

## Quick Start

1. **Run the setup script:**
   ```bash
   sudo ./setup.sh
   ```

2. **Start Tor:**
   ```bash
   sudo systemctl start tor
   ```

3. **Get your .onion addresses:**
   ```bash
   sudo cat /var/lib/tor/scholar/hostname
   sudo cat /var/lib/tor/grabnet/hostname
   ```

## Manual Configuration

If you prefer manual setup, add these lines to `/etc/tor/torrc`:

```
# Open Scholar Hidden Service
HiddenServiceDir /var/lib/tor/scholar/
HiddenServicePort 80 127.0.0.1:8889

# GrabNet Gateway Hidden Service
HiddenServiceDir /var/lib/tor/grabnet/
HiddenServicePort 80 127.0.0.1:8888
```

Then restart Tor:
```bash
sudo systemctl restart tor
```

## Files

- `setup.sh` - Automated setup script
- `torrc.conf` - Example Tor configuration
- `scholar.service` - Systemd unit for Scholar with Tor awareness
- `README.md` - This file

## Security Considerations

1. **Don't leak your hostname**: Never expose your server's real hostname through error pages or headers
2. **Disable version exposure**: Scholar already strips version info from public APIs
3. **Use HTTPS internally**: Even on Tor, encrypt local connections if possible
4. **Monitor access logs**: Watch for unusual patterns

## Accessing via Tor

Users can access your services via Tor Browser:
- Scholar: `http://[your-scholar-onion].onion`
- GrabNet: `http://[your-grabnet-onion].onion`

## Integration with Scholar

Scholar automatically detects if it's being accessed via Tor (by checking for `.onion` in the Host header) and can adjust behavior accordingly.

## Troubleshooting

### Tor won't start
```bash
sudo journalctl -u tor -f
```

### Can't find .onion address
```bash
# Check if hidden service dirs exist
sudo ls -la /var/lib/tor/
```

### Connection refused
Make sure Scholar and GrabNet are running and bound to 127.0.0.1
