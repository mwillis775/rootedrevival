/**
 * OpenSource Scholar - API Routes
 * 
 * All REST API endpoints for the application.
 */

const { auth, rateLimit } = require('./http');
const users = require('./db/users');
const papers = require('./db/papers');
const citations = require('./citations');
const grab = require('./grab');
const config = require('./config');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

/**
 * Register all API routes
 */
function registerRoutes(app) {
    
    // ========================================
    // HEALTH & INFO
    // ========================================
    
    app.get('/api/health', async (req, res) => {
        const grabStatus = grab.getStatus();
        
        res.json({
            status: 'ok',
            version: '1.0.0',
            grabnet: grabStatus
        });
    });
    
    app.get('/api/disciplines', async (req, res) => {
        const disciplines = papers.getDisciplines();
        res.json({ disciplines });
    });
    
    // ========================================
    // AUTHENTICATION
    // ========================================
    
    app.post('/api/auth/register', async (req, res) => {
        if (!config.registrationEnabled) {
            return res.error('Registration is disabled', 403);
        }
        
        const { username, email, password, displayName } = req.body || {};
        
        if (!username || !email || !password) {
            return res.error('Username, email, and password are required');
        }
        
        try {
            const user = await users.createUser({ username, email, password, displayName });
            
            // Auto-login
            const session = await users.authenticateUser(email, password, {
                ipAddress: req.socket.remoteAddress,
                userAgent: req.headers['user-agent']
            });
            
            res.setCookie('session', session.token);
            
            res.json({
                success: true,
                user: session.user
            });
            
        } catch (error) {
            res.error(error.message);
        }
    });
    
    app.post('/api/auth/login', async (req, res) => {
        const { username, password } = req.body || {};
        
        if (!username || !password) {
            return res.error('Username/email and password are required');
        }
        
        try {
            const session = await users.authenticateUser(username, password, {
                ipAddress: req.socket.remoteAddress,
                userAgent: req.headers['user-agent']
            });
            
            res.setCookie('session', session.token);
            
            res.json({
                success: true,
                user: session.user
            });
            
        } catch (error) {
            res.error(error.message, 401);
        }
    });
    
    app.post('/api/auth/logout', async (req, res) => {
        const token = req.cookies.session;
        
        if (token) {
            users.invalidateSession(token);
        }
        
        res.clearCookie('session');
        res.clearCookie('u2f_verified');
        res.json({ success: true });
    });
    
    app.get('/api/auth/me', auth({ required: false }), async (req, res) => {
        if (!req.user) {
            return res.json({ user: null });
        }
        
        res.json({ user: req.user, u2fVerified: req.u2fVerified });
    });
    
    // ========================================
    // USER PROFILE
    // ========================================
    
    app.get('/api/users/:username', async (req, res) => {
        const user = users.getUserByUsername(req.params.username);
        
        if (!user) {
            return res.error('User not found', 404);
        }
        
        // Get user's public papers
        const userPapers = papers.getPapersByUploader(user.id, false);
        
        res.json({
            user: {
                username: user.username,
                display_name: user.display_name,
                bio: user.bio,
                affiliation: user.affiliation,
                orcid: user.orcid,
                customization: user.customization,
                created_at: user.created_at,
                is_admin: user.is_admin,
                is_moderator: user.is_moderator,
                paperCount: userPapers.length
            },
            papers: userPapers
        });
    });
    
    app.put('/api/users/me', auth({ required: true }), async (req, res) => {
        const { displayName, bio, affiliation, orcid, customization } = req.body || {};
        
        users.updateUserProfile(req.user.id, { displayName, bio, affiliation, orcid, customization });
        
        res.json({ success: true });
    });
    
    app.post('/api/users/me/password', auth({ required: true }), async (req, res) => {
        const { currentPassword, newPassword } = req.body || {};
        
        if (!currentPassword || !newPassword) {
            return res.error('Current and new password are required');
        }
        
        try {
            await users.changePassword(req.user.id, currentPassword, newPassword);
            res.clearCookie('session');
            res.json({ success: true, message: 'Password changed. Please log in again.' });
        } catch (error) {
            res.error(error.message);
        }
    });
    
    // ========================================
    // PAPERS
    // ========================================
    
    app.get('/api/papers', async (req, res) => {
        const {
            q: query,
            discipline,
            author,
            year,
            yearFrom,
            yearTo,
            type: paperType,
            limit = 20,
            offset = 0
        } = req.query;
        
        const results = papers.searchPapers({
            query,
            discipline,
            author,
            year: year ? parseInt(year) : null,
            yearFrom: yearFrom ? parseInt(yearFrom) : null,
            yearTo: yearTo ? parseInt(yearTo) : null,
            paperType,
            limit: Math.min(parseInt(limit), 100),
            offset: parseInt(offset)
        });
        
        res.json({ papers: results });
    });
    
    app.get('/api/papers/recent', async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const type = req.query.type || null;
        const recent = papers.getRecentPapers(limit, type);
        res.json({ papers: recent });
    });
    
    app.get('/api/papers/trending', async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const type = req.query.type || null;
        const trending = papers.getTrendingPapers(limit, type);
        res.json({ papers: trending });
    });
    
    app.get('/api/papers/:uuid', async (req, res) => {
        const paper = papers.getPaperByUuid(req.params.uuid, false);
        
        if (!paper) {
            return res.error('Paper not found', 404);
        }
        
        // Increment view count
        papers.incrementViewCount(paper.id);
        
        // Generate citations
        const citationFormats = citations.generateAllCitations(paper);
        
        res.json({ paper, citations: citationFormats });
    });
    
    app.post('/api/papers', auth({ required: true }), async (req, res) => {
        const {
            title,
            abstract,
            publicationYear,
            publicationDate,
            language,
            doi,
            isbn,
            arxivId,
            pmid,
            paperType,
            license,
            visibility,
            authors,
            disciplines,
            keywords
        } = req.body || {};
        
        if (!title) {
            return res.error('Title is required');
        }
        
        try {
            const result = papers.createPaper({
                uploaderId: req.user.id,
                title,
                abstract,
                publicationYear,
                publicationDate,
                language,
                doi,
                isbn,
                arxivId,
                pmid,
                paperType,
                license,
                visibility,
                authors: authors || [{ name: req.user.displayName, userId: req.user.id }],
                disciplines: disciplines || [],
                keywords: keywords || []
            });
            
            res.json({ success: true, paper: result }, 201);
            
        } catch (error) {
            res.error(error.message);
        }
    });
    
    app.put('/api/papers/:uuid', auth({ required: true }), async (req, res) => {
        const paper = papers.getPaperByUuid(req.params.uuid, true);
        
        if (!paper) {
            return res.error('Paper not found', 404);
        }
        
        if (paper.uploader_id !== req.user.id && !req.user.isAdmin) {
            return res.error('Not authorized', 403);
        }
        
        papers.updatePaper(paper.id, req.body);
        
        res.json({ success: true });
    });
    
    app.post('/api/papers/:uuid/publish', auth({ required: true }), async (req, res) => {
        const paper = papers.getPaperByUuid(req.params.uuid, true);
        
        if (!paper) {
            return res.error('Paper not found', 404);
        }
        
        if (paper.uploader_id !== req.user.id && !req.user.isAdmin) {
            return res.error('Not authorized', 403);
        }
        
        // Check if paper has at least one file
        if (!paper.files || paper.files.length === 0) {
            return res.error('Paper must have at least one file before publishing');
        }
        
        papers.publishPaper(paper.id);
        
        res.json({ success: true });
    });
    
    // ========================================
    // FILE UPLOADS
    // ========================================
    
    app.post('/api/papers/:uuid/files', auth({ required: true }), async (req, res) => {
        const paper = papers.getPaperByUuid(req.params.uuid, true);
        
        if (!paper) {
            return res.error('Paper not found', 404);
        }
        
        if (paper.uploader_id !== req.user.id && !req.user.isAdmin) {
            return res.error('Not authorized', 403);
        }
        
        if (!req.files || req.files.length === 0) {
            return res.error('No file uploaded');
        }
        
        const file = req.files[0];
        
        // Validate mime type
        if (!config.allowedMimeTypes.includes(file.mimeType)) {
            return res.error(`File type not allowed: ${file.mimeType}`);
        }
        
        try {
            const result = papers.addPaperFile({
                paperId: paper.id,
                fileBuffer: file.buffer,
                originalFilename: file.filename,
                mimeType: file.mimeType,
                fileType: req.body?.fileType || 'main',
                versionNote: req.body?.versionNote
            });
            
            res.json({ success: true, file: result }, 201);
            
        } catch (error) {
            res.error(error.message);
        }
    });
    
    app.get('/api/files/:id/download', async (req, res) => {
        const file = papers.getPaperFile(parseInt(req.params.id));
        
        if (!file) {
            return res.error('File not found', 404);
        }
        
        const filePath = path.join(config.uploadsDir, file.filename);
        
        if (!fs.existsSync(filePath)) {
            return res.error('File not found on disk', 404);
        }
        
        // Increment download count
        papers.incrementDownloadCount(file.paper_id);
        
        const stat = fs.statSync(filePath);
        
        res.writeHead(200, {
            'Content-Type': file.mime_type,
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename="${file.original_filename}"`
        });
        
        fs.createReadStream(filePath).pipe(res);
    });
    
    // Streaming endpoint for video/audio/images (inline viewing)
    app.get('/api/files/:id/stream', async (req, res) => {
        const file = papers.getPaperFile(parseInt(req.params.id));
        
        if (!file) {
            return res.error('File not found', 404);
        }
        
        const filePath = path.join(config.uploadsDir, file.filename);
        
        if (!fs.existsSync(filePath)) {
            return res.error('File not found on disk', 404);
        }
        
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        // Handle range requests for video/audio seeking
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;
            
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': file.mime_type
            });
            
            fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': file.mime_type,
                'Accept-Ranges': 'bytes'
            });
            
            fs.createReadStream(filePath).pipe(res);
        }
    });
    
    // Thumbnail generation endpoint for images/videos
    app.get('/api/files/:id/thumbnail', async (req, res) => {
        const file = papers.getPaperFile(parseInt(req.params.id));
        
        if (!file) {
            return res.error('File not found', 404);
        }
        
        // For images, just serve a smaller version (or the original for now)
        // TODO: Generate actual thumbnails with sharp/ffmpeg
        if (file.mime_type.startsWith('image/')) {
            const filePath = path.join(config.uploadsDir, file.filename);
            if (fs.existsSync(filePath)) {
                res.writeHead(200, { 'Content-Type': file.mime_type });
                fs.createReadStream(filePath).pipe(res);
                return;
            }
        }
        
        // Return placeholder for video/audio
        res.writeHead(302, { 'Location': '/assets/placeholder-thumbnail.png' });
        res.end();
    });
    
    // ========================================
    // CITATIONS
    // ========================================
    
    app.get('/api/papers/:uuid/cite/:format', async (req, res) => {
        const paper = papers.getPaperByUuid(req.params.uuid, false);
        
        if (!paper) {
            return res.error('Paper not found', 404);
        }
        
        const format = req.params.format.toLowerCase();
        
        try {
            const citation = citations.generateCitation(paper, format);
            
            // Set appropriate content type
            let contentType = 'text/plain';
            if (format === 'bibtex') contentType = 'application/x-bibtex';
            if (format === 'ris') contentType = 'application/x-research-info-systems';
            if (format === 'csl' || format === 'csl-json' || format === 'csljson') {
                contentType = 'application/json';
            }
            
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(citation);
            
        } catch (error) {
            res.error(error.message);
        }
    });
    
    // ========================================
    // GRABNET
    // ========================================
    
    app.get('/api/grabnet/status', async (req, res) => {
        const info = grab.getStatus();
        res.json(info);
    });
    
    app.get('/api/grabnet/site', async (req, res) => {
        const info = grab.getSiteInfo();
        res.json(info);
    });
    
    app.post('/api/grabnet/publish', auth({ required: true, admin: true }), async (req, res) => {
        try {
            const result = await grab.publishSite();
            res.json(result);
        } catch (error) {
            res.error(error.message);
        }
    });
    
    // ========================================
    // MY CONTENT
    // ========================================
    
    app.get('/api/me/papers', auth({ required: true }), async (req, res) => {
        const userPapers = papers.getPapersByUploader(req.user.id, true);
        res.json({ papers: userPapers });
    });
}

module.exports = { registerRoutes };
