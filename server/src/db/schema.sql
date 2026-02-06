-- OpenSource Scholar Database Schema
-- SQLite database for self-hosted open access academia

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================
-- USERS & AUTHENTICATION
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    bio TEXT,
    affiliation TEXT,
    orcid TEXT,
    customization TEXT,  -- JSON: avatar, avatarUrl, effects[], banner
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    email_verified INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    is_moderator INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0
);

-- ============================================
-- DISCIPLINES & CATEGORIES
-- ============================================

CREATE TABLE IF NOT EXISTS disciplines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    parent_id INTEGER REFERENCES disciplines(id) ON DELETE SET NULL,
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_disciplines_slug ON disciplines(slug);
CREATE INDEX IF NOT EXISTS idx_disciplines_parent ON disciplines(parent_id);

-- ============================================
-- PAPERS & UPLOADS
-- ============================================

CREATE TABLE IF NOT EXISTS papers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Metadata
    title TEXT NOT NULL,
    abstract TEXT,
    publication_year INTEGER,
    publication_date TEXT,
    language TEXT DEFAULT 'en',
    
    -- Identifiers
    doi TEXT,
    isbn TEXT,
    arxiv_id TEXT,
    pmid TEXT,
    
    -- Type
    paper_type TEXT DEFAULT 'paper', -- paper, book, thesis, preprint, dataset, notes
    
    -- Status
    status TEXT DEFAULT 'draft', -- draft, published, under_review, archived
    visibility TEXT DEFAULT 'public', -- public, members, private
    
    -- License
    license TEXT DEFAULT 'CC-BY-4.0',
    
    -- Stats
    view_count INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,
    citation_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_papers_uuid ON papers(uuid);
CREATE INDEX IF NOT EXISTS idx_papers_uploader ON papers(uploader_id);
CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status);
CREATE INDEX IF NOT EXISTS idx_papers_type ON papers(paper_type);
CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(publication_year);
CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);

-- Paper authors (ordered)
CREATE TABLE IF NOT EXISTS paper_authors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    author_email TEXT,
    affiliation TEXT,
    orcid TEXT,
    author_order INTEGER NOT NULL DEFAULT 0,
    is_corresponding INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_paper_authors_paper ON paper_authors(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_authors_user ON paper_authors(user_id);

-- Paper disciplines (many-to-many)
CREATE TABLE IF NOT EXISTS paper_disciplines (
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    discipline_id INTEGER NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
    is_primary INTEGER DEFAULT 0,
    PRIMARY KEY (paper_id, discipline_id)
);

-- Paper keywords
CREATE TABLE IF NOT EXISTS paper_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paper_keywords_paper ON paper_keywords(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_keywords_keyword ON paper_keywords(keyword);

-- ============================================
-- FILES & VERSIONS
-- ============================================

CREATE TABLE IF NOT EXISTS paper_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    
    -- File info
    filename TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_hash TEXT NOT NULL, -- SHA-256
    
    -- Version
    version INTEGER DEFAULT 1,
    version_note TEXT,
    
    -- IPFS
    ipfs_cid TEXT,
    ipfs_pinned INTEGER DEFAULT 0,
    
    -- Type
    file_type TEXT DEFAULT 'main', -- main, supplementary, data, cover
    
    -- Timestamps
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_paper_files_paper ON paper_files(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_files_hash ON paper_files(file_hash);
CREATE INDEX IF NOT EXISTS idx_paper_files_cid ON paper_files(ipfs_cid);

-- ============================================
-- CITATIONS & REFERENCES
-- ============================================

-- References within papers (what this paper cites)
CREATE TABLE IF NOT EXISTS paper_references (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    
    -- If referencing another paper in the system
    referenced_paper_id INTEGER REFERENCES papers(id) ON DELETE SET NULL,
    
    -- External reference metadata (for papers not in system)
    ref_title TEXT,
    ref_authors TEXT, -- JSON array
    ref_year INTEGER,
    ref_doi TEXT,
    ref_url TEXT,
    ref_citation_text TEXT, -- Full citation string
    
    -- Position in paper
    ref_order INTEGER,
    
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_paper_refs_paper ON paper_references(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_refs_referenced ON paper_references(referenced_paper_id);

-- ============================================
-- COLLECTIONS & READING LISTS
-- ============================================

CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    name TEXT NOT NULL,
    description TEXT,
    visibility TEXT DEFAULT 'public', -- public, members, private
    
    -- IPFS
    ipfs_cid TEXT,
    
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections(owner_id);
CREATE INDEX IF NOT EXISTS idx_collections_uuid ON collections(uuid);

CREATE TABLE IF NOT EXISTS collection_papers (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    added_at TEXT DEFAULT (datetime('now')),
    note TEXT,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (collection_id, paper_id)
);

-- ============================================
-- IPFS PINNING & MIRRORS
-- ============================================

CREATE TABLE IF NOT EXISTS ipfs_pins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cid TEXT NOT NULL,
    pin_type TEXT NOT NULL, -- paper, file, collection, site
    reference_id INTEGER, -- ID of paper, file, or collection
    reference_type TEXT, -- papers, paper_files, collections
    
    -- Status
    status TEXT DEFAULT 'pinned', -- pinned, unpinned, failed
    
    -- Size
    size_bytes INTEGER,
    
    -- Timestamps
    pinned_at TEXT DEFAULT (datetime('now')),
    last_checked TEXT
);

CREATE INDEX IF NOT EXISTS idx_ipfs_pins_cid ON ipfs_pins(cid);
CREATE INDEX IF NOT EXISTS idx_ipfs_pins_ref ON ipfs_pins(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS ipfs_mirrors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cid TEXT NOT NULL,
    
    -- Mirror info
    mirror_name TEXT,
    mirror_url TEXT,
    peer_id TEXT,
    
    -- Who submitted
    submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    
    -- Status
    verified INTEGER DEFAULT 0,
    last_verified TEXT,
    
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ipfs_mirrors_cid ON ipfs_mirrors(cid);

-- ============================================
-- COMMUNITY FEATURES
-- ============================================

-- Comments/annotations on papers
CREATE TABLE IF NOT EXISTS paper_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES paper_comments(id) ON DELETE CASCADE,
    
    content TEXT NOT NULL,
    
    -- For annotations
    page_number INTEGER,
    highlight_text TEXT,
    
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_paper_comments_paper ON paper_comments(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_comments_user ON paper_comments(user_id);

-- User follows
CREATE TABLE IF NOT EXISTS user_follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, following_id)
);

-- Paper bookmarks
CREATE TABLE IF NOT EXISTS paper_bookmarks (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, paper_id)
);

-- ============================================
-- MODERATION & AUDIT
-- ============================================

CREATE TABLE IF NOT EXISTS moderation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL, -- approve, reject, ban, warn, delete
    target_type TEXT NOT NULL, -- user, paper, comment
    target_id INTEGER NOT NULL,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mod_log_target ON moderation_log(target_type, target_id);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id INTEGER,
    details TEXT, -- JSON
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);

-- ============================================
-- FULL-TEXT SEARCH
-- ============================================

CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
    title,
    abstract,
    keywords,
    author_names,
    content=papers,
    content_rowid=id
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS papers_fts_insert AFTER INSERT ON papers BEGIN
    INSERT INTO papers_fts(rowid, title, abstract, keywords, author_names)
    VALUES (new.id, new.title, new.abstract, '', '');
END;

CREATE TRIGGER IF NOT EXISTS papers_fts_delete AFTER DELETE ON papers BEGIN
    INSERT INTO papers_fts(papers_fts, rowid, title, abstract, keywords, author_names)
    VALUES ('delete', old.id, old.title, old.abstract, '', '');
END;

CREATE TRIGGER IF NOT EXISTS papers_fts_update AFTER UPDATE ON papers BEGIN
    INSERT INTO papers_fts(papers_fts, rowid, title, abstract, keywords, author_names)
    VALUES ('delete', old.id, old.title, old.abstract, '', '');
    INSERT INTO papers_fts(rowid, title, abstract, keywords, author_names)
    VALUES (new.id, new.title, new.abstract, '', '');
END;
