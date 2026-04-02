#!/usr/bin/env node
/**
 * OpenSource Scholar - Main Entry Point
 * 
 * Open access platform with GrabNet P2P hosting and open peer review.
 * Every user gets their own GrabNet-published profile page.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createApp, cors, auth, rateLimit } = require('./http');
const { registerRoutes } = require('./routes');
const { registerAdminRoutes } = require('./admin-routes');
const { registerGrabRoutes } = require('./grab-routes');
const { registerCmsRoutes } = require('./cms-routes');
const { registerShopRoutes } = require('./shop-routes');
const { closeDb } = require('./db');
const users = require('./db/users');
const grab = require('./grab');

console.log('📚 OpenSource Scholar');
console.log('━'.repeat(50));

// Ensure data directories exist
if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
}
if (!fs.existsSync(config.uploadsDir)) {
    fs.mkdirSync(config.uploadsDir, { recursive: true });
}
if (!fs.existsSync(config.sitesDir)) {
    fs.mkdirSync(config.sitesDir, { recursive: true });
}

// Check if database exists
if (!fs.existsSync(config.dbPath)) {
    console.error('❌ Database not found. Run: npm run db:init');
    process.exit(1);
}

// Create application
const app = createApp();

// Global middleware
app.use(cors());
app.use(rateLimit(config.rateLimit.general));

// Static file serving for frontend
const publicDir = path.join(config.rootDir, 'public');

app.get('/', async (req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.html(fs.readFileSync(indexPath, 'utf8'));
    } else {
        res.html(`
            <!DOCTYPE html>
            <html>
            <head><title>OpenSource Scholar</title></head>
            <body>
                <h1>📚 OpenSource Scholar</h1>
                <p>API is running. Frontend not yet deployed.</p>
                <p><a href="/api/health">Health Check</a></p>
            </body>
            </html>
        `);
    }
});

// Serve static files
app.get(/^\/(?:css|js|assets)\/(.+)$/, async (req, res) => {
    const filePath = path.join(publicDir, req.pathname);
    
    if (!fs.existsSync(filePath)) {
        return res.error('Not found', 404);
    }
    
    const mime = require('mime-types');
    const contentType = mime.lookup(filePath) || 'application/octet-stream';
    
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
});

// Register API routes
registerRoutes(app);
registerAdminRoutes(app);
registerGrabRoutes(app);
registerCmsRoutes(app);
registerShopRoutes(app);

// Cleanup expired sessions periodically
setInterval(() => {
    const cleaned = users.cleanupExpiredSessions();
    if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} expired sessions`);
    }
}, 60 * 60 * 1000); // Every hour

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    closeDb();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down...');
    closeDb();
    process.exit(0);
});

// Start server
app.listen(config.port, () => {
    console.log(`✓ Server running on http://localhost:${config.port}`);
    console.log(`✓ Data directory: ${config.dataDir}`);
    console.log(`✓ Sites directory: ${config.sitesDir}`);
    console.log(`✓ GrabNet: ${grab.isAvailable() ? 'available ✓' : 'not found'}`);
    console.log(`✓ Gateway: ${config.grabGatewayUrl}`);
    console.log('━'.repeat(50));
    console.log('Ready to serve open knowledge! 🎓');
});
