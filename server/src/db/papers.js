/**
 * OpenSource Scholar - Papers Repository
 * 
 * Database operations for papers, files, and versions.
 */

const { getDb, generateUuid, transaction } = require('./index');
const { hashFile } = require('../crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Create a new paper with metadata
 */
function createPaper({
    uploaderId,
    title,
    abstract = null,
    publicationYear = null,
    publicationDate = null,
    language = 'en',
    doi = null,
    isbn = null,
    arxivId = null,
    pmid = null,
    paperType = 'paper',
    license = 'CC-BY-4.0',
    visibility = 'public',
    authors = [],
    disciplines = [],
    keywords = []
}) {
    const db = getDb();
    const uuid = generateUuid();
    
    return transaction(() => {
        // Insert paper
        const result = db.prepare(`
            INSERT INTO papers (
                uuid, uploader_id, title, abstract, publication_year, publication_date,
                language, doi, isbn, arxiv_id, pmid, paper_type, license, visibility, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
        `).run(
            uuid, uploaderId, title, abstract, publicationYear, publicationDate,
            language, doi, isbn, arxivId, pmid, paperType, license, visibility
        );
        
        const paperId = result.lastInsertRowid;
        
        // Insert authors
        const insertAuthor = db.prepare(`
            INSERT INTO paper_authors (paper_id, user_id, author_name, author_email, affiliation, orcid, author_order, is_corresponding)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        authors.forEach((author, index) => {
            insertAuthor.run(
                paperId,
                author.userId || null,
                author.name,
                author.email || null,
                author.affiliation || null,
                author.orcid || null,
                index,
                author.isCorresponding ? 1 : 0
            );
        });
        
        // Insert disciplines (accepts integer IDs or string slugs)
        const insertDiscipline = db.prepare(`
            INSERT INTO paper_disciplines (paper_id, discipline_id, is_primary)
            VALUES (?, ?, ?)
        `);
        
        const lookupSlug = db.prepare('SELECT id FROM disciplines WHERE slug = ?');
        
        disciplines.forEach((disc, index) => {
            let discId = typeof disc === 'number' ? disc : parseInt(disc, 10);
            if (isNaN(discId)) {
                // Treat as slug
                const row = lookupSlug.get(disc);
                if (!row) return; // skip unknown disciplines
                discId = row.id;
            }
            insertDiscipline.run(paperId, discId, index === 0 ? 1 : 0);
        });
        
        // Insert keywords
        const insertKeyword = db.prepare('INSERT INTO paper_keywords (paper_id, keyword) VALUES (?, ?)');
        keywords.forEach(keyword => {
            insertKeyword.run(paperId, keyword.toLowerCase().trim());
        });
        
        // Update FTS with author names and keywords
        // The trigger inserts a row with empty keywords/author_names.
        // Replace it with the full data.
        const authorNames = authors.map(a => a.name).join(', ');
        const keywordStr = keywords.join(', ');
        db.prepare('DELETE FROM papers_fts WHERE rowid = ?').run(paperId);
        db.prepare(`
            INSERT INTO papers_fts(rowid, title, abstract, keywords, author_names)
            VALUES (?, ?, ?, ?, ?)
        `).run(paperId, title, abstract || '', keywordStr, authorNames);
        
        return { id: paperId, uuid };
    });
}

/**
 * Add a file to a paper
 */
function addPaperFile({
    paperId,
    fileBuffer,
    originalFilename,
    mimeType,
    fileType = 'main',
    versionNote = null
}) {
    const db = getDb();
    
    // Generate file hash
    const fileHash = hashFile(fileBuffer);
    
    // Check for duplicate
    const existing = db.prepare(
        'SELECT id FROM paper_files WHERE paper_id = ? AND file_hash = ?'
    ).get(paperId, fileHash);
    
    if (existing) {
        throw new Error('This exact file has already been uploaded');
    }
    
    // Get current version number
    const lastVersion = db.prepare(
        'SELECT MAX(version) as max_version FROM paper_files WHERE paper_id = ? AND file_type = ?'
    ).get(paperId, fileType);
    
    const version = (lastVersion?.max_version || 0) + 1;
    
    // Generate unique filename
    const ext = path.extname(originalFilename);
    const filename = `${paperId}_${fileType}_v${version}_${Date.now()}${ext}`;
    const filePath = path.join(config.uploadsDir, filename);
    
    // Save file
    fs.writeFileSync(filePath, fileBuffer);
    
    // Insert record
    const result = db.prepare(`
        INSERT INTO paper_files (paper_id, filename, original_filename, mime_type, file_size, file_hash, version, version_note, file_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(paperId, filename, originalFilename, mimeType, fileBuffer.length, fileHash, version, versionNote, fileType);
    
    return {
        id: result.lastInsertRowid,
        filename,
        version,
        fileHash,
        size: fileBuffer.length
    };
}

/**
 * Get paper by UUID
 */
function getPaperByUuid(uuid, includePrivate = false) {
    const db = getDb();
    
    let query = `
        SELECT p.*, u.username as uploader_username, u.display_name as uploader_name
        FROM papers p
        JOIN users u ON p.uploader_id = u.id
        WHERE p.uuid = ?
    `;
    
    if (!includePrivate) {
        query += " AND p.status = 'published' AND p.visibility = 'public'";
    }
    
    const paper = db.prepare(query).get(uuid);
    
    if (!paper) return null;
    
    // Get authors
    paper.authors = db.prepare(`
        SELECT author_name, author_email, affiliation, orcid, author_order, is_corresponding, user_id
        FROM paper_authors WHERE paper_id = ? ORDER BY author_order
    `).all(paper.id);
    
    // Get disciplines
    paper.disciplines = db.prepare(`
        SELECT d.id, d.slug, d.name, d.icon, pd.is_primary
        FROM paper_disciplines pd
        JOIN disciplines d ON pd.discipline_id = d.id
        WHERE pd.paper_id = ?
        ORDER BY pd.is_primary DESC
    `).all(paper.id);
    
    // Get keywords
    paper.keywords = db.prepare(
        'SELECT keyword FROM paper_keywords WHERE paper_id = ?'
    ).all(paper.id).map(k => k.keyword);
    
    // Get files
    paper.files = db.prepare(`
        SELECT id, filename, original_filename, mime_type, file_size, version, version_note, file_type, ipfs_cid, created_at
        FROM paper_files WHERE paper_id = ?
        ORDER BY file_type, version DESC
    `).all(paper.id);
    
    return paper;
}

/**
 * Get paper by ID
 */
function getPaperById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM papers WHERE id = ?').get(id);
}

/**
 * Update paper metadata
 */
function updatePaper(paperId, updates) {
    const db = getDb();
    
    const allowedFields = [
        'title', 'abstract', 'publication_year', 'publication_date', 'language',
        'doi', 'isbn', 'arxiv_id', 'pmid', 'paper_type', 'license', 'visibility', 'status'
    ];
    
    const setters = [];
    const params = [];
    
    for (const [key, value] of Object.entries(updates)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (allowedFields.includes(dbKey)) {
            setters.push(`${dbKey} = ?`);
            params.push(value);
        }
    }
    
    if (setters.length === 0) return;
    
    setters.push("updated_at = datetime('now')");
    params.push(paperId);
    
    db.prepare(`UPDATE papers SET ${setters.join(', ')} WHERE id = ?`).run(...params);
}

/**
 * Publish a paper (change status from draft to published)
 */
function publishPaper(paperId) {
    const db = getDb();
    db.prepare(`
        UPDATE papers 
        SET status = 'published', published_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND status = 'draft'
    `).run(paperId);
}

/**
 * Search papers with full-text search
 */
function searchPapers({
    query = null,
    discipline = null,
    author = null,
    year = null,
    yearFrom = null,
    yearTo = null,
    paperType = null,
    limit = 20,
    offset = 0
}) {
    const db = getDb();
    
    let sql = `
        SELECT DISTINCT p.id, p.uuid, p.title, p.abstract, p.publication_year, p.paper_type,
               p.view_count, p.download_count, p.citation_count, p.created_at,
               u.username as uploader_username, u.display_name as uploader_name
        FROM papers p
        JOIN users u ON p.uploader_id = u.id
    `;
    
    const joins = [];
    const conditions = ["p.status = 'published'", "p.visibility = 'public'"];
    const params = [];
    
    // Full-text search
    if (query) {
        joins.push('JOIN papers_fts fts ON fts.rowid = p.id');
        conditions.push('papers_fts MATCH ?');
        params.push(query);
    }
    
    // Discipline filter
    if (discipline) {
        joins.push('JOIN paper_disciplines pd ON pd.paper_id = p.id');
        joins.push('JOIN disciplines d ON pd.discipline_id = d.id');
        conditions.push('d.slug = ?');
        params.push(discipline);
    }
    
    // Author filter
    if (author) {
        joins.push('JOIN paper_authors pa ON pa.paper_id = p.id');
        conditions.push('pa.author_name LIKE ?');
        params.push(`%${author}%`);
    }
    
    // Year filters
    if (year) {
        conditions.push('p.publication_year = ?');
        params.push(year);
    }
    if (yearFrom) {
        conditions.push('p.publication_year >= ?');
        params.push(yearFrom);
    }
    if (yearTo) {
        conditions.push('p.publication_year <= ?');
        params.push(yearTo);
    }
    
    // Paper type
    if (paperType) {
        conditions.push('p.paper_type = ?');
        params.push(paperType);
    }
    
    sql += joins.join(' ') + ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const papers = db.prepare(sql).all(...params);
    
    // Get authors for each paper
    const getAuthors = db.prepare(
        'SELECT author_name FROM paper_authors WHERE paper_id = ? ORDER BY author_order'
    );
    
    const getFile = db.prepare(
        'SELECT id, mime_type FROM paper_files WHERE paper_id = ? ORDER BY id LIMIT 1'
    );
    
    for (const paper of papers) {
        paper.authors = getAuthors.all(paper.id).map(a => a.author_name);
        const file = getFile.get(paper.id);
        if (file) {
            paper.primaryFileId = file.id;
            paper.primaryMimeType = file.mime_type;
        }
    }
    
    return papers;
}

/**
 * Get papers by uploader
 */
function getPapersByUploader(userId, includeUnpublished = false) {
    const db = getDb();
    
    let query = `
        SELECT id, uuid, title, abstract, publication_year, paper_type, status, visibility,
               view_count, download_count, created_at, published_at
        FROM papers WHERE uploader_id = ?
    `;
    
    if (!includeUnpublished) {
        query += " AND status = 'published'";
    }
    
    query += ' ORDER BY created_at DESC';
    
    return db.prepare(query).all(userId);
}

/**
 * Get recent papers with optional type filter
 */
function getRecentPapers(limit = 10, paperType = null) {
    const db = getDb();
    
    let sql = `
        SELECT p.id, p.uuid, p.title, p.abstract, p.publication_year, p.paper_type,
               p.created_at, p.view_count, p.download_count, u.display_name as uploader_name
        FROM papers p
        JOIN users u ON p.uploader_id = u.id
        WHERE p.status = 'published' AND p.visibility = 'public'
    `;
    
    const params = [];
    
    if (paperType) {
        sql += ' AND p.paper_type = ?';
        params.push(paperType);
    }
    
    sql += ' ORDER BY p.published_at DESC LIMIT ?';
    params.push(limit);
    
    const papers = db.prepare(sql).all(...params);
    
    const getAuthors = db.prepare(
        'SELECT author_name FROM paper_authors WHERE paper_id = ? ORDER BY author_order LIMIT 3'
    );
    
    const getFile = db.prepare(
        'SELECT id, mime_type FROM paper_files WHERE paper_id = ? ORDER BY id LIMIT 1'
    );
    
    for (const paper of papers) {
        paper.authors = getAuthors.all(paper.id).map(a => a.author_name);
        const file = getFile.get(paper.id);
        if (file) {
            paper.primaryFileId = file.id;
            paper.primaryMimeType = file.mime_type;
        }
    }
    
    return papers;
}

/**
 * Get trending papers (by view count in recent period)
 */
function getTrendingPapers(limit = 10, paperType = null) {
    const db = getDb();
    
    let sql = `
        SELECT p.id, p.uuid, p.title, p.abstract, p.publication_year, p.paper_type,
               p.created_at, p.view_count, p.download_count, u.display_name as uploader_name
        FROM papers p
        JOIN users u ON p.uploader_id = u.id
        WHERE p.status = 'published' AND p.visibility = 'public'
    `;
    
    const params = [];
    
    if (paperType) {
        sql += ' AND p.paper_type = ?';
        params.push(paperType);
    }
    
    sql += ' ORDER BY p.view_count DESC, p.published_at DESC LIMIT ?';
    params.push(limit);
    
    const papers = db.prepare(sql).all(...params);
    
    const getAuthors = db.prepare(
        'SELECT author_name FROM paper_authors WHERE paper_id = ? ORDER BY author_order LIMIT 3'
    );
    
    const getFile = db.prepare(
        'SELECT id, mime_type FROM paper_files WHERE paper_id = ? ORDER BY id LIMIT 1'
    );
    
    for (const paper of papers) {
        paper.authors = getAuthors.all(paper.id).map(a => a.author_name);
        const file = getFile.get(paper.id);
        if (file) {
            paper.primaryFileId = file.id;
            paper.primaryMimeType = file.mime_type;
        }
    }
    
    return papers;
}

/**
 * Increment view count
 */
function incrementViewCount(paperId) {
    const db = getDb();
    db.prepare('UPDATE papers SET view_count = view_count + 1 WHERE id = ?').run(paperId);
}

/**
 * Increment download count
 */
function incrementDownloadCount(paperId) {
    const db = getDb();
    db.prepare('UPDATE papers SET download_count = download_count + 1 WHERE id = ?').run(paperId);
}

/**
 * Get all disciplines
 */
function getDisciplines() {
    const db = getDb();
    return db.prepare(`
        SELECT id, slug, name, description, icon, parent_id
        FROM disciplines ORDER BY sort_order
    `).all();
}

/**
 * Get discipline by slug
 */
function getDisciplineBySlug(slug) {
    const db = getDb();
    return db.prepare('SELECT * FROM disciplines WHERE slug = ?').get(slug);
}

/**
 * Get paper file for download
 */
function getPaperFile(fileId) {
    const db = getDb();
    return db.prepare(`
        SELECT pf.*, p.uuid as paper_uuid, p.title as paper_title
        FROM paper_files pf
        JOIN papers p ON pf.paper_id = p.id
        WHERE pf.id = ?
    `).get(fileId);
}

module.exports = {
    createPaper,
    addPaperFile,
    getPaperByUuid,
    getPaperById,
    updatePaper,
    publishPaper,
    searchPapers,
    getPapersByUploader,
    getRecentPapers,
    getTrendingPapers,
    incrementViewCount,
    incrementDownloadCount,
    getDisciplines,
    getDisciplineBySlug,
    getPaperFile
};
