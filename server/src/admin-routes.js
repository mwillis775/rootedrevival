/**
 * OpenSource Scholar - Admin API Routes
 * 
 * Routes for moderation and administration.
 */

const moderation = require('./db/moderation');
const users = require('./db/users');
const papers = require('./db/papers');
const collections = require('./db/collections');
const { auth } = require('./http');

/**
 * Middleware to require admin or moderator role
 */
function requireMod(req, res, next) {
    if (!req.user || (!req.user.isAdmin && !req.user.isModerator)) {
        return res.error('Forbidden', 403);
    }
    return next();
}

/**
 * Middleware to require admin role
 */
function requireAdmin(req, res, next) {
    if (!req.user || !req.user.isAdmin) {
        return res.error('Forbidden', 403);
    }
    return next();
}

function requireElevatedAdmin(req, res, next) {
    if (!req.user || !req.user.isAdmin) {
        return res.error('Forbidden', 403);
    }

    if (!req.u2fVerified) {
        return res.error('Hardware key verification required', 403);
    }

    return next();
}

function requireProtectedAdminAction(req, res, next) {
    if (!req.user || (!req.user.isAdmin && !req.user.isModerator)) {
        return res.error('Forbidden', 403);
    }

    if (req.user.isAdmin && !req.u2fVerified) {
        return res.error('Hardware key verification required', 403);
    }

    return next();
}

/**
 * Register admin routes
 */
function registerAdminRoutes(app) {
    
    // ========================================
    // SITE STATS (Admin/Mod)
    // ========================================
    
    app.get('/api/admin/stats', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireMod(req, res, async () => {
                const stats = moderation.getSiteStats();
                res.json(stats);
            });
        });
    });
    
    // ========================================
    // USER MANAGEMENT
    // ========================================
    
    app.get('/api/admin/users', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireMod(req, res, async () => {
                const { search, limit = 50, offset = 0 } = req.query;
                const userList = moderation.getAllUsers({
                    search,
                    limit: Math.min(parseInt(limit), 100),
                    offset: parseInt(offset)
                });
                res.json({ users: userList });
            });
        });
    });
    
    app.post('/api/admin/users/:id/ban', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireProtectedAdminAction(req, res, async () => {
                const { reason } = req.body || {};
                moderation.banUser(parseInt(req.params.id), req.user.id, reason);
                res.json({ success: true });
            });
        });
    });
    
    app.post('/api/admin/users/:id/unban', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireProtectedAdminAction(req, res, async () => {
                const { reason } = req.body || {};
                moderation.unbanUser(parseInt(req.params.id), req.user.id, reason);
                res.json({ success: true });
            });
        });
    });
    
    app.post('/api/admin/users/:id/moderator', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireElevatedAdmin(req, res, async () => {
                moderation.makeModerator(parseInt(req.params.id), req.user.id);
                res.json({ success: true });
            });
        });
    });
    
    app.delete('/api/admin/users/:id/moderator', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireElevatedAdmin(req, res, async () => {
                moderation.removeModerator(parseInt(req.params.id), req.user.id);
                res.json({ success: true });
            });
        });
    });
    
    // ========================================
    // PAPER MODERATION
    // ========================================
    
    app.get('/api/admin/papers/pending', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireMod(req, res, async () => {
                const pending = moderation.getPapersPendingReview();
                res.json({ papers: pending });
            });
        });
    });
    
    app.post('/api/admin/papers/:id/approve', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireProtectedAdminAction(req, res, async () => {
                moderation.approvePaper(parseInt(req.params.id), req.user.id);
                res.json({ success: true });
            });
        });
    });
    
    app.post('/api/admin/papers/:id/reject', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireProtectedAdminAction(req, res, async () => {
                const { reason } = req.body || {};
                moderation.rejectPaper(parseInt(req.params.id), req.user.id, reason);
                res.json({ success: true });
            });
        });
    });
    
    app.post('/api/admin/papers/:id/archive', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireProtectedAdminAction(req, res, async () => {
                const { reason } = req.body || {};
                moderation.archivePaper(parseInt(req.params.id), req.user.id, reason);
                res.json({ success: true });
            });
        });
    });
    
    app.post('/api/admin/papers/:id/restore', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireProtectedAdminAction(req, res, async () => {
                const { reason } = req.body || {};
                moderation.restorePaper(parseInt(req.params.id), req.user.id, reason);
                res.json({ success: true });
            });
        });
    });
    
    // ========================================
    // MODERATION LOG
    // ========================================
    
    app.get('/api/admin/moderation-log', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireMod(req, res, async () => {
                const { targetType, moderatorId, limit = 50, offset = 0 } = req.query;
                const log = moderation.getModerationLog({
                    targetType,
                    moderatorId: moderatorId ? parseInt(moderatorId) : null,
                    limit: Math.min(parseInt(limit), 100),
                    offset: parseInt(offset)
                });
                res.json({ log });
            });
        });
    });
    
    app.get('/api/admin/audit-log', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const { userId, action, limit = 50, offset = 0 } = req.query;
                const log = moderation.getAuditLog({
                    userId: userId ? parseInt(userId) : null,
                    action,
                    limit: Math.min(parseInt(limit), 100),
                    offset: parseInt(offset)
                });
                res.json({ log });
            });
        });
    });
    
    // ========================================
    // COLLECTIONS (for all users)
    // ========================================
    
    app.get('/api/collections', async (req, res) => {
        const { limit = 20, offset = 0 } = req.query;
        const colls = collections.getPublicCollections(
            Math.min(parseInt(limit), 50),
            parseInt(offset)
        );
        res.json({ collections: colls });
    });
    
    app.get('/api/collections/:uuid', async (req, res) => {
        const collection = collections.getCollectionByUuid(req.params.uuid);
        if (!collection) {
            return res.error('Collection not found', 404);
        }
        res.json({ collection });
    });
    
    app.post('/api/collections', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            const { name, description, visibility } = req.body || {};
            
            if (!name) {
                return res.error('Name is required');
            }
            
            const result = collections.createCollection({
                ownerId: req.user.id,
                name,
                description,
                visibility
            });
            
            res.json({ success: true, collection: result }, 201);
        });
    });
    
    app.post('/api/collections/:uuid/papers', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            const collection = collections.getCollectionByUuid(req.params.uuid);
            
            if (!collection) {
                return res.error('Collection not found', 404);
            }
            
            if (collection.owner_id !== req.user.id) {
                return res.error('Not authorized', 403);
            }
            
            const { paperUuid, note } = req.body || {};
            
            const paper = papers.getPaperByUuid(paperUuid, false);
            if (!paper) {
                return res.error('Paper not found', 404);
            }
            
            collections.addToCollection(collection.id, paper.id, note);
            res.json({ success: true });
        });
    });
    
    app.get('/api/me/collections', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            const colls = collections.getUserCollections(req.user.id);
            res.json({ collections: colls });
        });
    });
    
    app.get('/api/me/bookmarks', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            const bookmarks = collections.getUserBookmarks(req.user.id);
            res.json({ bookmarks });
        });
    });
    
    app.post('/api/papers/:uuid/bookmark', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            const paper = papers.getPaperByUuid(req.params.uuid, false);
            
            if (!paper) {
                return res.error('Paper not found', 404);
            }
            
            collections.bookmarkPaper(req.user.id, paper.id);
            res.json({ success: true });
        });
    });
    
    app.delete('/api/papers/:uuid/bookmark', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            const paper = papers.getPaperByUuid(req.params.uuid, false);
            
            if (!paper) {
                return res.error('Paper not found', 404);
            }
            
            collections.unbookmarkPaper(req.user.id, paper.id);
            res.json({ success: true });
        });
    });
}

module.exports = { registerAdminRoutes };
