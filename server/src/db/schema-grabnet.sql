-- OpenSource Scholar - GrabNet & Peer Review Migration
-- Adds GrabNet site support and open peer review system

-- ============================================
-- USER GRABNET SITES
-- ============================================

-- Each user gets their own GrabNet-published site
CREATE TABLE IF NOT EXISTS user_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- GrabNet identifiers
    site_name TEXT UNIQUE NOT NULL,  -- scholar-username format
    site_id TEXT,                     -- grab://... public key
    
    -- Site status
    status TEXT DEFAULT 'draft',      -- draft, published, suspended
    last_published TEXT,
    revision INTEGER DEFAULT 0,
    
    -- Stats
    total_files INTEGER DEFAULT 0,
    total_size_bytes INTEGER DEFAULT 0,
    
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_sites_user ON user_sites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sites_name ON user_sites(site_name);
CREATE INDEX IF NOT EXISTS idx_user_sites_id ON user_sites(site_id);

-- ============================================
-- USER FILES (replaces paper_files for general uploads)
-- ============================================

CREATE TABLE IF NOT EXISTS user_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- File info
    filename TEXT NOT NULL,            -- stored filename
    original_filename TEXT NOT NULL,   -- user's original filename
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_hash TEXT NOT NULL,           -- SHA-256
    
    -- GrabNet path (relative to user's site)
    grab_path TEXT NOT NULL,           -- e.g., files/myfile-123456.pdf
    
    -- Metadata
    title TEXT,
    description TEXT,
    
    -- Tagging system
    content_type TEXT DEFAULT 'other', -- paper, video, audio, image, dataset, software, art, music, lecture, tutorial, other
    is_scientific INTEGER DEFAULT 0,   -- requires peer review if true
    
    -- License
    license TEXT DEFAULT 'CC-BY-4.0',
    
    -- Stats
    view_count INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_files_user ON user_files(user_id);
CREATE INDEX IF NOT EXISTS idx_user_files_uuid ON user_files(uuid);
CREATE INDEX IF NOT EXISTS idx_user_files_type ON user_files(content_type);
CREATE INDEX IF NOT EXISTS idx_user_files_hash ON user_files(file_hash);
CREATE INDEX IF NOT EXISTS idx_user_files_scientific ON user_files(is_scientific);

-- File tags (many tags per file)
CREATE TABLE IF NOT EXISTS file_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    
    UNIQUE(file_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_file_tags_file ON file_tags(file_id);
CREATE INDEX IF NOT EXISTS idx_file_tags_tag ON file_tags(tag);

-- ============================================
-- OPEN PEER REVIEW
-- ============================================

-- Anyone can submit a review of scientific content
CREATE TABLE IF NOT EXISTS peer_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    
    -- What's being reviewed
    file_id INTEGER NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
    
    -- Who wrote the review (all reviews are public)
    reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Review content
    summary TEXT NOT NULL,            -- Brief summary/verdict
    methodology_score INTEGER,        -- 1-5, null if not applicable
    originality_score INTEGER,        -- 1-5
    clarity_score INTEGER,            -- 1-5
    significance_score INTEGER,       -- 1-5
    overall_score INTEGER,            -- 1-5 overall assessment
    
    detailed_review TEXT,             -- Full review text
    strengths TEXT,                   -- What's good
    weaknesses TEXT,                  -- Areas for improvement
    suggestions TEXT,                 -- Constructive feedback
    
    -- Review status
    status TEXT DEFAULT 'submitted',  -- submitted, helpful, disputed
    
    -- Voting (community validation of review quality)
    helpful_count INTEGER DEFAULT 0,
    not_helpful_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_peer_reviews_file ON peer_reviews(file_id);
CREATE INDEX IF NOT EXISTS idx_peer_reviews_reviewer ON peer_reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_peer_reviews_overall ON peer_reviews(overall_score);

-- Review votes (was this review helpful?)
CREATE TABLE IF NOT EXISTS review_votes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    review_id INTEGER NOT NULL REFERENCES peer_reviews(id) ON DELETE CASCADE,
    vote INTEGER NOT NULL,            -- 1 = helpful, -1 = not helpful
    created_at TEXT DEFAULT (datetime('now')),
    
    PRIMARY KEY (user_id, review_id)
);

-- Review responses (author can respond to reviews)
CREATE TABLE IF NOT EXISTS review_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER NOT NULL REFERENCES peer_reviews(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    response_text TEXT NOT NULL,
    
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_review_responses_review ON review_responses(review_id);

-- ============================================
-- CONTENT DISCUSSIONS
-- ============================================

-- General discussions on any content (not just peer review)
CREATE TABLE IF NOT EXISTS discussions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    
    -- What's being discussed
    file_id INTEGER REFERENCES user_files(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES discussions(id) ON DELETE CASCADE,
    
    -- Content
    content TEXT NOT NULL,
    
    -- Stats
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,
    
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_discussions_file ON discussions(file_id);
CREATE INDEX IF NOT EXISTS idx_discussions_user ON discussions(user_id);
CREATE INDEX IF NOT EXISTS idx_discussions_parent ON discussions(parent_id);

-- ============================================
-- FILE COLLECTIONS (reading lists, etc.)
-- ============================================

CREATE TABLE IF NOT EXISTS file_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    name TEXT NOT NULL,
    description TEXT,
    visibility TEXT DEFAULT 'public',
    
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_files (
    collection_id INTEGER NOT NULL REFERENCES file_collections(id) ON DELETE CASCADE,
    file_id INTEGER NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
    added_at TEXT DEFAULT (datetime('now')),
    note TEXT,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (collection_id, file_id)
);

-- ============================================
-- CONTENT MODERATION FLAGS
-- ============================================

CREATE TABLE IF NOT EXISTS content_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- What's being flagged
    content_type TEXT NOT NULL,       -- file, review, discussion
    content_id INTEGER NOT NULL,
    
    -- Who flagged it
    flagger_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Why
    reason TEXT NOT NULL,             -- spam, harassment, copyright, misinformation, other
    details TEXT,
    
    -- Status
    status TEXT DEFAULT 'pending',    -- pending, reviewed, dismissed, actioned
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TEXT,
    action_taken TEXT,
    
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_content_flags_content ON content_flags(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_content_flags_status ON content_flags(status);

-- ============================================
-- FULL-TEXT SEARCH FOR FILES
-- ============================================

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    title,
    description,
    original_filename,
    tags,
    content=user_files,
    content_rowid=id
);
