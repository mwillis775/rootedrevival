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
const grab = require('./grab');
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
 * This is the highest security tier — only granted when Flipper Zero is tapped.
 * Falls back to regular admin auth if no U2F keys are registered yet,
 * so the admin can set up the site before configuring hardware keys.
 */
function requireU2FAdmin(req, res, next) {
    if (!req.user || !req.user.isAdmin) {
        return res.error('Admin access required', 403);
    }
    // If admin has registered U2F keys, require verification
    const credentials = webauthn.getUserCredentials(req.user.id);
    if (credentials.length > 0 && !req.u2fVerified) {
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
    // CONTACT FORM (PUBLIC)
    // ========================================
    
    /**
     * Submit a contact form message — public, no auth needed.
     * If logged in, sender_user_id is set and name/email come from the account.
     */
    app.post('/api/contact', async (req, res) => {
        // Try to resolve logged-in user (optional)
        let senderUser = null;
        const token = req.cookies.session || req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            const session = users.validateSession(token);
            if (session) senderUser = session.user;
        }

        let { name, email, message } = req.body || {};
        
        if (senderUser) {
            // Logged-in user: use their account info
            name = senderUser.displayName || senderUser.display_name || senderUser.username;
            email = senderUser.email;
        }

        if (!name || !email || !message) {
            return res.error('Name, email, and message are required');
        }
        if (name.length > 200 || email.length > 200 || message.length > 5000) {
            return res.error('Message too long');
        }
        if (!senderUser && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.error('Invalid email address');
        }
        try {
            cms.createContactMessage({
                name: name.trim(),
                email: email.trim(),
                message: message.trim(),
                senderUserId: senderUser ? senderUser.id : null,
                recipientUsername: 'theboss'
            });
            // Also create a user_message so it shows in theboss's inbox
            const theboss = users.getUserByUsername('theboss');
            if (theboss) {
                cms.sendUserMessage({
                    fromUserId: senderUser ? senderUser.id : null,
                    toUserId: theboss.id,
                    subject: 'Contact Form',
                    body: message.trim(),
                    senderName: senderUser ? null : name.trim(),
                    senderEmail: senderUser ? null : email.trim()
                });
            }
            res.json({ success: true, message: 'Message sent! We\'ll get back to you soon.' });
        } catch (e) {
            res.error('Failed to send message', 500);
        }
    });
    
    // ========================================
    // CONTACT MESSAGES (ADMIN)
    // ========================================
    
    app.get('/api/cms/messages', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const unreadOnly = req.query.unread === 'true';
                const messages = cms.getAllContactMessages({ unreadOnly });
                const unreadCount = cms.getUnreadMessageCount();
                res.json({ messages, unreadCount });
            });
        });
    });
    
    app.post('/api/cms/messages/:id/read', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                cms.markMessageRead(parseInt(req.params.id));
                res.json({ success: true });
            });
        });
    });
    
    app.post('/api/cms/messages/read-all', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                cms.markAllMessagesRead();
                res.json({ success: true });
            });
        });
    });
    
    app.delete('/api/cms/messages/:id', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const deleted = cms.deleteContactMessage(parseInt(req.params.id));
                if (!deleted) return res.error('Message not found', 404);
                res.json({ success: true });
            });
        });
    });
    
    /**
     * Reply to a contact message (admin only)
     */
    app.post('/api/cms/messages/:id/reply', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const { reply } = req.body || {};
                if (!reply || !reply.trim()) return res.error('Reply text is required');
                if (reply.length > 5000) return res.error('Reply too long');
                const ok = cms.replyToMessage(parseInt(req.params.id), reply.trim(), req.user.id);
                if (!ok) return res.error('Message not found', 404);
                res.json({ success: true });
            });
        });
    });
    
    /**
     * Get messages for the currently logged-in user (their sent messages + any replies)
     */
    app.get('/api/my/messages', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            const messages = cms.getMessagesForUser(req.user.id);
            res.json({ messages });
        });
    });
    
    // ========================================
    // USER MESSAGING (authenticated users)
    // ========================================
    
    /**
     * Get inbox messages for the logged-in user
     */
    app.get('/api/my/inbox', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            const unreadOnly = req.query.unread === 'true';
            const messages = cms.getInboxForUser(req.user.id, { unreadOnly });
            const unreadCount = cms.getUnreadUserMessageCount(req.user.id);
            res.json({ messages, unreadCount });
        });
    });
    
    /**
     * Get sent messages for the logged-in user
     */
    app.get('/api/my/sent', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            const messages = cms.getSentMessages(req.user.id);
            res.json({ messages });
        });
    });
    
    /**
     * Send a message to another user
     */
    app.post('/api/my/messages/send', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            const { to, subject, body, parentId } = req.body || {};
            if (!to || !body) return res.error('Recipient and message body are required');
            if (body.length > 5000) return res.error('Message too long (5000 char max)');
            if (subject && subject.length > 200) return res.error('Subject too long');
            
            // Look up recipient by username
            const recipient = users.getUserByUsername(to);
            if (!recipient) return res.error('User not found', 404);
            if (recipient.id === req.user.id) return res.error('Cannot send messages to yourself');
            if (recipient.is_banned) return res.error('Cannot message this user');
            
            try {
                const msg = cms.sendUserMessage({
                    fromUserId: req.user.id,
                    toUserId: recipient.id,
                    subject: subject ? subject.trim() : '',
                    body: body.trim(),
                    parentId: parentId || null
                });
                res.json({ success: true, messageId: msg.id });
            } catch (e) {
                res.error('Failed to send message', 500);
            }
        });
    });
    
    /**
     * Mark a user message as read
     */
    app.post('/api/my/messages/:id/read', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            cms.markUserMessageRead(parseInt(req.params.id), req.user.id);
            res.json({ success: true });
        });
    });
    
    /**
     * Mark all inbox messages as read
     */
    app.post('/api/my/messages/read-all', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            cms.markAllUserMessagesRead(req.user.id);
            res.json({ success: true });
        });
    });
    
    /**
     * Delete a user message
     */
    app.delete('/api/my/messages/:id', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            const ok = cms.deleteUserMessage(parseInt(req.params.id), req.user.id);
            if (!ok) return res.error('Message not found', 404);
            res.json({ success: true });
        });
    });
    
    // ========================================
    // SITE FILES (ADMIN — edit static HTML)
    // ========================================
    
    /**
     * List all editable site files
     */
    app.get('/api/cms/site-files', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const files = cms.listSiteFiles();
                res.json({ files });
            });
        });
    });
    
    /**
     * Read a site file's content
     */
    app.get('/api/cms/site-files/:filename', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const content = cms.readSiteFile(req.params.filename);
                if (content === null) return res.error('File not found', 404);
                res.json({ filename: req.params.filename, content });
            });
        });
    });
    
    /**
     * Update a site file (U2F required — destructive operation)
     */
    app.put('/api/cms/site-files/:filename', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const { content } = req.body || {};
                if (content === undefined) return res.error('Content is required');
                try {
                    cms.writeSiteFile(req.params.filename, content);
                    res.json({ success: true });
                    grab.schedulePublish();
                } catch (e) {
                    res.error(e.message, 400);
                }
            });
        });
    });
    
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
     * Begin key registration — returns challenge for navigator.credentials.create()
     * Accepts optional authenticatorType: 'cross-platform' | 'platform' | 'any'
     */
    app.post('/api/webauthn/register/begin', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                try {
                    const { authenticatorType } = req.body || {};
                    const options = webauthn.generateRegistrationOptions(req.user, authenticatorType || 'any');
                    res.json({ options });
                } catch (e) {
                    res.error(e.message, 500);
                }
            });
        });
    });
    
    /**
     * Complete key registration — verifies attestation and stores credential
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
                        deviceName || 'Security Key'
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
     * Begin authentication — returns challenge for navigator.credentials.get()
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
     * Complete authentication — verifies signature, elevates session to admin
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
                    grab.schedulePublish();
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
                    grab.schedulePublish();
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
                grab.schedulePublish();
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
                    grab.schedulePublish();
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
                grab.schedulePublish();
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
                grab.schedulePublish();
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
                grab.schedulePublish();
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
            await requireAdmin(req, res, async () => {
                const { items } = req.body || {};
                if (!Array.isArray(items)) {
                    return res.error('Items array required');
                }
                cms.updateNavigation(req.params.menu, items);
                res.json({ success: true });
                grab.schedulePublish();
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
                grab.schedulePublish();
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
                grab.schedulePublish();
            });
        });
    });
    
    app.post('/api/cms/theme/:name/activate', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                cms.activateTheme(req.params.name);
                res.json({ success: true });
                grab.schedulePublish();
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
