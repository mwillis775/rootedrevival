//! File management

use rusqlite::params;

use crate::db::Database;
use crate::models::{
    File, NewFile, DomainReputation, FileVersion, VersionStatus,
    ResultType, Citation, CitationType, VisibilityStatus,
    ContentContext, ModerationReasoning, WorkType,
};

impl Database {
    /// Create a new file record
    pub fn create_file(&self, new_file: NewFile, tags: Option<Vec<String>>) -> anyhow::Result<File> {
        let conn = self.conn();
        
        conn.execute(
            r#"
            INSERT INTO files (
                uuid, user_id, filename, original_filename, content_type,
                size, hash, grabnet_cid, title, description, is_public, work_type
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
            params![
                new_file.uuid,
                new_file.user_id,
                new_file.filename,
                new_file.original_filename,
                new_file.content_type,
                new_file.size,
                new_file.hash,
                new_file.grabnet_cid,
                new_file.title,
                new_file.description,
                new_file.is_public as i64,
                new_file.work_type.as_str(),
            ],
        )?;
        
        let file_id = conn.last_insert_rowid();
        
        // Add tags
        if let Some(tags) = tags {
            for tag in tags {
                conn.execute(
                    "INSERT OR IGNORE INTO file_tags (file_id, tag) VALUES (?1, ?2)",
                    params![file_id, tag.to_lowercase().trim()],
                )?;
            }
        }
        
        // Update user stats
        conn.execute(
            "UPDATE users SET total_uploads = total_uploads + 1 WHERE id = ?1",
            params![new_file.user_id],
        )?;
        
        drop(conn);
        self.get_file_by_id(file_id)
    }
    
    /// Get file by ID
    pub fn get_file_by_id(&self, id: i64) -> anyhow::Result<File> {
        let conn = self.conn();
        
        let file = conn.query_row(
            r#"
            SELECT f.*, u.username, u.display_name as uploader_name
            FROM files f
            JOIN users u ON f.user_id = u.id
            WHERE f.id = ?1
            "#,
            params![id],
            |row| File::from_row(row),
        )?;
        
        let tags: Vec<String> = conn
            .prepare("SELECT tag FROM file_tags WHERE file_id = ?1")?
            .query_map(params![id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(File { tags, ..file })
    }
    
    /// Get file by UUID
    pub fn get_file_by_uuid(&self, uuid: &str) -> anyhow::Result<Option<File>> {
        let conn = self.conn();
        
        let result = conn.query_row(
            r#"
            SELECT f.*, u.username, u.display_name as uploader_name
            FROM files f
            JOIN users u ON f.user_id = u.id
            WHERE f.uuid = ?1
            "#,
            params![uuid],
            |row| File::from_row(row),
        );
        
        match result {
            Ok(file) => {
                let tags: Vec<String> = conn
                    .prepare("SELECT tag FROM file_tags WHERE file_id = ?1")?
                    .query_map(params![file.id], |row| row.get(0))?
                    .filter_map(|r| r.ok())
                    .collect();
                
                Ok(Some(File { tags, ..file }))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    
    /// Get files by user
    pub fn get_files_by_user(&self, user_id: i64, limit: u32, offset: u32) -> anyhow::Result<Vec<File>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT f.*, u.username, u.display_name as uploader_name
            FROM files f
            JOIN users u ON f.user_id = u.id
            WHERE f.user_id = ?1
            ORDER BY f.created_at DESC
            LIMIT ?2 OFFSET ?3
            "#,
        )?;
        
        let files: Vec<File> = stmt
            .query_map(params![user_id, limit, offset], |row| File::from_row(row))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(files)
    }
    
    /// Get recent public files
    pub fn get_recent_files(&self, limit: u32, offset: u32) -> anyhow::Result<Vec<File>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT f.*, u.username, u.display_name as uploader_name
            FROM files f
            JOIN users u ON f.user_id = u.id
            WHERE f.is_public = 1
            ORDER BY f.created_at DESC
            LIMIT ?1 OFFSET ?2
            "#,
        )?;
        
        let files: Vec<File> = stmt
            .query_map(params![limit, offset], |row| File::from_row(row))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(files)
    }
    
    /// Get files by content type
    pub fn get_files_by_type(&self, content_type: &str, limit: u32, offset: u32) -> anyhow::Result<Vec<File>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT f.*, u.username, u.display_name as uploader_name
            FROM files f
            JOIN users u ON f.user_id = u.id
            WHERE f.is_public = 1 AND f.content_type LIKE ?1
            ORDER BY f.created_at DESC
            LIMIT ?2 OFFSET ?3
            "#,
        )?;
        
        let files: Vec<File> = stmt
            .query_map(params![content_type, limit, offset], |row| File::from_row(row))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(files)
    }
    
    /// Get files by tag
    pub fn get_files_by_tag(&self, tag: &str, limit: u32, offset: u32) -> anyhow::Result<Vec<File>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT f.*, u.username, u.display_name as uploader_name
            FROM files f
            JOIN users u ON f.user_id = u.id
            JOIN file_tags ft ON f.id = ft.file_id
            WHERE f.is_public = 1 AND ft.tag = ?1
            ORDER BY f.created_at DESC
            LIMIT ?2 OFFSET ?3
            "#,
        )?;
        
        let files: Vec<File> = stmt
            .query_map(params![tag.to_lowercase(), limit, offset], |row| File::from_row(row))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(files)
    }
    
    /// Search files using FTS
    pub fn search_files(&self, query: &str, limit: u32) -> anyhow::Result<Vec<File>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT f.*, u.username, u.display_name as uploader_name
            FROM files f
            JOIN users u ON f.user_id = u.id
            JOIN files_fts fts ON f.id = fts.rowid
            WHERE f.is_public = 1 AND files_fts MATCH ?1
            ORDER BY rank
            LIMIT ?2
            "#,
        )?;
        
        let files: Vec<File> = stmt
            .query_map(params![query, limit], |row| File::from_row(row))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(files)
    }
    
    /// Get files awaiting peer review (few or no reviews)
    pub fn get_files_needing_review(&self, limit: u32, offset: u32) -> anyhow::Result<Vec<File>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT f.*, u.username, u.display_name as uploader_name,
                   (SELECT COUNT(*) FROM reviews r WHERE r.file_id = f.id) as review_count
            FROM files f
            JOIN users u ON f.user_id = u.id
            WHERE f.is_public = 1
            GROUP BY f.id
            HAVING review_count < 3
            ORDER BY review_count ASC, f.created_at DESC
            LIMIT ?1 OFFSET ?2
            "#,
        )?;
        
        let files: Vec<File> = stmt
            .query_map(params![limit, offset], |row| File::from_row(row))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(files)
    }
    
    /// Get popular tags
    pub fn get_popular_tags(&self, limit: u32) -> anyhow::Result<Vec<(String, i64)>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT tag, COUNT(*) as count
            FROM file_tags
            GROUP BY tag
            ORDER BY count DESC
            LIMIT ?1
            "#,
        )?;
        
        let tags: Vec<(String, i64)> = stmt
            .query_map(params![limit], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(tags)
    }
    
    /// Update file metadata
    pub fn update_file(&self, uuid: &str, title: Option<&str>, description: Option<&str>, is_public: Option<bool>) -> anyhow::Result<()> {
        let conn = self.conn();
        
        if let Some(t) = title {
            conn.execute(
                "UPDATE files SET title = ?1, updated_at = datetime('now') WHERE uuid = ?2",
                params![t, uuid],
            )?;
        }
        
        if let Some(d) = description {
            conn.execute(
                "UPDATE files SET description = ?1, updated_at = datetime('now') WHERE uuid = ?2",
                params![d, uuid],
            )?;
        }
        
        if let Some(p) = is_public {
            conn.execute(
                "UPDATE files SET is_public = ?1, updated_at = datetime('now') WHERE uuid = ?2",
                params![p as i64, uuid],
            )?;
        }
        
        Ok(())
    }
    
    /// Delete a file
    pub fn delete_file(&self, uuid: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM files WHERE uuid = ?1", params![uuid])?;
        Ok(())
    }
    
    /// Increment view count
    pub fn increment_view_count(&self, uuid: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        conn.execute(
            "UPDATE files SET view_count = view_count + 1 WHERE uuid = ?1",
            params![uuid],
        )?;
        Ok(())
    }
    
    /// Increment download count
    pub fn increment_download_count(&self, uuid: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        conn.execute(
            "UPDATE files SET download_count = download_count + 1 WHERE uuid = ?1",
            params![uuid],
        )?;
        Ok(())
    }
    
    // =========================================================================
    // Admin Methods
    // =========================================================================
    
    /// List all files for admin (with pagination)
    pub fn list_files_admin(&self, offset: i64, limit: i64, search: Option<&str>) -> anyhow::Result<(Vec<serde_json::Value>, i64)> {
        let conn = self.conn();
        
        // Build query based on search
        let (query, count_query) = if search.is_some() {
            (
                r#"
                SELECT f.uuid, f.filename, f.original_filename, f.title, f.content_type, 
                       f.size, f.is_public, f.view_count, f.download_count, f.created_at,
                       u.username, u.id as user_id
                FROM files f
                JOIN users u ON f.user_id = u.id
                WHERE f.filename LIKE ?1 OR f.title LIKE ?1 OR u.username LIKE ?1
                ORDER BY f.created_at DESC
                LIMIT ?2 OFFSET ?3
                "#,
                "SELECT COUNT(*) FROM files f JOIN users u ON f.user_id = u.id WHERE f.filename LIKE ?1 OR f.title LIKE ?1 OR u.username LIKE ?1"
            )
        } else {
            (
                r#"
                SELECT f.uuid, f.filename, f.original_filename, f.title, f.content_type, 
                       f.size, f.is_public, f.view_count, f.download_count, f.created_at,
                       u.username, u.id as user_id
                FROM files f
                JOIN users u ON f.user_id = u.id
                ORDER BY f.created_at DESC
                LIMIT ?1 OFFSET ?2
                "#,
                "SELECT COUNT(*) FROM files"
            )
        };
        
        let search_pattern = search.map(|s| format!("%{}%", s));
        
        let total: i64 = if let Some(ref pattern) = search_pattern {
            conn.query_row(count_query, [pattern], |row| row.get(0))?
        } else {
            conn.query_row(count_query, [], |row| row.get(0))?
        };
        
        let mut stmt = conn.prepare(query)?;
        let mut files = Vec::new();
        
        let rows = if let Some(ref pattern) = search_pattern {
            stmt.query(rusqlite::params![pattern, limit, offset])?
        } else {
            stmt.query(rusqlite::params![limit, offset])?
        };
        
        let mut rows = rows;
        while let Some(row) = rows.next()? {
            files.push(serde_json::json!({
                "uuid": row.get::<_, String>(0)?,
                "filename": row.get::<_, String>(1)?,
                "original_filename": row.get::<_, String>(2)?,
                "title": row.get::<_, Option<String>>(3)?,
                "content_type": row.get::<_, String>(4)?,
                "size": row.get::<_, i64>(5)?,
                "is_public": row.get::<_, i32>(6)? != 0,
                "view_count": row.get::<_, i64>(7)?,
                "download_count": row.get::<_, i64>(8)?,
                "created_at": row.get::<_, String>(9)?,
                "username": row.get::<_, String>(10)?,
                "user_id": row.get::<_, i64>(11)?,
            }));
        }
        
        Ok((files, total))
    }
    
    /// Delete file by UUID (for admin use)
    pub fn delete_file_by_uuid(&self, uuid: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM files WHERE uuid = ?1", params![uuid])?;
        Ok(())
    }
    
    // =========================================================================
    // Domain-Scoped Reputation
    // =========================================================================
    
    /// Get user's reputation in a specific domain
    pub fn get_domain_reputation(&self, user_id: i64, domain: WorkType) -> anyhow::Result<Option<DomainReputation>> {
        let conn = self.conn();
        
        let result = conn.query_row(
            "SELECT * FROM domain_reputation WHERE user_id = ?1 AND domain = ?2",
            params![user_id, domain.as_str()],
            |row| DomainReputation::from_row(row),
        );
        
        match result {
            Ok(rep) => Ok(Some(rep)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    
    /// Get all domain reputations for a user
    pub fn get_all_domain_reputations(&self, user_id: i64) -> anyhow::Result<Vec<DomainReputation>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            "SELECT * FROM domain_reputation WHERE user_id = ?1 ORDER BY reputation_score DESC"
        )?;
        
        let reps: Vec<DomainReputation> = stmt
            .query_map(params![user_id], |row| DomainReputation::from_row(row))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(reps)
    }
    
    /// Add contribution to domain reputation
    pub fn add_domain_contribution(&self, user_id: i64, domain: WorkType) -> anyhow::Result<()> {
        let conn = self.conn();
        
        conn.execute(
            r#"
            INSERT INTO domain_reputation (user_id, domain, contribution_count)
            VALUES (?1, ?2, 1)
            ON CONFLICT(user_id, domain) DO UPDATE SET
                contribution_count = contribution_count + 1,
                updated_at = datetime('now')
            "#,
            params![user_id, domain.as_str()],
        )?;
        
        Ok(())
    }
    
    /// Add review to domain reputation
    pub fn add_domain_review(&self, user_id: i64, domain: WorkType, was_helpful: bool) -> anyhow::Result<()> {
        let conn = self.conn();
        
        let helpful_increment = if was_helpful { 1 } else { 0 };
        
        conn.execute(
            r#"
            INSERT INTO domain_reputation (user_id, domain, review_count, helpful_reviews)
            VALUES (?1, ?2, 1, ?3)
            ON CONFLICT(user_id, domain) DO UPDATE SET
                review_count = review_count + 1,
                helpful_reviews = helpful_reviews + ?3,
                updated_at = datetime('now')
            "#,
            params![user_id, domain.as_str(), helpful_increment],
        )?;
        
        Ok(())
    }
    
    // =========================================================================
    // Versioning - Visible revision history
    // =========================================================================
    
    /// Create a new version of a file
    pub fn create_file_version(
        &self,
        file_uuid: &str,
        version_number: i32,
        status: VersionStatus,
        content_hash: &str,
        grabnet_cid: Option<&str>,
        change_summary: Option<&str>,
    ) -> anyhow::Result<()> {
        let conn = self.conn();
        
        conn.execute(
            r#"
            INSERT INTO file_versions (
                file_uuid, version_number, status, content_hash, grabnet_cid, change_summary
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![
                file_uuid,
                version_number,
                status.as_str(),
                content_hash,
                grabnet_cid,
                change_summary,
            ],
        )?;
        
        Ok(())
    }
    
    /// Get all versions of a file
    pub fn get_file_versions(&self, file_uuid: &str) -> anyhow::Result<Vec<FileVersion>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            "SELECT * FROM file_versions WHERE file_uuid = ?1 ORDER BY version_number DESC"
        )?;
        
        let versions: Vec<FileVersion> = stmt
            .query_map(params![file_uuid], |row| {
                let status_str: String = row.get("status")?;
                Ok(FileVersion {
                    file_uuid: row.get("file_uuid")?,
                    version_number: row.get("version_number")?,
                    status: VersionStatus::from_str(&status_str).unwrap_or(VersionStatus::Published),
                    content_hash: row.get("content_hash")?,
                    grabnet_cid: row.get("grabnet_cid")?,
                    change_summary: row.get("change_summary")?,
                    retraction_reason: row.get("retraction_reason")?,
                    abandonment_note: row.get("abandonment_note")?,
                    created_at: row.get("created_at")?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(versions)
    }
    
    /// Retract a file version (with required reason)
    pub fn retract_file_version(&self, file_uuid: &str, version_number: i32, reason: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        
        conn.execute(
            r#"
            UPDATE file_versions 
            SET status = 'retracted', retraction_reason = ?1
            WHERE file_uuid = ?2 AND version_number = ?3
            "#,
            params![reason, file_uuid, version_number],
        )?;
        
        Ok(())
    }
    
    /// Abandon a file (with note about why)
    pub fn abandon_file(&self, file_uuid: &str, abandonment_note: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        
        conn.execute(
            r#"
            UPDATE file_versions 
            SET status = 'abandoned', abandonment_note = ?1
            WHERE file_uuid = ?2 AND version_number = (
                SELECT MAX(version_number) FROM file_versions WHERE file_uuid = ?2
            )
            "#,
            params![abandonment_note, file_uuid],
        )?;
        
        Ok(())
    }
    
    // =========================================================================
    // Result Metadata - Explicit support for negative space
    // =========================================================================
    
    /// Set result type for a file
    pub fn set_file_result_type(
        &self,
        file_uuid: &str,
        result_type: ResultType,
        null_result_significance: Option<&str>,
        failure_analysis: Option<&str>,
    ) -> anyhow::Result<()> {
        let conn = self.conn();
        
        conn.execute(
            r#"
            INSERT INTO file_result_metadata (
                file_uuid, result_type, null_result_significance, failure_analysis
            ) VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(file_uuid) DO UPDATE SET
                result_type = ?2,
                null_result_significance = ?3,
                failure_analysis = ?4,
                updated_at = datetime('now')
            "#,
            params![file_uuid, result_type.as_str(), null_result_significance, failure_analysis],
        )?;
        
        Ok(())
    }
    
    // =========================================================================
    // Citations - Hash-based references
    // =========================================================================
    
    /// Add a citation
    pub fn add_citation(
        &self,
        citing_file_uuid: &str,
        cited_file_uuid: Option<&str>,
        cited_hash: Option<&str>,
        external_reference: Option<&str>,
        citation_type: CitationType,
        context_note: Option<&str>,
        timestamp_ref: Option<&str>,
    ) -> anyhow::Result<i64> {
        let conn = self.conn();
        
        let type_str = match citation_type {
            CitationType::Reference => "reference",
            CitationType::BuildsOn => "builds-on",
            CitationType::RespondsTo => "responds-to",
            CitationType::Contradicts => "contradicts",
            CitationType::Replicates => "replicates",
            CitationType::UsesMethod => "uses-method",
            CitationType::InfluencedBy => "influenced-by",
        };
        
        conn.execute(
            r#"
            INSERT INTO citations (
                citing_file_uuid, cited_file_uuid, cited_hash, external_reference,
                citation_type, context_note, timestamp_ref
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                citing_file_uuid,
                cited_file_uuid,
                cited_hash,
                external_reference,
                type_str,
                context_note,
                timestamp_ref,
            ],
        )?;
        
        Ok(conn.last_insert_rowid())
    }
    
    /// Get citations from a file
    pub fn get_citations_from(&self, file_uuid: &str) -> anyhow::Result<Vec<Citation>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            "SELECT * FROM citations WHERE citing_file_uuid = ?1 ORDER BY id"
        )?;
        
        let citations: Vec<Citation> = stmt
            .query_map(params![file_uuid], |row| {
                let type_str: String = row.get("citation_type")?;
                let citation_type = match type_str.as_str() {
                    "builds-on" => CitationType::BuildsOn,
                    "responds-to" => CitationType::RespondsTo,
                    "contradicts" => CitationType::Contradicts,
                    "replicates" => CitationType::Replicates,
                    "uses-method" => CitationType::UsesMethod,
                    "influenced-by" => CitationType::InfluencedBy,
                    _ => CitationType::Reference,
                };
                
                Ok(Citation {
                    id: row.get("id")?,
                    citing_file_uuid: row.get("citing_file_uuid")?,
                    cited_file_uuid: row.get("cited_file_uuid")?,
                    cited_hash: row.get("cited_hash")?,
                    external_reference: row.get("external_reference")?,
                    citation_type,
                    context_note: row.get("context_note")?,
                    timestamp_ref: row.get("timestamp_ref")?,
                    created_at: row.get("created_at")?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(citations)
    }
    
    /// Get citations to a file (who cites this work?)
    pub fn get_citations_to(&self, file_uuid: &str) -> anyhow::Result<Vec<Citation>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            "SELECT * FROM citations WHERE cited_file_uuid = ?1 ORDER BY created_at DESC"
        )?;
        
        let citations: Vec<Citation> = stmt
            .query_map(params![file_uuid], |row| {
                let type_str: String = row.get("citation_type")?;
                let citation_type = match type_str.as_str() {
                    "builds-on" => CitationType::BuildsOn,
                    "responds-to" => CitationType::RespondsTo,
                    "contradicts" => CitationType::Contradicts,
                    "replicates" => CitationType::Replicates,
                    "uses-method" => CitationType::UsesMethod,
                    "influenced-by" => CitationType::InfluencedBy,
                    _ => CitationType::Reference,
                };
                
                Ok(Citation {
                    id: row.get("id")?,
                    citing_file_uuid: row.get("citing_file_uuid")?,
                    cited_file_uuid: row.get("cited_file_uuid")?,
                    cited_hash: row.get("cited_hash")?,
                    external_reference: row.get("external_reference")?,
                    citation_type,
                    context_note: row.get("context_note")?,
                    timestamp_ref: row.get("timestamp_ref")?,
                    created_at: row.get("created_at")?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(citations)
    }
    
    // =========================================================================
    // Visibility & Time
    // =========================================================================
    
    /// Set visibility state
    pub fn set_visibility_state(&self, file_uuid: &str, status: VisibilityStatus, reason: Option<&str>) -> anyhow::Result<()> {
        let conn = self.conn();
        
        conn.execute(
            r#"
            INSERT INTO visibility_state (file_uuid, status, reason)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(file_uuid) DO UPDATE SET
                status = ?2,
                reason = ?3,
                last_engagement = CASE WHEN ?2 = 'resurfaced' THEN datetime('now') ELSE last_engagement END,
                resurfaced_count = CASE WHEN ?2 = 'resurfaced' THEN resurfaced_count + 1 ELSE resurfaced_count END
            "#,
            params![file_uuid, status.as_str(), reason],
        )?;
        
        Ok(())
    }
    
    /// Get files that should be marked dormant (no engagement for 90 days)
    pub fn get_dormant_candidates(&self, days: i32) -> anyhow::Result<Vec<String>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT f.uuid FROM files f
            LEFT JOIN visibility_state vs ON f.uuid = vs.file_uuid
            WHERE (vs.status IS NULL OR vs.status = 'active')
            AND f.updated_at < datetime('now', ?1 || ' days')
            "#
        )?;
        
        let days_ago = format!("-{}", days);
        let uuids: Vec<String> = stmt
            .query_map(params![days_ago], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(uuids)
    }
    
    // =========================================================================
    // Content Contexts
    // =========================================================================
    
    /// Add context tag to file
    pub fn add_content_context(&self, file_uuid: &str, context_tag: &str, assigned_by: Option<i64>, assignment_type: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        
        conn.execute(
            r#"
            INSERT OR IGNORE INTO content_contexts (file_uuid, context_tag, assigned_by, assignment_type)
            VALUES (?1, ?2, ?3, ?4)
            "#,
            params![file_uuid, context_tag, assigned_by, assignment_type],
        )?;
        
        Ok(())
    }
    
    /// Get contexts for a file
    pub fn get_content_contexts(&self, file_uuid: &str) -> anyhow::Result<Vec<ContentContext>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            "SELECT * FROM content_contexts WHERE file_uuid = ?1"
        )?;
        
        let contexts: Vec<ContentContext> = stmt
            .query_map(params![file_uuid], |row| {
                Ok(ContentContext {
                    file_uuid: row.get("file_uuid")?,
                    context_tag: row.get("context_tag")?,
                    assigned_by: row.get("assigned_by")?,
                    assignment_type: row.get("assignment_type")?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(contexts)
    }
    
    // =========================================================================
    // Procedural Moderation
    // =========================================================================
    
    /// Add moderation reasoning (required for all moderation actions)
    pub fn add_moderation_reasoning(
        &self,
        moderation_log_id: i64,
        policy_cited: &str,
        reasoning: &str,
        appealable: bool,
        appeal_deadline_days: Option<i32>,
    ) -> anyhow::Result<()> {
        let conn = self.conn();
        
        let appeal_deadline = appeal_deadline_days.map(|days| format!("datetime('now', '+{} days')", days));
        
        if let Some(deadline) = appeal_deadline {
            conn.execute(
                &format!(
                    r#"
                    INSERT INTO moderation_reasoning (
                        moderation_log_id, policy_cited, reasoning, appealable, appeal_deadline
                    ) VALUES (?1, ?2, ?3, ?4, {})
                    "#,
                    deadline
                ),
                params![moderation_log_id, policy_cited, reasoning, appealable as i32],
            )?;
        } else {
            conn.execute(
                r#"
                INSERT INTO moderation_reasoning (
                    moderation_log_id, policy_cited, reasoning, appealable
                ) VALUES (?1, ?2, ?3, ?4)
                "#,
                params![moderation_log_id, policy_cited, reasoning, appealable as i32],
            )?;
        }
        
        Ok(())
    }
    
    /// Get moderation reasoning for an action
    pub fn get_moderation_reasoning(&self, moderation_log_id: i64) -> anyhow::Result<Option<ModerationReasoning>> {
        let conn = self.conn();
        
        let result = conn.query_row(
            "SELECT * FROM moderation_reasoning WHERE moderation_log_id = ?1",
            params![moderation_log_id],
            |row| {
                Ok(ModerationReasoning {
                    moderation_log_id: row.get("moderation_log_id")?,
                    policy_cited: row.get("policy_cited")?,
                    reasoning: row.get("reasoning")?,
                    author_notified: row.get::<_, i32>("author_notified")? != 0,
                    appealable: row.get::<_, i32>("appealable")? != 0,
                    appeal_deadline: row.get("appeal_deadline")?,
                })
            },
        );
        
        match result {
            Ok(r) => Ok(Some(r)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}
