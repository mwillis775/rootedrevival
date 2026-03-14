/**
 * Rooted Revival - CMS Admin API Routes
 * 
 * Full content management system routes:
 * - WebAuthn/U2F key registration & authentication (Flipper Zero)
 * - Page CRUD with WYSIWYG editor support
 * - Media library management
 * - Site settings & appearance
 * - Navigation editor
 * - Component/block management
 */

const { auth, parseMultipart } = require('./http');
const webauthn = require('./webauthn');
const cms = require('./db/cms');
const users = require('./db/users');
const config = require('./config');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Middleware: require admin (password auth OR verified U2F key)
 */
function requireAdmin(req, res, next) {
    if (!req.user || !req.user.isAdmin) {
        return res.error('Admin access required', 403);
    }
    return next();
}

/**
 * Middleware: require U2F-verified admin session
 * This is the highest security tier — only granted when Flipper Zero is tapped
 */
function requireU2FAdmin(req, res, next) {
    if (!req.user || !req.user.isAdmin) {
        return res.error('Admin access required', 403);
    }
    // Check if session has U2F elevation
    if (!req.u2fVerified) {
        return res.error('U2F key verification required. Please tap your security key.', 403);
    }
    return next();
}

function registerCmsRoutes(app) {
    
    // Initialize CMS tables on first load
    try {
        cms.initCmsTables();
        webauthn.initWebAuthnTable();
    } catch (e) {
        console.warn('CMS/WebAuthn table init:', e.message);
    }
    
    // ========================================
    // WEBAUTHN / U2F KEY MANAGEMENT
    // ========================================
    
    /**
     * Check if current user has any registered U2F keys
     */
    app.get('/api/webauthn/status', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            const credentials = webauthn.getUserCredentials(req.user.id);
            res.json({
                hasKeys: credentials.length > 0,
                keys: credentials.map(c => ({
                    id: c.id,
                    deviceName: c.device_name,
                    createdAt: c.created_at,
                    lastUsed: c.last_used,
                    signCount: c.sign_count
                })),
                isAdmin: req.user.isAdmin
            });
        });
    });
    
    /**
     * Begin U2F key registration — returns challenge for navigator.credentials.create()
     */
    app.post('/api/webauthn/register/begin', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                try {
                    const options = webauthn.generateRegistrationOptions(req.user);
                    res.json({ options });
                } catch (e) {
                    res.error(e.message, 500);
                }
            });
        });
    });
    
    /**
     * Complete U2F key registration — verifies attestation and stores credential
     */
    app.post('/api/webauthn/register/complete', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const { credential, deviceName } = req.body || {};
                
                if (!credential) {
                    return res.error('Missing credential data');
                }
                
                try {
                    const result = webauthn.verifyRegistration(
                        req.user,
                        credential,
                        deviceName || 'Flipper Zero'
                    );
                    
                    res.json({
                        success: true,
                        credential: result
                    });
                } catch (e) {
                    console.error('WebAuthn registration error:', e);
                    res.error(e.message, 400);
                }
            });
        });
    });
    
    /**
     * Begin U2F authentication — returns challenge for navigator.credentials.get()
     */
    app.post('/api/webauthn/auth/begin', async (req, res) => {
        await auth({ required: false })(req, res, async () => {
            try {
                const userId = req.user ? req.user.id : null;
                const options = webauthn.generateAuthenticationOptions(userId);
                res.json({ options });
            } catch (e) {
                res.error(e.message, 500);
            }
        });
    });
    
    /**
     * Complete U2F authentication — verifies signature, elevates session to admin
     */
    app.post('/api/webauthn/auth/complete', async (req, res) => {
        await auth({ required: false })(req, res, async () => {
            const { credential } = req.body || {};
            
            if (!credential) {
                return res.error('Missing credential data');
            }
            
            try {
                const result = webauthn.verifyAuthentication(credential);
                
                // Create an elevated admin session
                const token = crypto.randomBytes(32).toString('hex');
                const { hashToken } = require('./crypto');
                const tokenHash = hashToken(token);
                const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4 hours
                
                const { getDb } = require('./db/index');
                const db = getDb();
                
                db.prepare(`
                    INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent)
                    VALUES (?, ?, ?, ?, ?)
                `).run(result.user.id, tokenHash, expiresAt, req.socket.remoteAddress, req.headers['user-agent']);
                
                // Set both the regular session cookie and a U2F elevation marker
                res.setCookie('session', token);
                res.setCookie('u2f_verified', 'true', { 
                    httpOnly: false, // JS needs to read this for UI state
                    maxAge: 4 * 60 * 60 // 4 hours
                });
                
                res.json({
                    success: true,
                    user: result.user,
                    deviceName: result.deviceName,
                    elevated: true,
                    message: `Authenticated via ${result.deviceName}. Admin access granted.`
                });
                
            } catch (e) {
                console.error('WebAuthn auth error:', e);
                res.error(e.message, 401);
            }
        });
    });
    
    /**
     * Remove a registered U2F key
     */
    app.delete('/api/webauthn/credentials/:id', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const deleted = webauthn.deleteCredential(req.user.id, parseInt(req.params.id));
                if (!deleted) {
                    return res.error('Credential not found', 404);
                }
                res.json({ success: true });
            });
        });
    });
    
    // ========================================
    // CMS PAGES
    // ========================================
    
    /**
     * List all CMS pages
     */
    app.get('/api/cms/pages', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const pages = cms.getAllPages();
                res.json({ pages });
            });
        });
    });
    
    /**
     * Get a single page by UUID
     */
    app.get('/api/cms/pages/:uuid', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const page = cms.getPageByUuid(req.params.uuid);
                if (!page) return res.error('Page not found', 404);
                res.json({ page });
            });
        });
    });
    
    /**
     * Create a new page
     */
    app.post('/api/cms/pages', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const { title, slug, description, content, template, status, showInNav, navLabel, customCss, customJs } = req.body || {};
                
                if (!title) {
                    return res.error('Title is required');
                }
                
                try {
                    const result = cms.createPage({
                        title, slug, description, content, template, status,
                        showInNav, navLabel, customCss, customJs,
                        createdBy: req.user.id
                    });
                    res.json({ success: true, page: result }, 201);
                } catch (e) {
                    res.error(e.message);
                }
            });
        });
    });
    
    /**
     * Update a page
     */
    app.put('/api/cms/pages/:uuid', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                try {
                    const page = cms.updatePage(req.params.uuid, {
                        ...req.body,
                        updatedBy: req.user.id
                    });
                    res.json({ success: true, page });
                } catch (e) {
                    res.error(e.message);
                }
            });
        });
    });
    
    /**
     * Delete a page
     */
    app.delete('/api/cms/pages/:uuid', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const deleted = cms.deletePage(req.params.uuid);
                if (!deleted) return res.error('Page not found', 404);
                res.json({ success: true });
            });
        });
    });
    
    /**
     * Get page revision history
     */
    app.get('/api/cms/pages/:uuid/revisions', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const revisions = cms.getPageRevisions(req.params.uuid);
                res.json({ revisions });
            });
        });
    });
    
    /**
     * Restore a revision
     */
    app.post('/api/cms/pages/:uuid/revisions/:revisionId/restore', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                try {
                    const page = cms.restoreRevision(req.params.uuid, parseInt(req.params.revisionId));
                    res.json({ success: true, page });
                } catch (e) {
                    res.error(e.message);
                }
            });
        });
    });
    
    /**
     * Serve published CMS page by slug (public)
     */
    app.get(/^\/p\/([a-z0-9-]+)$/, async (req, res) => {
        const slug = req.params[0] || req.pathname.split('/p/')[1];
        const page = cms.getPageBySlug(slug);
        
        if (!page || page.status !== 'published') {
            return res.error('Page not found', 404);
        }
        
        const siteName = cms.getSetting('site_name') || 'Rooted Revival';
        const siteEmoji = cms.getSetting('site_emoji') || '🌱';
        
        res.html(`
<!DOCTYPE html>
<html lang="en" data-theme="${cms.getSetting('theme') || 'terminal'}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${page.meta_title || page.title} — ${siteName}</title>
    <meta name="description" content="${page.meta_description || page.description || ''}">
    ${page.meta_image ? `<meta property="og:image" content="${page.meta_image}">` : ''}
    <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root { --accent: ${cms.getSetting('primary_color') || '#33ff33'}; --bg: ${cms.getSetting('bg_color') || '#0a0a0a'}; }
        body { background: var(--bg); color: #e0e0e0; font-family: 'Inter', sans-serif; margin: 0; padding: 0; line-height: 1.6; }
        .page-content { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
        .page-content img { max-width: 100%; height: auto; border-radius: 6px; }
        .page-content a { color: var(--accent); }
        h1, h2, h3 { font-family: 'Share Tech Mono', monospace; color: var(--accent); }
        ${page.custom_css || ''}
        ${cms.getSetting('custom_css') || ''}
    </style>
    ${cms.getSetting('header_html') || ''}
</head>
<body>
    <div class="page-content">
        ${page.content}
    </div>
    ${page.custom_js ? `<script>${page.custom_js}</script>` : ''}
    ${cms.getSetting('footer_html') || ''}
</body>
</html>
        `);
    });
    
    // ========================================
    // MEDIA LIBRARY
    // ========================================
    
    /**
     * List media files
     */
    app.get('/api/cms/media', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const { folder, type, search, limit, offset } = req.query;
                const media = cms.getAllMedia({ folder, type, search, limit: parseInt(limit) || 50, offset: parseInt(offset) || 0 });
                res.json({ media });
            });
        });
    });
    
    /**
     * Upload media file(s)
     */
    app.post('/api/cms/media', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                if (!req.files || req.files.length === 0) {
                    return res.error('No file uploaded');
                }
                
                // Ensure CMS upload directory exists
                const cmsDir = path.join(config.uploadsDir, 'cms');
                if (!fs.existsSync(cmsDir)) {
                    fs.mkdirSync(cmsDir, { recursive: true });
                }
                
                const results = [];
                
                for (const file of req.files) {
                    const ext = path.extname(file.filename || '').toLowerCase() || 
                                '.' + (file.mimeType.split('/')[1] || 'bin');
                    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
                    const filepath = path.join(cmsDir, filename);
                    
                    fs.writeFileSync(filepath, file.buffer);
                    
                    // Get image dimensions if applicable
                    let width = null, height = null;
                    // Simple dimension detection for common formats could be added here
                    
                    const media = cms.addMedia({
                        filename,
                        originalFilename: file.filename,
                        mimeType: file.mimeType,
                        fileSize: file.size,
                        width,
                        height,
                        altText: req.body?.altText || '',
                        caption: req.body?.caption || '',
                        folder: req.body?.folder || '/',
                        uploadedBy: req.user.id
                    });
                    
                    results.push({
                        ...media,
                        url: `/api/cms/media/${media.uuid}/file`,
                        mimeType: file.mimeType,
                        size: file.size
                    });
                }
                
                res.json({ success: true, media: results }, 201);
            });
        });
    });
    
    /**
     * Serve a media file
     */
    app.get('/api/cms/media/:uuid/file', async (req, res) => {
        const media = cms.getMediaByUuid(req.params.uuid);
        if (!media) return res.error('File not found', 404);
        
        const filepath = path.join(config.uploadsDir, 'cms', media.filename);
        if (!fs.existsSync(filepath)) return res.error('File not found on disk', 404);
        
        const stat = fs.statSync(filepath);
        res.writeHead(200, {
            'Content-Type': media.mime_type,
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=31536000'
        });
        fs.createReadStream(filepath).pipe(res);
    });
    
    /**
     * Update media metadata
     */
    app.put('/api/cms/media/:uuid', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                cms.updateMedia(req.params.uuid, req.body);
                res.json({ success: true });
            });
        });
    });
    
    /**
     * Delete a media file
     */
    app.delete('/api/cms/media/:uuid', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const deleted = cms.deleteMedia(req.params.uuid);
                if (!deleted) return res.error('Media not found', 404);
                res.json({ success: true });
            });
        });
    });
    
    // ========================================
    // SITE SETTINGS
    // ========================================
    
    /**
     * Get all site settings (grouped by category)
     */
    app.get('/api/cms/settings', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const settings = cms.getAllSettings();
                res.json({ settings });
            });
        });
    });
    
    /**
     * Update site settings
     */
    app.put('/api/cms/settings', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const { settings } = req.body || {};
                if (!settings || typeof settings !== 'object') {
                    return res.error('Settings object required');
                }
                cms.updateSettings(settings);
                res.json({ success: true });
            });
        });
    });
    
    // ========================================
    // NAVIGATION
    // ========================================
    
    /**
     * Get navigation menu
     */
    app.get('/api/cms/navigation/:menu', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const items = cms.getNavigation(req.params.menu);
                res.json({ items });
            });
        });
    });
    
    /**
     * Update navigation menu
     */
    app.put('/api/cms/navigation/:menu', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const { items } = req.body || {};
                if (!Array.isArray(items)) {
                    return res.error('Items array required');
                }
                cms.updateNavigation(req.params.menu, items);
                res.json({ success: true });
            });
        });
    });
    
    // ========================================
    // COMPONENTS / BLOCKS
    // ========================================
    
    app.get('/api/cms/components', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const components = cms.getAllComponents();
                res.json({ components });
            });
        });
    });
    
    app.put('/api/cms/components/:name', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                cms.upsertComponent(req.params.name, req.body);
                res.json({ success: true });
            });
        });
    });
    
    // ========================================
    // THEME / APPEARANCE
    // ========================================
    
    app.get('/api/cms/theme', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const theme = cms.getActiveTheme();
                res.json({ theme });
            });
        });
    });
    
    app.post('/api/cms/theme', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const { name, variables } = req.body || {};
                if (!name) return res.error('Theme name required');
                cms.saveTheme(name, variables || {});
                res.json({ success: true });
            });
        });
    });
    
    app.post('/api/cms/theme/:name/activate', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                cms.activateTheme(req.params.name);
                res.json({ success: true });
            });
        });
    });
    
    // ========================================
    // EXPORT / IMPORT SITE
    // ========================================
    
    app.get('/api/cms/export', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const data = {
                    exportedAt: new Date().toISOString(),
                    version: '1.0.0',
                    pages: cms.getAllPages(),
                    settings: cms.getAllSettings(),
                    navigation: {
                        main: cms.getNavigation('main'),
                        footer: cms.getNavigation('footer')
                    },
                    components: cms.getAllComponents(),
                    theme: cms.getActiveTheme()
                };
                
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Content-Disposition': `attachment; filename="rootedrevival-export-${Date.now()}.json"`
                });
                res.end(JSON.stringify(data, null, 2));
            });
        });
    });
}

module.exports = { registerCmsRoutes };
