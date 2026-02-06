#!/usr/bin/env node
/**
 * Rooted Revival GrabNet Pinning Service
 * 
 * A self-hosted GrabNet pinning service that:
 * - Hosts (pins) sites from the GrabNet network
 * - Exposes an API for pinning/unpinning sites
 * - Lists currently hosted sites
 */

const http = require('http');
const { exec, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration - loaded from environment or config file
const CONFIG = {
    port: process.env.PIN_SERVICE_PORT || 3000,
    grabBin: process.env.GRAB_BIN || path.join(__dirname, '../grab/target/release/grab'),
    dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
    authToken: process.env.AUTH_TOKEN || 'change-me-in-production'
};

// Ensure data directory exists
if (!fs.existsSync(CONFIG.dataDir)) {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
}

// GrabNet command helpers
function grabCommand(args) {
    return new Promise((resolve, reject) => {
        exec(`${CONFIG.grabBin} ${args}`, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

// Check if grab binary is available
function isGrabAvailable() {
    try {
        if (!fs.existsSync(CONFIG.grabBin)) {
            return false;
        }
        execSync(`${CONFIG.grabBin} --version`, { stdio: 'pipe' });
        return true;
    } catch (e) {
        return false;
    }
}

// List all hosted sites
async function listHostedSites() {
    const result = await grabCommand('list --hosted --json');
    try {
        return JSON.parse(result);
    } catch {
        // Parse text output if JSON not available
        const lines = result.split('\n').filter(Boolean);
        return lines.map(line => {
            const match = line.match(/grab:\/\/(\w+)/);
            return match ? { siteId: match[1] } : null;
        }).filter(Boolean);
    }
}

// Pin (host) a site from the network
async function pinSite(siteId) {
    return grabCommand(`pin ${siteId}`);
}

// Unhost a site
async function unhostSite(siteId) {
    return grabCommand(`unhost ${siteId}`);
}

// Get site info
async function getSiteInfo(siteId) {
    const result = await grabCommand(`info ${siteId}`);
    return result;
}

// Get node stats
async function getStats() {
    const result = await grabCommand('stats');
    return result;
}

// Authentication middleware
function authenticate(req) {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${CONFIG.authToken}`) {
        return false;
    }
    return true;
}

// Parse request body
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

// Send JSON response
function sendJson(res, data, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(JSON.stringify(data));
}

// Send error
function sendError(res, message, status = 400) {
    sendJson(res, { error: message }, status);
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end();
        return;
    }

    // Health check (no auth required)
    if (pathname === '/health' && method === 'GET') {
        sendJson(res, { 
            status: 'ok', 
            network: 'grabnet',
            available: isGrabAvailable(),
            timestamp: new Date().toISOString() 
        });
        return;
    }

    // Status (no auth required)
    if (pathname === '/status' && method === 'GET') {
        try {
            const available = isGrabAvailable();
            if (!available) {
                sendJson(res, { available: false, error: 'GrabNet binary not found' });
                return;
            }
            
            const stats = await getStats();
            sendJson(res, { 
                available: true,
                stats,
                timestamp: new Date().toISOString()
            });
        } catch (e) {
            sendError(res, e.message, 500);
        }
        return;
    }

    // --- Protected routes below ---

    // List hosted sites
    if (pathname === '/pins' && method === 'GET') {
        if (!authenticate(req)) {
            return sendError(res, 'Unauthorized', 401);
        }
        
        try {
            const sites = await listHostedSites();
            sendJson(res, { pins: sites });
        } catch (e) {
            sendError(res, e.message, 500);
        }
        return;
    }

    // Pin a site
    if (pathname === '/pins' && method === 'POST') {
        if (!authenticate(req)) {
            return sendError(res, 'Unauthorized', 401);
        }

        try {
            const body = await parseBody(req);
            if (!body.siteId) {
                return sendError(res, 'siteId is required');
            }

            const result = await pinSite(body.siteId);
            sendJson(res, { 
                success: true, 
                siteId: body.siteId,
                message: result 
            });
        } catch (e) {
            sendError(res, e.message, 500);
        }
        return;
    }

    // Unpin a site
    if (pathname.startsWith('/pins/') && method === 'DELETE') {
        if (!authenticate(req)) {
            return sendError(res, 'Unauthorized', 401);
        }

        const siteId = pathname.replace('/pins/', '');
        if (!siteId) {
            return sendError(res, 'siteId is required');
        }

        try {
            const result = await unhostSite(siteId);
            sendJson(res, { success: true, message: result });
        } catch (e) {
            sendError(res, e.message, 500);
        }
        return;
    }

    // Get site info
    if (pathname.startsWith('/sites/') && method === 'GET') {
        const siteId = pathname.replace('/sites/', '');
        if (!siteId) {
            return sendError(res, 'siteId is required');
        }

        try {
            const info = await getSiteInfo(siteId);
            sendJson(res, { siteId, info });
        } catch (e) {
            sendError(res, e.message, 404);
        }
        return;
    }

    // Not found
    sendError(res, 'Not found', 404);
});

// Start server
server.listen(CONFIG.port, () => {
    console.log(`🌐 GrabNet Pinning Service running on port ${CONFIG.port}`);
    console.log(`   Binary: ${CONFIG.grabBin}`);
    console.log(`   Available: ${isGrabAvailable()}`);
});
