/**
 * OpenSource Scholar - Configuration
 * 
 * All configuration loaded from environment variables with sensible defaults.
 * No API keys required for core functionality.
 */

const path = require('path');
const crypto = require('crypto');

// Generate a random secret if not provided (will change on restart - set in .env for production)
const generateSecret = () => crypto.randomBytes(64).toString('hex');

const config = {
    // Server
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    
    // Paths
    rootDir: path.resolve(__dirname, '..'),
    dataDir: process.env.DATA_DIR || path.resolve(__dirname, '..', 'data'),
    uploadsDir: process.env.UPLOADS_DIR || path.resolve(__dirname, '..', 'data', 'uploads'),
    dbPath: process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'scholar.db'),
    
    // Security
    sessionSecret: process.env.SESSION_SECRET || generateSecret(),
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE || String(7 * 24 * 60 * 60 * 1000), 10), // 7 days
    
    // Upload limits
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || String(500 * 1024 * 1024), 10), // 500MB for video
    allowedMimeTypes: [
        // Documents
        'application/pdf',
        'application/epub+zip',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.oasis.opendocument.text',
        'text/markdown',
        'text/plain',
        'application/json',
        'text/csv',
        'application/zip',
        'application/x-tar',
        'application/gzip',
        // Video
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/quicktime',
        'video/x-msvideo',
        // Audio
        'audio/mpeg',
        'audio/mp3',
        'audio/wav',
        'audio/ogg',
        'audio/flac',
        'audio/aac',
        'audio/webm',
        // Images
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml',
        'image/tiff',
        // 3D models
        'model/gltf+json',
        'model/gltf-binary'
    ],
    
    // GrabNet P2P Network
    grabBin: process.env.GRAB_BIN || path.resolve(__dirname, '../../grab/target/release/grab'),
    grabGatewayUrl: process.env.GRAB_GATEWAY_URL || 'http://127.0.0.1:8888',
    grabEnabled: process.env.GRAB_ENABLED !== 'false',
    grabAutoPublish: process.env.GRAB_AUTO_PUBLISH !== 'false',
    grabPublishDelay: parseInt(process.env.GRAB_PUBLISH_DELAY || '30000', 10), // 30s debounce
    
    // User site directories
    sitesDir: process.env.SITES_DIR || path.resolve(__dirname, '..', 'data', 'sites'),
    
    // Rate limiting (requests per minute)
    rateLimit: {
        general: parseInt(process.env.RATE_LIMIT_GENERAL || '100', 10),
        upload: parseInt(process.env.RATE_LIMIT_UPLOAD || '10', 10),
        auth: parseInt(process.env.RATE_LIMIT_AUTH || '20', 10)
    },
    
    // Features
    registrationEnabled: process.env.REGISTRATION_ENABLED !== 'false',
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true'
};

module.exports = config;
