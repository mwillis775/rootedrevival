/**
 * Rooted Revival - CMS Database Module
 * 
 * Manages site pages, media assets, navigation, and site settings.
 * Powers the admin CMS panel for full site customization.
 */

const { getDb, generateUuid } = require('./index');
const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Initialize CMS tables
 */
function initCmsTables() {
    const db = getDb();
    db.exec(`
        -- Site pages (editable HTML pages)
        CREATE TABLE IF NOT EXISTS cms_pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            content TEXT DEFAULT '',
            template TEXT DEFAULT 'default',
            status TEXT DEFAULT 'draft',
            sort_order INTEGER DEFAULT 0,
            show_in_nav INTEGER DEFAULT 1,
            nav_label TEXT,
            meta_title TEXT,
            meta_description TEXT,
            meta_image TEXT,
            custom_css TEXT,
            custom_js TEXT,
            created_by INTEGER REFERENCES users(id),
            updated_by INTEGER REFERENCES users(id),
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            published_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cms_pages_slug ON cms_pages(slug);
        CREATE INDEX IF NOT EXISTS idx_cms_pages_status ON cms_pages(status);

        -- Page revision history
        CREATE TABLE IF NOT EXISTS cms_page_revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id INTEGER NOT NULL REFERENCES cms_pages(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            title TEXT,
            revision_note TEXT,
            created_by INTEGER REFERENCES users(id),
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_cms_revisions_page ON cms_page_revisions(page_id);

        -- Media library
        CREATE TABLE IF NOT EXISTS cms_media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            filename TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            width INTEGER,
            height INTEGER,
            alt_text TEXT,
            caption TEXT,
            folder TEXT DEFAULT '/',
            tags TEXT,
            uploaded_by INTEGER REFERENCES users(id),
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_cms_media_folder ON cms_media(folder);
        CREATE INDEX IF NOT EXISTS idx_cms_media_mime ON cms_media(mime_type);

        -- Site settings (key-value)
        CREATE TABLE IF NOT EXISTS cms_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            type TEXT DEFAULT 'string',
            category TEXT DEFAULT 'general',
            label TEXT,
            description TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Navigation menus
        CREATE TABLE IF NOT EXISTS cms_nav_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            menu TEXT DEFAULT 'main',
            label TEXT NOT NULL,
            url TEXT NOT NULL,
            icon TEXT,
            parent_id INTEGER REFERENCES cms_nav_items(id) ON DELETE CASCADE,
            sort_order INTEGER DEFAULT 0,
            is_external INTEGER DEFAULT 0,
            css_class TEXT,
            visibility TEXT DEFAULT 'all'
        );
        CREATE INDEX IF NOT EXISTS idx_cms_nav_menu ON cms_nav_items(menu);

        -- Component blocks (reusable content)
        CREATE TABLE IF NOT EXISTS cms_components (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            label TEXT,
            content TEXT DEFAULT '',
            component_type TEXT DEFAULT 'html',
            config TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Theme / appearance
        CREATE TABLE IF NOT EXISTS cms_theme (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            variables TEXT NOT NULL,
            is_active INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
    `);
    
    // Seed default settings if empty  
    const count = db.prepare('SELECT COUNT(*) as c FROM cms_settings').get().c;
    if (count === 0) {
        seedDefaultSettings(db);
    }
}

function seedDefaultSettings(db) {
    const defaults = [
        // General
        { key: 'site_name', value: 'Rooted Revival', type: 'string', category: 'general', label: 'Site Name' },
        { key: 'site_tagline', value: 'Open Knowledge, Rooted in Community', type: 'string', category: 'general', label: 'Tagline' },
        { key: 'site_description', value: 'A decentralized platform for preserving and sharing knowledge through peer-to-peer technology.', type: 'text', category: 'general', label: 'Site Description' },
        { key: 'site_logo', value: '', type: 'image', category: 'general', label: 'Logo URL' },
        { key: 'site_favicon', value: '', type: 'image', category: 'general', label: 'Favicon URL' },
        { key: 'site_emoji', value: '🌱', type: 'string', category: 'general', label: 'Site Emoji' },
        
        // Appearance
        { key: 'theme', value: 'terminal', type: 'select', category: 'appearance', label: 'Theme', description: 'terminal,vapor,paper,midnight,custom' },
        { key: 'primary_color', value: '#33ff33', type: 'color', category: 'appearance', label: 'Primary Color' },
        { key: 'bg_color', value: '#0a0a0a', type: 'color', category: 'appearance', label: 'Background Color' },
        { key: 'font_heading', value: 'Share Tech Mono', type: 'string', category: 'appearance', label: 'Heading Font' },
        { key: 'font_body', value: 'Inter', type: 'string', category: 'appearance', label: 'Body Font' },
        { key: 'custom_css', value: '', type: 'code', category: 'appearance', label: 'Custom CSS' },
        { key: 'header_html', value: '', type: 'code', category: 'appearance', label: 'Header HTML inject' },
        { key: 'footer_html', value: '', type: 'code', category: 'appearance', label: 'Footer HTML inject' },
        
        // Features
        { key: 'registration_enabled', value: 'true', type: 'boolean', category: 'features', label: 'Allow Registration' },
        { key: 'upload_enabled', value: 'true', type: 'boolean', category: 'features', label: 'Allow Uploads' },
        { key: 'comments_enabled', value: 'true', type: 'boolean', category: 'features', label: 'Allow Comments' },
        { key: 'require_approval', value: 'false', type: 'boolean', category: 'features', label: 'Require Approval for Uploads' },
        { key: 'max_upload_mb', value: '500', type: 'number', category: 'features', label: 'Max Upload Size (MB)' },
        
        // SEO
        { key: 'meta_title', value: 'Rooted Revival — Open Knowledge Archive', type: 'string', category: 'seo', label: 'Default Meta Title' },
        { key: 'meta_description', value: 'Decentralized open access knowledge sharing.', type: 'text', category: 'seo', label: 'Default Meta Description' },
        { key: 'og_image', value: '', type: 'image', category: 'seo', label: 'Default OG Image' },
        { key: 'analytics_code', value: '', type: 'code', category: 'seo', label: 'Analytics Script' },
        
        // Social
        { key: 'social_github', value: '', type: 'string', category: 'social', label: 'GitHub URL' },
        { key: 'social_twitter', value: '', type: 'string', category: 'social', label: 'Twitter/X URL' },
        { key: 'social_discord', value: '', type: 'string', category: 'social', label: 'Discord URL' },
        { key: 'social_mastodon', value: '', type: 'string', category: 'social', label: 'Mastodon URL' },
        
        // Network
        { key: 'grabnet_enabled', value: 'true', type: 'boolean', category: 'network', label: 'GrabNet P2P Enabled' },
        { key: 'tor_enabled', value: 'false', type: 'boolean', category: 'network', label: 'Tor Hidden Service' },
        { key: 'archive_org_mirror', value: 'true', type: 'boolean', category: 'network', label: 'Internet Archive Mirror' },
        { key: 'cloudflare_tunnel', value: 'true', type: 'boolean', category: 'network', label: 'Cloudflare Tunnel Active' },
    ];
    
    const insert = db.prepare(`
        INSERT OR IGNORE INTO cms_settings (key, value, type, category, label, description)
        VALUES (@key, @value, @type, @category, @label, @description)
    `);
    
    for (const s of defaults) {
        insert.run({ ...s, description: s.description || null });
    }
}

// --- Pages ---

function getAllPages() {
    const db = getDb();
    return db.prepare(`
        SELECT id, uuid, slug, title, description, status, sort_order, show_in_nav, nav_label,
               template, created_at, updated_at, published_at
        FROM cms_pages
        ORDER BY sort_order ASC, title ASC
    `).all();
}

function getPageBySlug(slug) {
    const db = getDb();
    return db.prepare('SELECT * FROM cms_pages WHERE slug = ?').get(slug);
}

function getPageByUuid(uuid) {
    const db = getDb();
    return db.prepare('SELECT * FROM cms_pages WHERE uuid = ?').get(uuid);
}

function createPage({ title, slug, description, content, template, status, showInNav, navLabel, customCss, customJs, createdBy }) {
    const db = getDb();
    const uuid = generateUuid();
    
    // Auto-generate slug from title if not provided
    if (!slug) {
        slug = title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }
    
    // Ensure unique slug
    const existing = db.prepare('SELECT id FROM cms_pages WHERE slug = ?').get(slug);
    if (existing) {
        slug = `${slug}-${Date.now().toString(36)}`;
    }
    
    const result = db.prepare(`
        INSERT INTO cms_pages (uuid, slug, title, description, content, template, status, show_in_nav, nav_label, custom_css, custom_js, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuid, slug, title, description || '', content || '', template || 'default', status || 'draft', showInNav ? 1 : 0, navLabel || title, customCss || '', customJs || '', createdBy, createdBy);
    
    return { id: result.lastInsertRowid, uuid, slug };
}

function updatePage(uuid, updates) {
    const db = getDb();
    const page = db.prepare('SELECT * FROM cms_pages WHERE uuid = ?').get(uuid);
    if (!page) throw new Error('Page not found');
    
    // Save revision before update
    db.prepare(`
        INSERT INTO cms_page_revisions (page_id, content, title, revision_note, created_by)
        VALUES (?, ?, ?, ?, ?)
    `).run(page.id, page.content, page.title, 'Auto-save before edit', updates.updatedBy || null);
    
    const fields = [];
    const params = [];
    
    const allowed = ['title', 'slug', 'description', 'content', 'template', 'status', 
                     'sort_order', 'show_in_nav', 'nav_label', 'meta_title', 'meta_description',
                     'meta_image', 'custom_css', 'custom_js'];
    
    for (const key of allowed) {
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        if (updates[camelKey] !== undefined || updates[key] !== undefined) {
            const val = updates[camelKey] !== undefined ? updates[camelKey] : updates[key];
            fields.push(`${key} = ?`);
            params.push(key === 'show_in_nav' ? (val ? 1 : 0) : val);
        }
    }
    
    if (updates.updatedBy) {
        fields.push('updated_by = ?');
        params.push(updates.updatedBy);
    }
    
    if (updates.status === 'published' && !page.published_at) {
        fields.push("published_at = datetime('now')");
    }
    
    fields.push("updated_at = datetime('now')");
    params.push(uuid);
    
    db.prepare(`UPDATE cms_pages SET ${fields.join(', ')} WHERE uuid = ?`).run(...params);
    
    return getPageByUuid(uuid);
}

function deletePage(uuid) {
    const db = getDb();
    const result = db.prepare('DELETE FROM cms_pages WHERE uuid = ?').run(uuid);
    return result.changes > 0;
}

function getPageRevisions(uuid) {
    const db = getDb();
    const page = db.prepare('SELECT id FROM cms_pages WHERE uuid = ?').get(uuid);
    if (!page) return [];
    
    return db.prepare(`
        SELECT r.*, u.username as author
        FROM cms_page_revisions r
        LEFT JOIN users u ON r.created_by = u.id
        WHERE r.page_id = ?
        ORDER BY r.created_at DESC
        LIMIT 50
    `).all(page.id);
}

function restoreRevision(uuid, revisionId) {
    const db = getDb();
    const page = db.prepare('SELECT id, content, title FROM cms_pages WHERE uuid = ?').get(uuid);
    const revision = db.prepare('SELECT * FROM cms_page_revisions WHERE id = ? AND page_id = ?').get(revisionId, page.id);
    
    if (!page || !revision) throw new Error('Page or revision not found');
    
    // Save current as revision first
    db.prepare(`
        INSERT INTO cms_page_revisions (page_id, content, title, revision_note)
        VALUES (?, ?, ?, ?)
    `).run(page.id, page.content, page.title, 'Before restore');
    
    // Restore
    db.prepare(`
        UPDATE cms_pages SET content = ?, title = COALESCE(?, title), updated_at = datetime('now')
        WHERE uuid = ?
    `).run(revision.content, revision.title, uuid);
    
    return getPageByUuid(uuid);
}

// --- Media ---

function getAllMedia({ folder, type, search, limit = 50, offset = 0 } = {}) {
    const db = getDb();
    let sql = 'SELECT * FROM cms_media WHERE 1=1';
    const params = [];
    
    if (folder) {
        sql += ' AND folder = ?';
        params.push(folder);
    }
    if (type) {
        sql += ' AND mime_type LIKE ?';
        params.push(`${type}/%`);
    }
    if (search) {
        sql += ' AND (original_filename LIKE ? OR alt_text LIKE ? OR caption LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Math.min(limit, 200), offset);
    
    return db.prepare(sql).all(...params);
}

function addMedia({ filename, originalFilename, mimeType, fileSize, width, height, altText, caption, folder, uploadedBy }) {
    const db = getDb();
    const uuid = generateUuid();
    
    const result = db.prepare(`
        INSERT INTO cms_media (uuid, filename, original_filename, mime_type, file_size, width, height, alt_text, caption, folder, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuid, filename, originalFilename, mimeType, fileSize, width || null, height || null, altText || '', caption || '', folder || '/', uploadedBy);
    
    return { id: result.lastInsertRowid, uuid, filename };
}

function updateMedia(uuid, updates) {
    const db = getDb();
    const fields = [];
    const params = [];
    
    if (updates.altText !== undefined) { fields.push('alt_text = ?'); params.push(updates.altText); }
    if (updates.caption !== undefined) { fields.push('caption = ?'); params.push(updates.caption); }
    if (updates.folder !== undefined) { fields.push('folder = ?'); params.push(updates.folder); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); params.push(updates.tags); }
    
    if (fields.length === 0) return;
    params.push(uuid);
    
    db.prepare(`UPDATE cms_media SET ${fields.join(', ')} WHERE uuid = ?`).run(...params);
}

function deleteMedia(uuid) {
    const db = getDb();
    const media = db.prepare('SELECT filename FROM cms_media WHERE uuid = ?').get(uuid);
    if (media) {
        // Delete physical file
        const filepath = path.join(config.uploadsDir, 'cms', media.filename);
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }
    }
    return db.prepare('DELETE FROM cms_media WHERE uuid = ?').run(uuid).changes > 0;
}

function getMediaByUuid(uuid) {
    const db = getDb();
    return db.prepare('SELECT * FROM cms_media WHERE uuid = ?').get(uuid);
}

// --- Settings ---

function getAllSettings() {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM cms_settings ORDER BY category, key').all();
    const grouped = {};
    for (const row of rows) {
        if (!grouped[row.category]) grouped[row.category] = [];
        grouped[row.category].push(row);
    }
    return grouped;
}

function getSetting(key) {
    const db = getDb();
    const row = db.prepare('SELECT value, type FROM cms_settings WHERE key = ?').get(key);
    if (!row) return null;
    if (row.type === 'boolean') return row.value === 'true';
    if (row.type === 'number') return Number(row.value);
    return row.value;
}

function updateSettings(settings) {
    const db = getDb();
    const update = db.prepare(`
        UPDATE cms_settings SET value = ?, updated_at = datetime('now') WHERE key = ?
    `);
    
    const insert = db.prepare(`
        INSERT OR REPLACE INTO cms_settings (key, value, type, category, label, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    
    for (const [key, value] of Object.entries(settings)) {
        const existing = db.prepare('SELECT key FROM cms_settings WHERE key = ?').get(key);
        if (existing) {
            update.run(String(value), key);
        } else {
            insert.run(key, String(value), typeof value === 'boolean' ? 'boolean' : 'string', 'custom', key);
        }
    }
}

// --- Navigation ---

function getNavigation(menu = 'main') {
    const db = getDb();
    return db.prepare(`
        SELECT * FROM cms_nav_items
        WHERE menu = ?
        ORDER BY sort_order ASC
    `).all(menu);
}

function updateNavigation(menu, items) {
    const db = getDb();
    
    // Delete existing
    db.prepare('DELETE FROM cms_nav_items WHERE menu = ?').run(menu);
    
    // Insert new
    const insert = db.prepare(`
        INSERT INTO cms_nav_items (menu, label, url, icon, sort_order, is_external, css_class, visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    items.forEach((item, i) => {
        insert.run(menu, item.label, item.url, item.icon || '', i, item.isExternal ? 1 : 0, item.cssClass || '', item.visibility || 'all');
    });
}

// --- Components ---

function getAllComponents() {
    const db = getDb();
    return db.prepare('SELECT * FROM cms_components ORDER BY name').all();
}

function getComponent(name) {
    const db = getDb();
    return db.prepare('SELECT * FROM cms_components WHERE name = ?').get(name);
}

function upsertComponent(name, { label, content, componentType, config: cfg }) {
    const db = getDb();
    db.prepare(`
        INSERT INTO cms_components (name, label, content, component_type, config, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(name) DO UPDATE SET 
            label = excluded.label,
            content = excluded.content,
            component_type = excluded.component_type,
            config = excluded.config,
            updated_at = datetime('now')
    `).run(name, label || name, content || '', componentType || 'html', cfg ? JSON.stringify(cfg) : null);
}

// --- Themes ---

function getActiveTheme() {
    const db = getDb();
    return db.prepare('SELECT * FROM cms_theme WHERE is_active = 1').get();
}

function saveTheme(name, variables) {
    const db = getDb();
    db.prepare(`
        INSERT INTO cms_theme (name, variables, is_active)
        VALUES (?, ?, 0)
        ON CONFLICT(name) DO UPDATE SET variables = excluded.variables
    `).run(name, JSON.stringify(variables));
}

function activateTheme(name) {
    const db = getDb();
    db.prepare('UPDATE cms_theme SET is_active = 0').run();
    db.prepare('UPDATE cms_theme SET is_active = 1 WHERE name = ?').run(name);
}

module.exports = {
    initCmsTables,
    // Pages
    getAllPages,
    getPageBySlug,
    getPageByUuid,
    createPage,
    updatePage,
    deletePage,
    getPageRevisions,
    restoreRevision,
    // Media
    getAllMedia,
    addMedia,
    updateMedia,
    deleteMedia,
    getMediaByUuid,
    // Settings
    getAllSettings,
    getSetting,
    updateSettings,
    // Navigation
    getNavigation,
    updateNavigation,
    // Components
    getAllComponents,
    getComponent,
    upsertComponent,
    // Themes
    getActiveTheme,
    saveTheme,
    activateTheme
};
