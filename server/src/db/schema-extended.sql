-- Open Scholar Extended Schema
-- Additional tables for videos, art, music, collections, and user customization

PRAGMA foreign_keys = ON;

-- ============================================
-- USER PROFILE CUSTOMIZATION
-- ============================================

-- Stores user theme/profile customization settings
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    
    -- Profile appearance
    banner_url TEXT,
    avatar_url TEXT,
    
    -- Custom theme (owner can customize their profile page)
    theme_preset TEXT DEFAULT 'terminal',
    custom_bg_color TEXT,
    custom_text_color TEXT,
    custom_accent_color TEXT,
    custom_font TEXT,
    bg_pattern TEXT,  -- none, dots, grid, diagonal, crosses
    bg_image_url TEXT,
    
    -- Profile music (like MySpace!)
    profile_song_id INTEGER REFERENCES content(id) ON DELETE SET NULL,
    autoplay_music INTEGER DEFAULT 0,
    
    -- Layout preferences
    show_guestbook INTEGER DEFAULT 1,
    show_friends INTEGER DEFAULT 1,
    show_activity INTEGER DEFAULT 1,
    show_collections INTEGER DEFAULT 1,
    
    -- Custom sections order (JSON array of section names)
    section_order TEXT DEFAULT '["about","uploads","collections","friends","guestbook"]',
    
    -- Custom widgets (JSON array of widget configs)
    widgets TEXT,
    
    -- Profile views
    view_count INTEGER DEFAULT 0,
    
    updated_at TEXT DEFAULT (datetime('now'))
);

-- User viewing preferences (how THEY see the site, not their profile)
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    
    -- Theme preference for browsing
    theme TEXT DEFAULT 'terminal',
    
    -- Custom colors for browsing
    custom_primary TEXT,
    custom_bg TEXT,
    custom_text TEXT,
    
    -- Layout
    density TEXT DEFAULT 'normal', -- compact, normal, comfortable
    default_view TEXT DEFAULT 'grid', -- grid, list
    
    -- Content preferences
    default_content_type TEXT DEFAULT 'all', -- all, papers, videos, art, music
    mature_content INTEGER DEFAULT 0,
    
    -- Accessibility
    font_size INTEGER DEFAULT 100, -- percentage
    reduce_motion INTEGER DEFAULT 0,
    high_contrast INTEGER DEFAULT 0,
    
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- UNIVERSAL CONTENT TABLE
-- ============================================

-- Single table for all content types with type-specific metadata in JSON
CREATE TABLE IF NOT EXISTS content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Core metadata
    content_type TEXT NOT NULL, -- paper, video, art, music, album, book, dataset, collection
    title TEXT NOT NULL,
    description TEXT,
    
    -- Dates
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    published_at TEXT,
    
    -- Status
    status TEXT DEFAULT 'draft', -- draft, published, unlisted, archived
    visibility TEXT DEFAULT 'public', -- public, members, private
    
    -- License
    license TEXT DEFAULT 'CC-BY-4.0',
    
    -- Stats
    view_count INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    
    -- Moderation
    is_flagged INTEGER DEFAULT 0,
    is_mature INTEGER DEFAULT 0,
    
    -- Type-specific metadata stored as JSON
    metadata TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_content_uuid ON content(uuid);
CREATE INDEX IF NOT EXISTS idx_content_uploader ON content(uploader_id);
CREATE INDEX IF NOT EXISTS idx_content_type ON content(content_type);
CREATE INDEX IF NOT EXISTS idx_content_status ON content(status);
CREATE INDEX IF NOT EXISTS idx_content_published ON content(published_at);

-- ============================================
-- CONTENT FILES
-- ============================================

CREATE TABLE IF NOT EXISTS content_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    
    -- File info
    filename TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_hash TEXT NOT NULL,
    
    -- Type
    file_role TEXT DEFAULT 'main', -- main, thumbnail, preview, supplementary
    
    -- IPFS
    ipfs_cid TEXT,
    ipfs_pinned INTEGER DEFAULT 0,
    
    -- Video/audio specific
    duration INTEGER, -- seconds
    width INTEGER,
    height INTEGER,
    bitrate INTEGER,
    
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_content_files_content ON content_files(content_id);
CREATE INDEX IF NOT EXISTS idx_content_files_cid ON content_files(ipfs_cid);

-- ============================================
-- VIDEO-SPECIFIC METADATA
-- ============================================

-- For faster video queries without parsing JSON
CREATE TABLE IF NOT EXISTS video_metadata (
    content_id INTEGER PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
    duration INTEGER NOT NULL, -- seconds
    width INTEGER,
    height INTEGER,
    framerate REAL,
    video_codec TEXT,
    audio_codec TEXT,
    thumbnail_time INTEGER DEFAULT 0, -- second to use for thumbnail
    chapters TEXT, -- JSON array of {time, title}
    subtitles_available INTEGER DEFAULT 0,
    transcript TEXT
);

-- ============================================
-- MUSIC-SPECIFIC METADATA
-- ============================================

CREATE TABLE IF NOT EXISTS music_metadata (
    content_id INTEGER PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
    duration INTEGER NOT NULL, -- seconds
    artist TEXT NOT NULL,
    album_name TEXT,
    album_id INTEGER REFERENCES content(id) ON DELETE SET NULL,
    track_number INTEGER,
    genre TEXT,
    bpm INTEGER,
    key TEXT, -- musical key
    isrc TEXT, -- International Standard Recording Code
    lyrics TEXT
);

-- ============================================
-- ART-SPECIFIC METADATA
-- ============================================

CREATE TABLE IF NOT EXISTS art_metadata (
    content_id INTEGER PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
    artist TEXT NOT NULL,
    medium TEXT, -- oil, digital, watercolor, photography, etc.
    dimensions TEXT, -- "24x36 inches" or "1920x1080 pixels"
    year_created INTEGER,
    series_name TEXT,
    series_number INTEGER,
    location TEXT, -- where it was created
    tags TEXT -- JSON array
);

-- ============================================
-- CONTENT CREATORS / CONTRIBUTORS
-- ============================================

CREATE TABLE IF NOT EXISTS content_creators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    creator_name TEXT NOT NULL,
    creator_role TEXT DEFAULT 'creator', -- creator, author, artist, performer, director, etc.
    creator_order INTEGER DEFAULT 0,
    is_primary INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_content_creators_content ON content_creators(content_id);
CREATE INDEX IF NOT EXISTS idx_content_creators_user ON content_creators(user_id);

-- ============================================
-- CATEGORIES / TAGS
-- ============================================

CREATE TABLE IF NOT EXISTS content_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    tag TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_tags_content ON content_tags(content_id);
CREATE INDEX IF NOT EXISTS idx_content_tags_tag ON content_tags(tag);

CREATE TABLE IF NOT EXISTS content_categories (
    content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    discipline_id INTEGER NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
    is_primary INTEGER DEFAULT 0,
    PRIMARY KEY (content_id, discipline_id)
);

-- ============================================
-- COLLECTIONS / PLAYLISTS
-- ============================================

CREATE TABLE IF NOT EXISTS collection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    item_order INTEGER NOT NULL DEFAULT 0,
    added_at TEXT DEFAULT (datetime('now')),
    note TEXT
);

CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_content ON collection_items(content_id);

-- ============================================
-- SOCIAL FEATURES
-- ============================================

-- Guestbook entries for profiles
CREATE TABLE IF NOT EXISTS guestbook_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT, -- for non-logged-in users (if allowed)
    message TEXT NOT NULL,
    is_visible INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guestbook_profile ON guestbook_entries(profile_user_id);

-- Following / Friends
CREATE TABLE IF NOT EXISTS user_follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON user_follows(following_id);

-- Content likes/favorites
CREATE TABLE IF NOT EXISTS content_likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_user ON content_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_content ON content_likes(content_id);

-- ============================================
-- COMMENTS
-- ============================================

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    is_visible INTEGER DEFAULT 1,
    is_edited INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comments_content ON comments(content_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

-- ============================================
-- ACTIVITY LOG
-- ============================================

CREATE TABLE IF NOT EXISTS user_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL, -- upload, like, follow, comment, collection_add
    content_id INTEGER REFERENCES content(id) ON DELETE CASCADE,
    target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    metadata TEXT, -- JSON for additional context
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_user ON user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_type ON user_activity(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_time ON user_activity(created_at);

-- ============================================
-- EXTENDED DISCIPLINES FOR NON-ACADEMIC CONTENT
-- ============================================

-- Insert additional categories for art, music, video
INSERT OR IGNORE INTO disciplines (slug, name, description, icon, sort_order) VALUES
    ('visual-art', 'Visual Art', 'Paintings, drawings, digital art, photography', '🎨', 100),
    ('music', 'Music', 'Albums, singles, compositions, performances', '🎵', 101),
    ('film-video', 'Film & Video', 'Documentaries, tutorials, lectures, short films', '🎬', 102),
    ('literature', 'Literature', 'Poetry, fiction, creative writing', '📝', 103),
    ('photography', 'Photography', 'Art photography, photojournalism, nature', '📷', 104),
    ('design', 'Design', 'Graphic design, UI/UX, industrial design', '✏️', 105),
    ('education', 'Educational Content', 'Tutorials, courses, how-to guides', '🎓', 106),
    ('lectures', 'Lectures & Talks', 'Academic lectures, conference talks', '🎤', 107),
    ('podcasts', 'Podcasts & Audio', 'Podcast episodes, audio essays', '🎙️', 108),
    ('animation', 'Animation', 'Animated films, motion graphics', '🎞️', 109);
