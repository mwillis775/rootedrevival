/**
 * OpenSource Scholar - GrabNet Integration
 * 
 * Manages the unified Rooted Revival site on the GrabNet P2P network.
 * Open Scholar is part of Rooted Revival - one site, one mission.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Path to grab binary
const GRAB_BIN = process.env.GRAB_BIN || path.resolve(__dirname, '../../grab/target/release/grab');

// Main site directory (the unified Rooted Revival site)
const SITE_DIR = process.env.SITE_DIR || path.resolve(__dirname, '../../site');

// Site name for GrabNet
const SITE_NAME = 'rootedrevival';

/**
 * Check if GrabNet is available
 */
function isAvailable() {
    try {
        if (!fs.existsSync(GRAB_BIN)) {
            return false;
        }
        execSync(`${GRAB_BIN} --version`, { stdio: 'pipe' });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Get GrabNet status
 */
function getStatus() {
    if (!isAvailable()) {
        return { running: false, error: 'GrabNet binary not found' };
    }
    
    return {
        running: true,
        siteDir: SITE_DIR,
        siteName: SITE_NAME
    };
}

/**
 * Get the user content directory within the main site
 * Note: We use 'content' instead of 'uploads' because the gateway reserves 'uploads' path
 */
function getUploadsDir() {
    const uploadsDir = path.join(SITE_DIR, 'content');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    return uploadsDir;
}

/**
 * Get user's upload directory within the site
 */
function getUserUploadsDir(username) {
    const userDir = path.join(getUploadsDir(), username);
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
}

/**
 * Add a file to the site uploads
 */
function addFileToSite(username, fileBuffer, filename, metadata = {}) {
    const userDir = getUserUploadsDir(username);
    
    // Generate unique filename
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    const uniqueName = `${base}-${Date.now()}${ext}`;
    const filePath = path.join(userDir, uniqueName);
    
    // Write file
    fs.writeFileSync(filePath, fileBuffer);
    
    // Write metadata file
    const metaPath = path.join(userDir, `${uniqueName}.meta.json`);
    fs.writeFileSync(metaPath, JSON.stringify({
        originalName: filename,
        uploadedAt: new Date().toISOString(),
        size: fileBuffer.length,
        uploader: username,
        ...metadata
    }, null, 2));
    
    return {
        filename: uniqueName,
        path: filePath,
        relativePath: `content/${username}/${uniqueName}`,
        url: `/content/${username}/${uniqueName}`
    };
}

/**
 * Delete a file from the site
 */
function deleteFileFromSite(username, filename) {
    const filePath = path.join(getUserUploadsDir(username), filename);
    const metaPath = `${filePath}.meta.json`;
    
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
    if (fs.existsSync(metaPath)) {
        fs.unlinkSync(metaPath);
    }
}

/**
 * Find and kill the gateway process
 */
function killGateway() {
    try {
        // Try systemctl stop first (preferred)
        execSync('sudo systemctl stop grab-gateway', { stdio: 'pipe', timeout: 5000 });
        return new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
        // Fallback: kill by PID
        try {
            const result = execSync("ps aux | grep 'grab gateway' | grep -v grep | awk '{print $2}'", { 
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
            
            if (result) {
                const pids = result.split('\n').filter(Boolean);
                for (const pid of pids) {
                    try {
                        execSync(`kill ${pid}`, { stdio: 'pipe' });
                    } catch (e) {
                        // Process may have already exited
                    }
                }
                return new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (e2) {
            // No gateway running
        }
    }
    return Promise.resolve();
}

/**
 * Restart the gateway with the default site
 */
function restartGateway() {
    try {
        // Prefer systemctl restart (lets systemd manage the process)
        execSync('sudo systemctl start grab-gateway', { stdio: 'pipe', timeout: 10000 });
        console.log('🌐 Restarted GrabNet gateway via systemd');
    } catch (e) {
        // Fallback to direct spawn if systemd not available
        const gatewayPort = process.env.GRAB_GATEWAY_PORT || '8888';
        
        spawn(GRAB_BIN, ['gateway', '--port', gatewayPort, '--default-site', SITE_NAME], {
            cwd: path.dirname(GRAB_BIN),
            detached: true,
            stdio: 'ignore'
        }).unref();
        
        console.log(`🌐 Restarted GrabNet gateway on port ${gatewayPort} (direct spawn)`);
    }
}

/**
 * Publish the unified site to GrabNet
 * Note: This will briefly stop the gateway to release the database lock
 */
async function publishSite() {
    if (!isAvailable()) {
        throw new Error('GrabNet not available');
    }
    
    // Kill the gateway to release database lock
    await killGateway();
    
    // Small delay to ensure lock is released
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return new Promise((resolve, reject) => {
        // Use 'update' if site exists, otherwise 'publish'
        const args = ['update', SITE_NAME];
        
        const proc = spawn(GRAB_BIN, args, {
            cwd: path.dirname(GRAB_BIN)
        });
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => { stdout += data; });
        proc.stderr.on('data', (data) => { stderr += data; });
        
        proc.on('close', (code) => {
            // Restart gateway regardless of result
            restartGateway();
            
            if (code !== 0) {
                // If update fails (site doesn't exist), try publish
                if (stderr.includes('not found') || stderr.includes('No site')) {
                    const pubProc = spawn(GRAB_BIN, ['publish', SITE_DIR, '--name', SITE_NAME], {
                        cwd: path.dirname(GRAB_BIN)
                    });
                    
                    let pubStdout = '';
                    let pubStderr = '';
                    
                    pubProc.stdout.on('data', (data) => { pubStdout += data; });
                    pubProc.stderr.on('data', (data) => { pubStderr += data; });
                    
                    pubProc.on('close', (pubCode) => {
                        if (pubCode !== 0) {
                            reject(new Error(`GrabNet publish failed: ${pubStderr}`));
                            return;
                        }
                        
                        const match = pubStdout.match(/grab:\/\/([A-Za-z0-9]+)/);
                        const siteId = match ? match[1] : null;
                        const revMatch = pubStdout.match(/revision (\d+)/i);
                        const revision = revMatch ? parseInt(revMatch[1]) : 1;
                        
                        resolve({
                            success: true,
                            siteId,
                            siteName: SITE_NAME,
                            revision,
                            output: pubStdout
                        });
                    });
                    
                    pubProc.on('error', reject);
                    return;
                }
                
                reject(new Error(`GrabNet update failed: ${stderr}`));
                return;
            }
            
            // Parse output to get site ID
            const match = stdout.match(/grab:\/\/([A-Za-z0-9]+)/);
            const siteId = match ? match[1] : null;
            
            // Parse revision
            const revMatch = stdout.match(/revision (\d+)/i);
            const revision = revMatch ? parseInt(revMatch[1]) : null;
            
            resolve({
                success: true,
                siteId,
                siteName: SITE_NAME,
                revision,
                output: stdout
            });
        });
        
        proc.on('error', (err) => {
            restartGateway();
            reject(err);
        });
    });
}

/**
 * Get the GrabNet gateway URL for the site
 */
function getGatewayUrl(siteId) {
    const gatewayBase = process.env.GRAB_GATEWAY_URL || 'http://localhost:8888';
    return `${gatewayBase}/site/${siteId}/`;
}

/**
 * Get site info
 */
function getSiteInfo() {
    return {
        siteDir: SITE_DIR,
        siteName: SITE_NAME,
        uploadsDir: getUploadsDir(),
        available: isAvailable()
    };
}

// --- Debounced Auto-Publish ---

let publishTimer = null;
let publishInProgress = false;

/**
 * Schedule a debounced publish. Multiple calls within the delay window
 * collapse into a single publish. Safe to call frequently after content changes.
 */
function schedulePublish() {
    if (!config.grabEnabled || !config.grabAutoPublish) return;
    if (!isAvailable()) return;

    if (publishTimer) clearTimeout(publishTimer);

    publishTimer = setTimeout(async () => {
        publishTimer = null;
        if (publishInProgress) {
            // Another publish running — reschedule
            schedulePublish();
            return;
        }
        publishInProgress = true;
        try {
            const result = await publishSite();
            console.log(`🔄 Auto-publish complete: revision ${result.revision || '?'}`);
        } catch (e) {
            console.error('🔄 Auto-publish failed:', e.message);
        } finally {
            publishInProgress = false;
        }
    }, config.grabPublishDelay);

    console.log(`🔄 Publish scheduled (${config.grabPublishDelay / 1000}s debounce)`);
}

module.exports = {
    isAvailable,
    getStatus,
    getUploadsDir,
    getUserUploadsDir,
    addFileToSite,
    deleteFileFromSite,
    publishSite,
    schedulePublish,
    getGatewayUrl,
    getSiteInfo,
    SITE_DIR,
    SITE_NAME
};
