//! Database schema and initialization

use rusqlite::Connection;

/// Initialize database schema
pub fn init_schema(conn: &Connection) -> anyhow::Result<()> {
    conn.execute_batch(
        r#"
        -- Users table
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT,
            password_hash TEXT NOT NULL,
            public_key TEXT UNIQUE NOT NULL,
            display_name TEXT,
            bio TEXT,
            affiliation TEXT,
            avatar_hash TEXT,
            is_admin INTEGER DEFAULT 0,
            is_moderator INTEGER DEFAULT 0,
            is_verified INTEGER DEFAULT 0,
            email_verified INTEGER DEFAULT 0,
            total_uploads INTEGER DEFAULT 0,
            total_reviews INTEGER DEFAULT 0,
            reputation_score INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            last_login TEXT
        );

        -- Sessions table
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Files table
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            content_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            hash TEXT NOT NULL,
            grabnet_cid TEXT,
            title TEXT,
            description TEXT,
            is_public INTEGER DEFAULT 1,
            -- Work type: empirical, theoretical, methodological, artistic, speculative
            work_type TEXT DEFAULT 'empirical' NOT NULL,
            view_count INTEGER DEFAULT 0,
            download_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- File tags
        CREATE TABLE IF NOT EXISTS file_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            UNIQUE(file_id, tag),
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        -- Reviews table
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            reviewer_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
            content TEXT,
            -- Dynamic criteria scores stored as JSON (keys match work type criteria)
            criteria_scores TEXT DEFAULT '{}',
            -- Legacy fields for backward compatibility
            methodology_score INTEGER CHECK(methodology_score IS NULL OR (methodology_score >= 1 AND methodology_score <= 5)),
            clarity_score INTEGER CHECK(clarity_score IS NULL OR (clarity_score >= 1 AND clarity_score <= 5)),
            reproducibility_score INTEGER CHECK(reproducibility_score IS NULL OR (reproducibility_score >= 1 AND reproducibility_score <= 5)),
            significance_score INTEGER CHECK(significance_score IS NULL OR (significance_score >= 1 AND significance_score <= 5)),
            helpful_count INTEGER DEFAULT 0,
            unhelpful_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(file_id, reviewer_id),
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
            FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Review votes
        CREATE TABLE IF NOT EXISTS review_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            review_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            helpful INTEGER NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(review_id, user_id),
            FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Password reset tokens
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Email verification tokens
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Moderation: Reports
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reporter_id INTEGER NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'pending',
            reviewed_by INTEGER,
            reviewed_at TEXT,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        );

        -- Moderation: User bans
        CREATE TABLE IF NOT EXISTS user_bans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            ban_type TEXT NOT NULL,
            reason TEXT NOT NULL,
            banned_by INTEGER NOT NULL,
            expires_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Moderation: Content flags
        CREATE TABLE IF NOT EXISTS content_flags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_uuid TEXT NOT NULL,
            flag_type TEXT NOT NULL,
            flagged_by INTEGER NOT NULL,
            note TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(file_uuid, flag_type),
            FOREIGN KEY (flagged_by) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Moderation: Action log
        CREATE TABLE IF NOT EXISTS moderation_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            moderator_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            details TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (moderator_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
        CREATE INDEX IF NOT EXISTS idx_files_content_type ON files(content_type);
        CREATE INDEX IF NOT EXISTS idx_files_public ON files(is_public);
        CREATE INDEX IF NOT EXISTS idx_files_created ON files(created_at);
        CREATE INDEX IF NOT EXISTS idx_file_tags_tag ON file_tags(tag);
        CREATE INDEX IF NOT EXISTS idx_reviews_file ON reviews(file_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

        -- Full-text search for files
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
            title,
            description,
            filename,
            content='files',
            content_rowid='id'
        );

        -- Triggers to keep FTS in sync
        CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
            INSERT INTO files_fts(rowid, title, description, filename) 
            VALUES (new.id, new.title, new.description, new.filename);
        END;

        CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
            INSERT INTO files_fts(files_fts, rowid, title, description, filename) 
            VALUES ('delete', old.id, old.title, old.description, old.filename);
        END;

        CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
            INSERT INTO files_fts(files_fts, rowid, title, description, filename) 
            VALUES ('delete', old.id, old.title, old.description, old.filename);
            INSERT INTO files_fts(rowid, title, description, filename) 
            VALUES (new.id, new.title, new.description, new.filename);
        END;
        "#,
    )?;
    
    // Extended schema for Open Scholar principles
    init_extended_schema(conn)?;
    
    Ok(())
}

/// Extended schema for domain-scoped reputation, versioning, and result types
fn init_extended_schema(conn: &Connection) -> anyhow::Result<()> {
    conn.execute_batch(
        r#"
        -- ============================================================
        -- DOMAIN-SCOPED REPUTATION
        -- One identity, many reputational contexts
        -- A scientist's physics reputation doesn't transfer to art
        -- ============================================================
        
        CREATE TABLE IF NOT EXISTS domain_reputation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            -- Domain matches work_type: empirical, theoretical, methodological, artistic, speculative
            domain TEXT NOT NULL,
            -- Earned through quality reviews and recognized contributions in this domain
            reputation_score INTEGER DEFAULT 0,
            -- Number of works contributed in this domain
            contribution_count INTEGER DEFAULT 0,
            -- Number of reviews given in this domain
            review_count INTEGER DEFAULT 0,
            -- Number of times this user's reviews were found helpful
            helpful_reviews INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, domain),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        
        CREATE INDEX IF NOT EXISTS idx_domain_rep_user ON domain_reputation(user_id);
        CREATE INDEX IF NOT EXISTS idx_domain_rep_domain ON domain_reputation(domain);
        
        -- ============================================================
        -- VERSIONING & REVISION HISTORY
        -- Drafts, revisions, retractions visible - not hidden
        -- Process is preserved, not erased
        -- ============================================================
        
        CREATE TABLE IF NOT EXISTS file_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_uuid TEXT NOT NULL,
            version_number INTEGER NOT NULL,
            -- draft, published, revision, retracted, retired, abandoned
            status TEXT NOT NULL DEFAULT 'published',
            -- Hash of the content for this version
            content_hash TEXT NOT NULL,
            grabnet_cid TEXT,
            -- What changed in this version
            change_summary TEXT,
            -- For retractions: why was it retracted?
            retraction_reason TEXT,
            -- For abandoned work: why was it abandoned?
            abandonment_note TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(file_uuid, version_number),
            FOREIGN KEY (file_uuid) REFERENCES files(uuid) ON DELETE CASCADE
        );
        
        CREATE INDEX IF NOT EXISTS idx_versions_file ON file_versions(file_uuid);
        
        -- ============================================================
        -- RESULT TYPE - Explicit support for negative space
        -- Null results, failed experiments, unresolved works are valid
        -- ============================================================
        
        -- Add result_type to files (via ALTER or default handling)
        -- result_type: positive, null, negative, inconclusive, unresolved, exploratory
        
        CREATE TABLE IF NOT EXISTS file_result_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_uuid TEXT UNIQUE NOT NULL,
            -- positive: confirms hypothesis / achieves goal
            -- null: no significant result found
            -- negative: disproves hypothesis / unexpected failure
            -- inconclusive: insufficient evidence either way
            -- unresolved: intentionally leaves questions open (artistic/speculative)
            -- exploratory: not seeking specific result (process-focused)
            result_type TEXT DEFAULT 'positive',
            -- Author's honest assessment of what this work contributes
            result_statement TEXT,
            -- For null/negative: what was tried that didn't work?
            methodology_notes TEXT,
            -- For artistic/speculative: what questions does this raise?
            open_questions TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (file_uuid) REFERENCES files(uuid) ON DELETE CASCADE
        );
        
        -- ============================================================
        -- CITATIONS - Hash-based references for anything
        -- Brushstrokes, sound textures, dataset snapshots, timestamps
        -- If it can be hashed, it can be cited
        -- ============================================================
        
        CREATE TABLE IF NOT EXISTS citations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            -- The work doing the citing
            citing_file_uuid TEXT NOT NULL,
            -- The work being cited (can be external via hash)
            cited_file_uuid TEXT,
            -- Hash of the specific element being cited (for granular references)
            cited_hash TEXT,
            -- For external citations: URL, DOI, or description
            external_reference TEXT,
            -- Type of citation: reference, builds-on, responds-to, contradicts, replicates
            citation_type TEXT DEFAULT 'reference',
            -- Optional context about why this is cited
            context_note TEXT,
            -- For timestamped citations (e.g., video at 3:45)
            timestamp_ref TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (citing_file_uuid) REFERENCES files(uuid) ON DELETE CASCADE
        );
        
        CREATE INDEX IF NOT EXISTS idx_citations_citing ON citations(citing_file_uuid);
        CREATE INDEX IF NOT EXISTS idx_citations_cited ON citations(cited_file_uuid);
        CREATE INDEX IF NOT EXISTS idx_citations_hash ON citations(cited_hash);
        
        -- ============================================================
        -- PROCEDURAL MODERATION
        -- Not moral judgment - tagged contexts, visible reasoning
        -- Silence is suspicious. Procedure builds trust.
        -- ============================================================
        
        -- Context tags for content (spaces can have different norms)
        CREATE TABLE IF NOT EXISTS content_contexts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_uuid TEXT NOT NULL,
            -- Context tags: academic, artistic, experimental, mature, sensitive
            context_tag TEXT NOT NULL,
            -- Who assigned this context
            assigned_by INTEGER,
            -- Is this author-assigned or moderator-assigned?
            assignment_type TEXT DEFAULT 'author',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(file_uuid, context_tag),
            FOREIGN KEY (file_uuid) REFERENCES files(uuid) ON DELETE CASCADE,
            FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
        );
        
        -- Explicit norm definitions per context
        CREATE TABLE IF NOT EXISTS context_norms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            context_tag TEXT UNIQUE NOT NULL,
            -- Human-readable description of what's expected in this context
            description TEXT NOT NULL,
            -- JSON array of what's explicitly allowed
            allowed_content TEXT DEFAULT '[]',
            -- JSON array of what's explicitly not allowed
            disallowed_content TEXT DEFAULT '[]',
            -- Who reviews content in this context
            review_expectations TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        
        -- All moderation actions must have visible reasoning
        -- (extends moderation_log with more required fields)
        CREATE TABLE IF NOT EXISTS moderation_reasoning (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            moderation_log_id INTEGER NOT NULL,
            -- Which policy/norm was invoked
            policy_cited TEXT NOT NULL,
            -- Specific reasoning for this action
            reasoning TEXT NOT NULL,
            -- Was the author notified?
            author_notified INTEGER DEFAULT 1,
            -- Can this be appealed?
            appealable INTEGER DEFAULT 1,
            -- Appeal deadline if appealable
            appeal_deadline TEXT,
            FOREIGN KEY (moderation_log_id) REFERENCES moderation_log(id) ON DELETE CASCADE
        );
        
        -- ============================================================
        -- TEMPORAL VISIBILITY
        -- Time matters more than rankings
        -- Decay, resurface, retire - work breathes with time
        -- ============================================================
        
        CREATE TABLE IF NOT EXISTS visibility_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_uuid TEXT UNIQUE NOT NULL,
            -- active, dormant, retired, resurfaced
            visibility_status TEXT DEFAULT 'active',
            -- When was this last actively engaged with
            last_engagement TEXT DEFAULT (datetime('now')),
            -- Author can retire work without deleting
            retired_at TEXT,
            retirement_note TEXT,
            -- Track if this was resurfaced due to relevance
            resurfaced_at TEXT,
            resurfaced_reason TEXT,
            FOREIGN KEY (file_uuid) REFERENCES files(uuid) ON DELETE CASCADE
        );
        
        -- ============================================================
        -- SACRED CONSTRAINTS - Enforced at database level
        -- ============================================================
        
        -- Child safety: permanent ban and content forfeiture
        CREATE TABLE IF NOT EXISTS csam_violations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            -- First violation: permanent ban, works forfeit to nodes
            -- Any subsequent flagged content from same identity: all content removed
            violation_count INTEGER DEFAULT 1,
            reported_to_authorities INTEGER DEFAULT 0,
            authority_report_reference TEXT,
            first_violation_at TEXT DEFAULT (datetime('now')),
            last_violation_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        
        -- Platform principles (immutable reference)
        CREATE TABLE IF NOT EXISTS sacred_constraints (
            id INTEGER PRIMARY KEY,
            constraint_name TEXT UNIQUE NOT NULL,
            description TEXT NOT NULL,
            violation_consequence TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        
        -- Insert sacred constraints if not exist
        INSERT OR IGNORE INTO sacred_constraints (id, constraint_name, description, violation_consequence) VALUES
            (1, 'no_advertising', 'No advertising, ever. Not now, not when we scale, not when we need money.', 'Remove ads, revert changes'),
            (2, 'no_algorithmic_ranking', 'No algorithmic ranking. Discovery is slow and intentional. Trending does not exist.', 'Remove ranking, restore chronological'),
            (3, 'no_ownership_transfer', 'No ownership transfer of works. You cannot sell your authorship.', 'Nullify transfer, restore original author'),
            (4, 'no_opaque_takedowns', 'Every moderation action is visible, with reasoning, following stated procedure.', 'Publish reasoning, allow appeal'),
            (5, 'no_minor_content', 'No content involving minors. Child exploitation results in permanent ban, content forfeiture, and law enforcement reporting.', 'Permanent ban, forfeit works, report to authorities');
        "#,
    )?;
    
    Ok(())
}
