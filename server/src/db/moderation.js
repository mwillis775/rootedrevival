/**
 * OpenSource Scholar - Moderation Repository
 * 
 * Database operations for content moderation and admin functions.
 */

const { getDb } = require('./index');

/**
 * Log a moderation action
 */
function logModerationAction({ moderatorId, action, targetType, targetId, reason }) {
    const db = getDb();
    
    db.prepare(`
        INSERT INTO moderation_log (moderator_id, action, target_type, target_id, reason)
        VALUES (?, ?, ?, ?, ?)
    `).run(moderatorId, action, targetType, targetId, reason);
}

/**
 * Log an audit action
 */
function logAuditAction({ userId, action, resourceType, resourceId, details, ipAddress }) {
    const db = getDb();
    
    db.prepare(`
        INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, action, resourceType, resourceId, JSON.stringify(details), ipAddress);
}

/**
 * Get moderation log
 */
function getModerationLog({ limit = 50, offset = 0, targetType = null, moderatorId = null }) {
    const db = getDb();
    
    let query = `
        SELECT ml.*, u.username as moderator_username
        FROM moderation_log ml
        LEFT JOIN users u ON ml.moderator_id = u.id
        WHERE 1=1
    `;
    
    const params = [];
    
    if (targetType) {
        query += ' AND ml.target_type = ?';
        params.push(targetType);
    }
    
    if (moderatorId) {
        query += ' AND ml.moderator_id = ?';
        params.push(moderatorId);
    }
    
    query += ' ORDER BY ml.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    return db.prepare(query).all(...params);
}

/**
 * Get audit log
 */
function getAuditLog({ limit = 50, offset = 0, userId = null, action = null }) {
    const db = getDb();
    
    let query = `
        SELECT al.*, u.username
        FROM audit_log al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE 1=1
    `;
    
    const params = [];
    
    if (userId) {
        query += ' AND al.user_id = ?';
        params.push(userId);
    }
    
    if (action) {
        query += ' AND al.action = ?';
        params.push(action);
    }
    
    query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    return db.prepare(query).all(...params);
}

/**
 * Ban a user
 */
function banUser(userId, moderatorId, reason) {
    const db = getDb();
    
    db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(userId);
    
    // Invalidate all sessions
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    
    // Log action
    logModerationAction({
        moderatorId,
        action: 'ban',
        targetType: 'user',
        targetId: userId,
        reason
    });
}

/**
 * Unban a user
 */
function unbanUser(userId, moderatorId, reason) {
    const db = getDb();
    
    db.prepare('UPDATE users SET is_banned = 0 WHERE id = ?').run(userId);
    
    logModerationAction({
        moderatorId,
        action: 'unban',
        targetType: 'user',
        targetId: userId,
        reason
    });
}

/**
 * Make user a moderator
 */
function makeModerator(userId, adminId) {
    const db = getDb();
    
    db.prepare('UPDATE users SET is_moderator = 1 WHERE id = ?').run(userId);
    
    logModerationAction({
        moderatorId: adminId,
        action: 'promote_moderator',
        targetType: 'user',
        targetId: userId,
        reason: 'Promoted to moderator'
    });
}

/**
 * Remove moderator status
 */
function removeModerator(userId, adminId) {
    const db = getDb();
    
    db.prepare('UPDATE users SET is_moderator = 0 WHERE id = ?').run(userId);
    
    logModerationAction({
        moderatorId: adminId,
        action: 'demote_moderator',
        targetType: 'user',
        targetId: userId,
        reason: 'Removed moderator status'
    });
}

/**
 * Archive a paper (soft delete)
 */
function archivePaper(paperId, moderatorId, reason) {
    const db = getDb();
    
    db.prepare("UPDATE papers SET status = 'archived' WHERE id = ?").run(paperId);
    
    logModerationAction({
        moderatorId,
        action: 'archive',
        targetType: 'paper',
        targetId: paperId,
        reason
    });
}

/**
 * Restore an archived paper
 */
function restorePaper(paperId, moderatorId, reason) {
    const db = getDb();
    
    db.prepare("UPDATE papers SET status = 'published' WHERE id = ?").run(paperId);
    
    logModerationAction({
        moderatorId,
        action: 'restore',
        targetType: 'paper',
        targetId: paperId,
        reason
    });
}

/**
 * Delete a comment
 */
function deleteComment(commentId, moderatorId, reason) {
    const db = getDb();
    
    db.prepare('UPDATE paper_comments SET is_deleted = 1 WHERE id = ?').run(commentId);
    
    logModerationAction({
        moderatorId,
        action: 'delete',
        targetType: 'comment',
        targetId: commentId,
        reason
    });
}

/**
 * Get all users (for admin)
 */
function getAllUsers({ limit = 50, offset = 0, search = null }) {
    const db = getDb();
    
    let query = `
        SELECT id, username, email, display_name, created_at, is_admin, is_moderator, is_banned,
               (SELECT COUNT(*) FROM papers WHERE uploader_id = users.id) as paper_count
        FROM users
        WHERE 1=1
    `;
    
    const params = [];
    
    if (search) {
        query += ' AND (username LIKE ? OR email LIKE ? OR display_name LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    return db.prepare(query).all(...params);
}

/**
 * Get site statistics
 */
function getSiteStats() {
    const db = getDb();
    
    const users = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const papers = db.prepare("SELECT COUNT(*) as count FROM papers WHERE status = 'published'").get();
    const drafts = db.prepare("SELECT COUNT(*) as count FROM papers WHERE status = 'draft'").get();
    const files = db.prepare('SELECT COUNT(*) as count, SUM(file_size) as total_size FROM paper_files').get();
    const pins = db.prepare("SELECT COUNT(*) as count FROM ipfs_pins WHERE status = 'pinned'").get();
    const collections = db.prepare('SELECT COUNT(*) as count FROM collections').get();
    
    const recentPapers = db.prepare(`
        SELECT COUNT(*) as count FROM papers 
        WHERE status = 'published' AND published_at > datetime('now', '-7 days')
    `).get();
    
    const recentUsers = db.prepare(`
        SELECT COUNT(*) as count FROM users 
        WHERE created_at > datetime('now', '-7 days')
    `).get();
    
    return {
        totalUsers: users.count,
        totalPapers: papers.count,
        totalDrafts: drafts.count,
        totalFiles: files.count,
        totalFileSize: files.total_size || 0,
        totalPins: pins.count,
        totalCollections: collections.count,
        papersThisWeek: recentPapers.count,
        usersThisWeek: recentUsers.count
    };
}

/**
 * Get papers pending review
 */
function getPapersPendingReview() {
    const db = getDb();
    
    return db.prepare(`
        SELECT p.*, u.username as uploader_username
        FROM papers p
        JOIN users u ON p.uploader_id = u.id
        WHERE p.status = 'under_review'
        ORDER BY p.created_at ASC
    `).all();
}

/**
 * Approve a paper
 */
function approvePaper(paperId, moderatorId) {
    const db = getDb();
    
    db.prepare(`
        UPDATE papers 
        SET status = 'published', published_at = datetime('now')
        WHERE id = ? AND status = 'under_review'
    `).run(paperId);
    
    logModerationAction({
        moderatorId,
        action: 'approve',
        targetType: 'paper',
        targetId: paperId,
        reason: 'Paper approved for publication'
    });
}

/**
 * Reject a paper
 */
function rejectPaper(paperId, moderatorId, reason) {
    const db = getDb();
    
    db.prepare(`
        UPDATE papers 
        SET status = 'draft'
        WHERE id = ? AND status = 'under_review'
    `).run(paperId);
    
    logModerationAction({
        moderatorId,
        action: 'reject',
        targetType: 'paper',
        targetId: paperId,
        reason
    });
}

module.exports = {
    logModerationAction,
    logAuditAction,
    getModerationLog,
    getAuditLog,
    banUser,
    unbanUser,
    makeModerator,
    removeModerator,
    archivePaper,
    restorePaper,
    deleteComment,
    getAllUsers,
    getSiteStats,
    getPapersPendingReview,
    approvePaper,
    rejectPaper
};
