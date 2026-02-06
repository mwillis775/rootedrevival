/**
 * OpenSource Scholar - User Files Database Module
 * 
 * Manages user file uploads and GrabNet site integration.
 */

const { getDb } = require('./index');
const crypto = require('crypto');

/**
 * Generate a UUID
 */
function generateUuid() {
    return crypto.randomUUID();
}

/**
 * Get or create user's site record
 */
function getOrCreateUserSite(userId, username) {
    const db = getDb();
    
    let site = db.prepare('SELECT * FROM user_sites WHERE user_id = ?').get(userId);
    
    if (!site) {
        const siteName = `scholar-${username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        
        db.prepare(`
            INSERT INTO user_sites (user_id, site_name, status)
            VALUES (?, ?, 'draft')
        `).run(userId, siteName);
        
        site = db.prepare('SELECT * FROM user_sites WHERE user_id = ?').get(userId);
    }
    
    return site;
}

/**
 * Update user site after publishing
 */
function updateUserSite(userId, siteId, revision) {
    const db = getDb();
    
    db.prepare(`
        UPDATE user_sites 
        SET site_id = ?, revision = ?, last_published = datetime('now'), 
            status = 'published', updated_at = datetime('now')
        WHERE user_id = ?
    `).run(siteId, revision, userId);
}

/**
 * Get user's site by username
 */
function getUserSiteByUsername(username) {
    const db = getDb();
    
    return db.prepare(`
        SELECT us.*, u.username, u.display_name, u.bio
        FROM user_sites us
        JOIN users u ON us.user_id = u.id
        WHERE u.username = ?
    `).get(username);
}

/**
 * Create a new file upload
 */
function createFile({
    userId,
    filename,
    originalFilename,
    mimeType,
    fileSize,
    fileHash,
    grabPath,
    title,
    description,
    contentType = 'other',
    isScientific = false,
    license = 'CC-BY-4.0',
    tags = []
}) {
    const db = getDb();
    const uuid = generateUuid();
    
    const result = db.prepare(`
        INSERT INTO user_files (
            uuid, user_id, filename, original_filename, mime_type,
            file_size, file_hash, grab_path, title, description,
            content_type, is_scientific, license
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        uuid, userId, filename, originalFilename, mimeType,
        fileSize, fileHash, grabPath, title || originalFilename, description,
        contentType, isScientific ? 1 : 0, license
    );
    
    const fileId = result.lastInsertRowid;
    
    // Add tags
    if (tags.length > 0) {
        const insertTag = db.prepare(
            'INSERT OR IGNORE INTO file_tags (file_id, tag) VALUES (?, ?)'
        );
        
        for (const tag of tags) {
            insertTag.run(fileId, tag.toLowerCase().trim());
        }
    }
    
    // Update user site stats
    db.prepare(`
        UPDATE user_sites 
        SET total_files = total_files + 1,
            total_size_bytes = total_size_bytes + ?,
            updated_at = datetime('now')
        WHERE user_id = ?
    `).run(fileSize, userId);
    
    return { uuid, id: fileId };
}

/**
 * Get file by UUID
 */
function getFileByUuid(uuid) {
    const db = getDb();
    
    const file = db.prepare(`
        SELECT uf.*, u.username, u.display_name as uploader_name,
               us.site_id, us.site_name
        FROM user_files uf
        JOIN users u ON uf.user_id = u.id
        LEFT JOIN user_sites us ON uf.user_id = us.user_id
        WHERE uf.uuid = ?
    `).get(uuid);
    
    if (file) {
        // Get tags
        file.tags = db.prepare(
            'SELECT tag FROM file_tags WHERE file_id = ?'
        ).all(file.id).map(t => t.tag);
        
        // Get review stats if scientific
        if (file.is_scientific) {
            const reviewStats = db.prepare(`
                SELECT COUNT(*) as review_count,
                       AVG(overall_score) as avg_score
                FROM peer_reviews WHERE file_id = ?
            `).get(file.id);
            
            file.reviewCount = reviewStats.review_count;
            file.avgScore = reviewStats.avg_score;
        }
    }
    
    return file;
}

/**
 * Get file by ID
 */
function getFileById(id) {
    const db = getDb();
    
    const file = db.prepare(`
        SELECT uf.*, u.username, u.display_name as uploader_name
        FROM user_files uf
        JOIN users u ON uf.user_id = u.id
        WHERE uf.id = ?
    `).get(id);
    
    if (file) {
        file.tags = db.prepare(
            'SELECT tag FROM file_tags WHERE file_id = ?'
        ).all(file.id).map(t => t.tag);
    }
    
    return file;
}

/**
 * Get files by user
 */
function getFilesByUser(userId, limit = 50, offset = 0) {
    const db = getDb();
    
    const files = db.prepare(`
        SELECT uf.*, u.username
        FROM user_files uf
        JOIN users u ON uf.user_id = u.id
        WHERE uf.user_id = ?
        ORDER BY uf.created_at DESC
        LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
    
    const getTags = db.prepare('SELECT tag FROM file_tags WHERE file_id = ?');
    
    for (const file of files) {
        file.tags = getTags.all(file.id).map(t => t.tag);
    }
    
    return files;
}

/**
 * Get files by content type
 */
function getFilesByType(contentType, limit = 20, offset = 0) {
    const db = getDb();
    
    const files = db.prepare(`
        SELECT uf.*, u.username, u.display_name as uploader_name,
               us.site_id, us.site_name
        FROM user_files uf
        JOIN users u ON uf.user_id = u.id
        LEFT JOIN user_sites us ON uf.user_id = us.user_id
        WHERE uf.content_type = ?
        ORDER BY uf.created_at DESC
        LIMIT ? OFFSET ?
    `).all(contentType, limit, offset);
    
    const getTags = db.prepare('SELECT tag FROM file_tags WHERE file_id = ?');
    
    for (const file of files) {
        file.tags = getTags.all(file.id).map(t => t.tag);
    }
    
    return files;
}

/**
 * Get recent files
 */
function getRecentFiles(limit = 20, contentType = null) {
    const db = getDb();
    
    let sql = `
        SELECT uf.*, u.username, u.display_name as uploader_name,
               us.site_id
        FROM user_files uf
        JOIN users u ON uf.user_id = u.id
        LEFT JOIN user_sites us ON uf.user_id = us.user_id
    `;
    
    const params = [];
    
    if (contentType) {
        sql += ' WHERE uf.content_type = ?';
        params.push(contentType);
    }
    
    sql += ' ORDER BY uf.created_at DESC LIMIT ?';
    params.push(limit);
    
    const files = db.prepare(sql).all(...params);
    
    const getTags = db.prepare('SELECT tag FROM file_tags WHERE file_id = ?');
    
    for (const file of files) {
        file.tags = getTags.all(file.id).map(t => t.tag);
    }
    
    return files;
}

/**
 * Get scientific files awaiting review
 */
function getFilesAwaitingReview(limit = 20) {
    const db = getDb();
    
    return db.prepare(`
        SELECT uf.*, u.username, u.display_name as uploader_name,
               (SELECT COUNT(*) FROM peer_reviews WHERE file_id = uf.id) as review_count
        FROM user_files uf
        JOIN users u ON uf.user_id = u.id
        WHERE uf.is_scientific = 1
        ORDER BY review_count ASC, uf.created_at DESC
        LIMIT ?
    `).all(limit);
}

/**
 * Search files
 */
function searchFiles(query, filters = {}) {
    const db = getDb();
    
    let sql = `
        SELECT uf.*, u.username, u.display_name as uploader_name
        FROM user_files uf
        JOIN users u ON uf.user_id = u.id
        WHERE 1=1
    `;
    
    const params = [];
    
    if (query) {
        sql += ` AND (
            uf.title LIKE ? OR 
            uf.description LIKE ? OR 
            uf.original_filename LIKE ?
        )`;
        const searchTerm = `%${query}%`;
        params.push(searchTerm, searchTerm, searchTerm);
    }
    
    if (filters.contentType) {
        sql += ' AND uf.content_type = ?';
        params.push(filters.contentType);
    }
    
    if (filters.isScientific !== undefined) {
        sql += ' AND uf.is_scientific = ?';
        params.push(filters.isScientific ? 1 : 0);
    }
    
    if (filters.tag) {
        sql += ' AND uf.id IN (SELECT file_id FROM file_tags WHERE tag = ?)';
        params.push(filters.tag.toLowerCase());
    }
    
    if (filters.userId) {
        sql += ' AND uf.user_id = ?';
        params.push(filters.userId);
    }
    
    sql += ' ORDER BY uf.created_at DESC LIMIT ? OFFSET ?';
    params.push(filters.limit || 20, filters.offset || 0);
    
    const files = db.prepare(sql).all(...params);
    
    const getTags = db.prepare('SELECT tag FROM file_tags WHERE file_id = ?');
    
    for (const file of files) {
        file.tags = getTags.all(file.id).map(t => t.tag);
    }
    
    return files;
}

/**
 * Update file metadata
 */
function updateFile(id, updates) {
    const db = getDb();
    
    const allowedFields = ['title', 'description', 'content_type', 'is_scientific', 'license'];
    const setClauses = [];
    const params = [];
    
    for (const [key, value] of Object.entries(updates)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (allowedFields.includes(dbKey)) {
            setClauses.push(`${dbKey} = ?`);
            params.push(value);
        }
    }
    
    if (setClauses.length > 0) {
        setClauses.push(`updated_at = datetime('now')`);
        params.push(id);
        
        db.prepare(`
            UPDATE user_files SET ${setClauses.join(', ')} WHERE id = ?
        `).run(...params);
    }
    
    // Update tags if provided
    if (updates.tags && Array.isArray(updates.tags)) {
        db.prepare('DELETE FROM file_tags WHERE file_id = ?').run(id);
        
        const insertTag = db.prepare(
            'INSERT OR IGNORE INTO file_tags (file_id, tag) VALUES (?, ?)'
        );
        
        for (const tag of updates.tags) {
            insertTag.run(id, tag.toLowerCase().trim());
        }
    }
}

/**
 * Delete file
 */
function deleteFile(id) {
    const db = getDb();
    
    const file = db.prepare('SELECT user_id, file_size FROM user_files WHERE id = ?').get(id);
    
    if (file) {
        db.prepare('DELETE FROM user_files WHERE id = ?').run(id);
        
        // Update user site stats
        db.prepare(`
            UPDATE user_sites 
            SET total_files = total_files - 1,
                total_size_bytes = total_size_bytes - ?,
                updated_at = datetime('now')
            WHERE user_id = ?
        `).run(file.file_size, file.user_id);
    }
}

/**
 * Increment view count
 */
function incrementViewCount(fileId) {
    const db = getDb();
    db.prepare('UPDATE user_files SET view_count = view_count + 1 WHERE id = ?').run(fileId);
}

/**
 * Increment download count
 */
function incrementDownloadCount(fileId) {
    const db = getDb();
    db.prepare('UPDATE user_files SET download_count = download_count + 1 WHERE id = ?').run(fileId);
}

/**
 * Get popular tags
 */
function getPopularTags(limit = 50) {
    const db = getDb();
    
    return db.prepare(`
        SELECT tag, COUNT(*) as count
        FROM file_tags
        GROUP BY tag
        ORDER BY count DESC
        LIMIT ?
    `).all(limit);
}

module.exports = {
    getOrCreateUserSite,
    updateUserSite,
    getUserSiteByUsername,
    createFile,
    getFileByUuid,
    getFileById,
    getFilesByUser,
    getFilesByType,
    getRecentFiles,
    getFilesAwaitingReview,
    searchFiles,
    updateFile,
    deleteFile,
    incrementViewCount,
    incrementDownloadCount,
    getPopularTags
};
