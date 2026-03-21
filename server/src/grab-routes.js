/**
 * OpenSource Scholar - GrabNet & Profile Routes
 * 
 * Routes for user profiles, file uploads, and peer review.
 * All content is part of the unified Rooted Revival site.
 */

const { auth } = require('./http');
const grab = require('./grab');
const files = require('./db/files');
const reviews = require('./db/reviews');
const users = require('./db/users');
const config = require('./config');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Register GrabNet routes
 */
function registerGrabRoutes(app) {
    
    // ========================================
    // GRABNET STATUS
    // ========================================
    
    app.get('/api/grab/status', async (req, res) => {
        res.json({
            available: grab.isAvailable(),
            ...grab.getStatus(),
            gatewayUrl: config.grabGatewayUrl
        });
    });
    
    // ========================================
    // SITE PUBLISHING
    // ========================================
    
    // Publish the unified site to GrabNet (admin only for now)
    app.post('/api/site/publish', auth({ required: true }), async (req, res) => {
        if (!req.user.isAdmin) {
            return res.error('Admin access required', 403);
        }
        
        try {
            const result = await grab.publishSite();
            
            res.json({
                success: true,
                siteId: result.siteId,
                revision: result.revision,
                gatewayUrl: result.siteId ? grab.getGatewayUrl(result.siteId) : null
            });
        } catch (error) {
            res.error(error.message);
        }
    });
    
    // Get site info
    app.get('/api/site/info', async (req, res) => {
        res.json(grab.getSiteInfo());
    });
    
    // ========================================
    // USER PROFILES
    // ========================================
    
    // Get user profile
    app.get('/api/profiles/:username', async (req, res) => {
        const user = users.getUserByUsername(req.params.username);
        
        if (!user) {
            return res.error('User not found', 404);
        }
        
        // Get user's files
        const userFiles = files.getFilesByUser(user.id, 50, 0);
        
        // Get reviews by this user
        const userReviews = reviews.getReviewsByUser(user.id, 10, 0);
        
        res.json({
            user: {
                username: user.username,
                displayName: user.display_name,
                bio: user.bio,
                affiliation: user.affiliation,
                customization: user.customization,
                createdAt: user.created_at
            },
            files: userFiles,
            recentReviews: userReviews
        });
    });
    
    // ========================================
    // FILE UPLOADS
    // ========================================
    
    // Upload a file
    app.post('/api/me/files', auth({ required: true }), async (req, res) => {
        if (!req.files || req.files.length === 0) {
            return res.error('No file uploaded');
        }
        
        const file = req.files[0];
        const body = req.body || {};
        
        // Validate mime type
        if (!config.allowedMimeTypes.includes(file.mimeType)) {
            return res.error(`File type not allowed: ${file.mimeType}`);
        }
        
        // Validate file size
        if (file.size > config.maxFileSize) {
            return res.error(`File too large. Maximum size: ${config.maxFileSize / 1024 / 1024}MB`);
        }
        
        try {
            // Calculate file hash
            const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
            
            // Add file to the unified site
            const stored = grab.addFileToSite(req.user.username, file.buffer, file.filename, {
                title: body.title,
                description: body.description,
                contentType: body.contentType || 'other',
                tags: body.tags ? body.tags.split(',').map(t => t.trim()) : []
            });
            
            // Parse tags
            const tags = body.tags ? body.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
            
            // Create database record
            const result = files.createFile({
                userId: req.user.id,
                filename: stored.filename,
                originalFilename: file.filename,
                mimeType: file.mimeType,
                fileSize: file.size,
                fileHash: hash,
                grabPath: stored.relativePath,
                title: body.title || file.filename,
                description: body.description,
                contentType: body.contentType || 'other',
                isScientific: body.isScientific === 'true' || body.isScientific === true,
                license: body.license || 'CC-BY-4.0',
                tags
            });
            
            res.json({
                success: true,
                file: {
                    uuid: result.uuid,
                    filename: stored.filename,
                    path: stored.relativePath,
                    url: stored.url
                }
            }, 201);
            
            grab.schedulePublish();
            
        } catch (error) {
            res.error(error.message);
        }
    });
    
    // Get my files
    app.get('/api/me/files', auth({ required: true }), async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = parseInt(req.query.offset) || 0;
        
        const userFiles = files.getFilesByUser(req.user.id, limit, offset);
        
        res.json({ files: userFiles });
    });
    
    // Update file metadata
    app.put('/api/files/:uuid', auth({ required: true }), async (req, res) => {
        const file = files.getFileByUuid(req.params.uuid);
        
        if (!file) {
            return res.error('File not found', 404);
        }
        
        if (file.user_id !== req.user.id && !req.user.isAdmin) {
            return res.error('Not authorized', 403);
        }
        
        const updates = {};
        const body = req.body || {};
        
        if (body.title) updates.title = body.title;
        if (body.description !== undefined) updates.description = body.description;
        if (body.contentType) updates.contentType = body.contentType;
        if (body.isScientific !== undefined) updates.isScientific = body.isScientific;
        if (body.license) updates.license = body.license;
        if (body.tags) updates.tags = body.tags;
        
        files.updateFile(file.id, updates);
        
        res.json({ success: true });
    });
    
    // Delete file
    app.delete('/api/files/:uuid', auth({ required: true }), async (req, res) => {
        const file = files.getFileByUuid(req.params.uuid);
        
        if (!file) {
            return res.error('File not found', 404);
        }
        
        if (file.user_id !== req.user.id && !req.user.isAdmin) {
            return res.error('Not authorized', 403);
        }
        
        // Delete from filesystem
        grab.deleteFileFromSite(file.username, file.filename);
        
        // Delete from database
        files.deleteFile(file.id);
        
        res.json({ success: true });
        grab.schedulePublish();
    });
    
    // ========================================
    // FILE BROWSING
    // ========================================
    
    // Get file by UUID
    app.get('/api/files/:uuid', async (req, res) => {
        const file = files.getFileByUuid(req.params.uuid);
        
        if (!file) {
            return res.error('File not found', 404);
        }
        
        // Increment view count
        files.incrementViewCount(file.id);
        
        // Get reviews if scientific
        let fileReviews = [];
        let reviewStats = null;
        
        if (file.is_scientific) {
            fileReviews = reviews.getReviewsForFile(file.id);
            reviewStats = reviews.getReviewStats(file.id);
        }
        
        res.json({
            file,
            reviews: fileReviews,
            reviewStats
        });
    });
    
    // Get recent files (browse)
    app.get('/api/browse/recent', async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const contentType = req.query.type || null;
        
        const recentFiles = files.getRecentFiles(limit, contentType);
        
        res.json({ files: recentFiles });
    });
    
    // Get files by content type
    app.get('/api/browse/type/:type', async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = parseInt(req.query.offset) || 0;
        
        const typeFiles = files.getFilesByType(req.params.type, limit, offset);
        
        res.json({ files: typeFiles });
    });
    
    // Search files
    app.get('/api/browse/search', async (req, res) => {
        const query = req.query.q || '';
        const contentType = req.query.type || null;
        const tag = req.query.tag || null;
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = parseInt(req.query.offset) || 0;
        
        const results = files.searchFiles(query, {
            contentType,
            tag,
            limit,
            offset
        });
        
        res.json({ files: results });
    });
    
    // Get files awaiting peer review
    app.get('/api/browse/needs-review', async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        
        const awaitingReview = files.getFilesAwaitingReview(limit);
        
        res.json({ files: awaitingReview });
    });
    
    // Get popular tags
    app.get('/api/tags', async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        
        const tags = files.getPopularTags(limit);
        
        res.json({ tags });
    });
    
    // ========================================
    // FILE STREAMING & DOWNLOAD
    // ========================================
    
    // Stream file (for viewing/playing)
    app.get('/api/files/:uuid/stream', async (req, res) => {
        const file = files.getFileByUuid(req.params.uuid);
        
        if (!file) {
            return res.error('File not found', 404);
        }
        
        const filePath = path.join(grab.getUserUploadsDir(file.username), file.filename);
        
        if (!fs.existsSync(filePath)) {
            return res.error('File not found on disk', 404);
        }
        
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        // Handle range requests for video/audio
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
    
    // Download file
    app.get('/api/files/:uuid/download', async (req, res) => {
        const file = files.getFileByUuid(req.params.uuid);
        
        if (!file) {
            return res.error('File not found', 404);
        }
        
        const filePath = path.join(grab.getUserUploadsDir(file.username), file.filename);
        
        if (!fs.existsSync(filePath)) {
            return res.error('File not found on disk', 404);
        }
        
        // Increment download count
        files.incrementDownloadCount(file.id);
        
        const stat = fs.statSync(filePath);
        
        res.writeHead(200, {
            'Content-Type': file.mime_type,
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename="${file.original_filename}"`
        });
        
        fs.createReadStream(filePath).pipe(res);
    });
    
    // ========================================
    // PEER REVIEW
    // ========================================
    
    // Submit a review
    app.post('/api/files/:uuid/reviews', auth({ required: true }), async (req, res) => {
        const file = files.getFileByUuid(req.params.uuid);
        
        if (!file) {
            return res.error('File not found', 404);
        }
        
        if (!file.is_scientific) {
            return res.error('Only scientific content can be reviewed', 400);
        }
        
        // Can't review your own content
        if (file.user_id === req.user.id) {
            return res.error('You cannot review your own content', 400);
        }
        
        // Check if already reviewed
        if (reviews.hasUserReviewed(req.user.id, file.id)) {
            return res.error('You have already reviewed this content', 400);
        }
        
        const body = req.body || {};
        
        if (!body.summary || !body.overallScore) {
            return res.error('Summary and overall score are required');
        }
        
        try {
            const result = reviews.createReview({
                fileId: file.id,
                reviewerId: req.user.id,
                summary: body.summary,
                methodologyScore: body.methodologyScore,
                originalityScore: body.originalityScore,
                clarityScore: body.clarityScore,
                significanceScore: body.significanceScore,
                overallScore: body.overallScore,
                detailedReview: body.detailedReview,
                strengths: body.strengths,
                weaknesses: body.weaknesses,
                suggestions: body.suggestions
            });
            
            res.json({
                success: true,
                review: { uuid: result.uuid }
            }, 201);
            
        } catch (error) {
            res.error(error.message);
        }
    });
    
    // Get reviews for a file
    app.get('/api/files/:uuid/reviews', async (req, res) => {
        const file = files.getFileByUuid(req.params.uuid);
        
        if (!file) {
            return res.error('File not found', 404);
        }
        
        const fileReviews = reviews.getReviewsForFile(file.id);
        const stats = reviews.getReviewStats(file.id);
        
        res.json({
            reviews: fileReviews,
            stats
        });
    });
    
    // Get a specific review
    app.get('/api/reviews/:uuid', async (req, res) => {
        const review = reviews.getReviewByUuid(req.params.uuid);
        
        if (!review) {
            return res.error('Review not found', 404);
        }
        
        res.json({ review });
    });
    
    // Vote on a review
    app.post('/api/reviews/:uuid/vote', auth({ required: true }), async (req, res) => {
        const review = reviews.getReviewByUuid(req.params.uuid);
        
        if (!review) {
            return res.error('Review not found', 404);
        }
        
        // Can't vote on your own review
        if (review.reviewer_id === req.user.id) {
            return res.error('You cannot vote on your own review', 400);
        }
        
        const { vote } = req.body || {};
        
        if (vote !== 1 && vote !== -1) {
            return res.error('Vote must be 1 (helpful) or -1 (not helpful)');
        }
        
        const result = reviews.voteOnReview(req.user.id, review.id, vote);
        
        res.json(result);
    });
    
    // Respond to a review (author only)
    app.post('/api/reviews/:uuid/respond', auth({ required: true }), async (req, res) => {
        const review = reviews.getReviewByUuid(req.params.uuid);
        
        if (!review) {
            return res.error('Review not found', 404);
        }
        
        const { response } = req.body || {};
        
        if (!response || response.trim().length === 0) {
            return res.error('Response text is required');
        }
        
        try {
            reviews.addReviewResponse(review.id, req.user.id, response);
            res.json({ success: true });
        } catch (error) {
            res.error(error.message, 403);
        }
    });
    
    // Get my reviews
    app.get('/api/me/reviews', auth({ required: true }), async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = parseInt(req.query.offset) || 0;
        
        const myReviews = reviews.getReviewsByUser(req.user.id, limit, offset);
        
        res.json({ reviews: myReviews });
    });
    
    // Get recent reviews (community activity)
    app.get('/api/reviews/recent', async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        
        const recentReviews = reviews.getRecentReviews(limit);
        
        res.json({ reviews: recentReviews });
    });
    
    // Get top reviewers
    app.get('/api/reviewers/top', async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        
        const topReviewers = reviews.getTopReviewers(limit);
        
        res.json({ reviewers: topReviewers });
    });
}

module.exports = { registerGrabRoutes };
