/**
 * OpenSource Scholar - Collections Repository
 * 
 * Database operations for collections/reading lists.
 */

const { getDb, generateUuid } = require('./index');

/**
 * Create a new collection
 */
function createCollection({ ownerId, name, description, visibility = 'public' }) {
    const db = getDb();
    const uuid = generateUuid();
    
    const result = db.prepare(`
        INSERT INTO collections (uuid, owner_id, name, description, visibility)
        VALUES (?, ?, ?, ?, ?)
    `).run(uuid, ownerId, name, description, visibility);
    
    return { id: result.lastInsertRowid, uuid };
}

/**
 * Add paper to collection
 */
function addToCollection(collectionId, paperId, note = null) {
    const db = getDb();
    
    // Get max sort order
    const max = db.prepare(
        'SELECT MAX(sort_order) as max_order FROM collection_papers WHERE collection_id = ?'
    ).get(collectionId);
    
    const sortOrder = (max?.max_order || 0) + 1;
    
    db.prepare(`
        INSERT OR IGNORE INTO collection_papers (collection_id, paper_id, note, sort_order)
        VALUES (?, ?, ?, ?)
    `).run(collectionId, paperId, note, sortOrder);
}

/**
 * Remove paper from collection
 */
function removeFromCollection(collectionId, paperId) {
    const db = getDb();
    db.prepare('DELETE FROM collection_papers WHERE collection_id = ? AND paper_id = ?')
        .run(collectionId, paperId);
}

/**
 * Get collection by UUID
 */
function getCollectionByUuid(uuid) {
    const db = getDb();
    
    const collection = db.prepare(`
        SELECT c.*, u.username as owner_username, u.display_name as owner_name
        FROM collections c
        JOIN users u ON c.owner_id = u.id
        WHERE c.uuid = ?
    `).get(uuid);
    
    if (!collection) return null;
    
    // Get papers in collection
    collection.papers = db.prepare(`
        SELECT p.id, p.uuid, p.title, p.publication_year, p.paper_type,
               cp.note, cp.sort_order, cp.added_at
        FROM collection_papers cp
        JOIN papers p ON cp.paper_id = p.id
        WHERE cp.collection_id = ?
        ORDER BY cp.sort_order
    `).all(collection.id);
    
    return collection;
}

/**
 * Get user's collections
 */
function getUserCollections(userId) {
    const db = getDb();
    
    const collections = db.prepare(`
        SELECT c.*, 
               (SELECT COUNT(*) FROM collection_papers WHERE collection_id = c.id) as paper_count
        FROM collections c
        WHERE c.owner_id = ?
        ORDER BY c.updated_at DESC
    `).all(userId);
    
    return collections;
}

/**
 * Get public collections
 */
function getPublicCollections(limit = 20, offset = 0) {
    const db = getDb();
    
    return db.prepare(`
        SELECT c.*, u.username as owner_username, u.display_name as owner_name,
               (SELECT COUNT(*) FROM collection_papers WHERE collection_id = c.id) as paper_count
        FROM collections c
        JOIN users u ON c.owner_id = u.id
        WHERE c.visibility = 'public'
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?
    `).all(limit, offset);
}

/**
 * Update collection
 */
function updateCollection(collectionId, { name, description, visibility }) {
    const db = getDb();
    
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
        updates.push('name = ?');
        params.push(name);
    }
    if (description !== undefined) {
        updates.push('description = ?');
        params.push(description);
    }
    if (visibility !== undefined) {
        updates.push('visibility = ?');
        params.push(visibility);
    }
    
    if (updates.length === 0) return;
    
    updates.push("updated_at = datetime('now')");
    params.push(collectionId);
    
    db.prepare(`UPDATE collections SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

/**
 * Delete collection
 */
function deleteCollection(collectionId) {
    const db = getDb();
    db.prepare('DELETE FROM collections WHERE id = ?').run(collectionId);
}

/**
 * Bookmark a paper
 */
function bookmarkPaper(userId, paperId) {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO paper_bookmarks (user_id, paper_id) VALUES (?, ?)')
        .run(userId, paperId);
}

/**
 * Remove bookmark
 */
function unbookmarkPaper(userId, paperId) {
    const db = getDb();
    db.prepare('DELETE FROM paper_bookmarks WHERE user_id = ? AND paper_id = ?')
        .run(userId, paperId);
}

/**
 * Get user's bookmarks
 */
function getUserBookmarks(userId) {
    const db = getDb();
    
    return db.prepare(`
        SELECT p.id, p.uuid, p.title, p.publication_year, p.paper_type, pb.created_at as bookmarked_at
        FROM paper_bookmarks pb
        JOIN papers p ON pb.paper_id = p.id
        WHERE pb.user_id = ?
        ORDER BY pb.created_at DESC
    `).all(userId);
}

/**
 * Check if paper is bookmarked by user
 */
function isBookmarked(userId, paperId) {
    const db = getDb();
    const result = db.prepare(
        'SELECT 1 FROM paper_bookmarks WHERE user_id = ? AND paper_id = ?'
    ).get(userId, paperId);
    return !!result;
}

module.exports = {
    createCollection,
    addToCollection,
    removeFromCollection,
    getCollectionByUuid,
    getUserCollections,
    getPublicCollections,
    updateCollection,
    deleteCollection,
    bookmarkPaper,
    unbookmarkPaper,
    getUserBookmarks,
    isBookmarked
};
