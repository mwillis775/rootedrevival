//! Moderation system for content reporting and user management
//!
//! Provides:
//! - Content reporting (files, reviews, users)
//! - User bans/suspensions
//! - Content flagging
//! - Moderation queue

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// Report reason categories
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ReportReason {
    Spam,
    Harassment,
    Plagiarism,
    Misinformation,
    CopyrightViolation,
    InappropriateContent,
    Other,
}

impl ReportReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Spam => "spam",
            Self::Harassment => "harassment",
            Self::Plagiarism => "plagiarism",
            Self::Misinformation => "misinformation",
            Self::CopyrightViolation => "copyright",
            Self::InappropriateContent => "inappropriate",
            Self::Other => "other",
        }
    }
}

/// Report target type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ReportTarget {
    File(String),
    User(i64),
    Review(i64),
    Comment(i64),
}

/// Report status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ReportStatus {
    Pending,
    UnderReview,
    Resolved,
    Dismissed,
}

impl ReportStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::UnderReview => "under_review",
            Self::Resolved => "resolved",
            Self::Dismissed => "dismissed",
        }
    }
}

/// Ban type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BanType {
    Temporary,
    Permanent,
    Suspended,
    ShadowBan,
}

impl BanType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Temporary => "temporary",
            Self::Permanent => "permanent",
            Self::Suspended => "suspended",
            Self::ShadowBan => "shadow",
        }
    }
}

/// A content report
#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub id: i64,
    pub reporter_id: i64,
    pub target_type: String,
    pub target_id: String,
    pub reason: String,
    pub description: Option<String>,
    pub status: String,
    pub reviewed_by: Option<i64>,
    pub notes: Option<String>,
    pub created_at: String,
}

/// User ban record
#[derive(Debug, Clone, Serialize)]
pub struct UserBan {
    pub id: i64,
    pub user_id: i64,
    pub ban_type: String,
    pub reason: String,
    pub banned_by: i64,
    pub expires_at: Option<String>,
    pub created_at: String,
}

/// Content flag
#[derive(Debug, Clone, Serialize)]
pub struct ContentFlag {
    pub id: i64,
    pub file_uuid: String,
    pub flag_type: String,
    pub flagged_by: i64,
    pub note: Option<String>,
    pub created_at: String,
}

/// Moderation action log entry
#[derive(Debug, Clone, Serialize)]
pub struct ModerationAction {
    pub id: i64,
    pub moderator_id: i64,
    pub action: String,
    pub target_type: String,
    pub target_id: String,
    pub details: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Database Operations
// ============================================================================

/// Create a new report
pub fn create_report(
    conn: &Connection,
    reporter_id: i64,
    target: ReportTarget,
    reason: ReportReason,
    description: Option<&str>,
) -> anyhow::Result<i64> {
    let (target_type, target_id) = match target {
        ReportTarget::File(uuid) => ("file", uuid),
        ReportTarget::User(id) => ("user", id.to_string()),
        ReportTarget::Review(id) => ("review", id.to_string()),
        ReportTarget::Comment(id) => ("comment", id.to_string()),
    };
    
    conn.execute(
        "INSERT INTO reports (reporter_id, target_type, target_id, reason, description) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![reporter_id, target_type, target_id, reason.as_str(), description],
    )?;
    
    Ok(conn.last_insert_rowid())
}

/// Get pending reports
pub fn get_pending_reports(conn: &Connection, limit: i64) -> anyhow::Result<Vec<Report>> {
    let mut stmt = conn.prepare(
        "SELECT id, reporter_id, target_type, target_id, reason, description, status, reviewed_by, notes, created_at 
         FROM reports WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?1"
    )?;
    
    let reports = stmt.query_map(params![limit], |row| {
        Ok(Report {
            id: row.get(0)?,
            reporter_id: row.get(1)?,
            target_type: row.get(2)?,
            target_id: row.get(3)?,
            reason: row.get(4)?,
            description: row.get(5).ok(),
            status: row.get(6)?,
            reviewed_by: row.get(7).ok(),
            notes: row.get(8).ok(),
            created_at: row.get(9)?,
        })
    })?;
    
    reports.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Update report status
pub fn update_report_status(
    conn: &Connection,
    report_id: i64,
    status: ReportStatus,
    reviewed_by: Option<i64>,
    notes: Option<&str>,
) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE reports SET status = ?1, reviewed_by = ?2, notes = ?3, reviewed_at = datetime('now') WHERE id = ?4",
        params![status.as_str(), reviewed_by, notes, report_id],
    )?;
    
    // Log the action
    if let Some(mod_id) = reviewed_by {
        log_moderation_action(conn, mod_id, &format!("report_{}", status.as_str()), "report", &report_id.to_string(), notes)?;
    }
    
    Ok(())
}

/// Ban a user
pub fn ban_user(
    conn: &Connection,
    user_id: i64,
    ban_type: BanType,
    reason: &str,
    banned_by: i64,
    expires_at: Option<&str>,
) -> anyhow::Result<i64> {
    conn.execute(
        "INSERT INTO user_bans (user_id, ban_type, reason, banned_by, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![user_id, ban_type.as_str(), reason, banned_by, expires_at],
    )?;
    
    log_moderation_action(conn, banned_by, "ban_user", "user", &user_id.to_string(), Some(reason))?;
    
    Ok(conn.last_insert_rowid())
}

/// Check if user is banned
pub fn is_user_banned(conn: &Connection, user_id: i64) -> anyhow::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM user_bans WHERE user_id = ?1 AND (expires_at IS NULL OR expires_at > datetime('now'))",
        params![user_id],
        |row| row.get(0),
    )?;
    
    Ok(count > 0)
}

/// Unban a user
pub fn unban_user(conn: &Connection, user_id: i64) -> anyhow::Result<()> {
    conn.execute(
        "DELETE FROM user_bans WHERE user_id = ?1",
        params![user_id],
    )?;
    Ok(())
}

/// Get active bans
pub fn get_active_bans(conn: &Connection) -> anyhow::Result<Vec<UserBan>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, ban_type, reason, banned_by, expires_at, created_at 
         FROM user_bans WHERE expires_at IS NULL OR expires_at > datetime('now') ORDER BY created_at DESC"
    )?;
    
    let bans = stmt.query_map([], |row| {
        Ok(UserBan {
            id: row.get(0)?,
            user_id: row.get(1)?,
            ban_type: row.get(2)?,
            reason: row.get(3)?,
            banned_by: row.get(4)?,
            expires_at: row.get(5).ok(),
            created_at: row.get(6)?,
        })
    })?;
    
    bans.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Flag content
pub fn flag_content(
    conn: &Connection,
    file_uuid: &str,
    flag_type: &str,
    flagged_by: i64,
    note: Option<&str>,
) -> anyhow::Result<i64> {
    conn.execute(
        "INSERT OR REPLACE INTO content_flags (file_uuid, flag_type, flagged_by, note) VALUES (?1, ?2, ?3, ?4)",
        params![file_uuid, flag_type, flagged_by, note],
    )?;
    
    log_moderation_action(conn, flagged_by, "flag_content", "file", file_uuid, note)?;
    
    Ok(conn.last_insert_rowid())
}

/// Remove a flag
pub fn remove_flag(conn: &Connection, file_uuid: &str, flag_type: &str) -> anyhow::Result<()> {
    conn.execute(
        "DELETE FROM content_flags WHERE file_uuid = ?1 AND flag_type = ?2",
        params![file_uuid, flag_type],
    )?;
    Ok(())
}

/// Get flagged content
pub fn get_flagged_content(conn: &Connection) -> anyhow::Result<Vec<ContentFlag>> {
    let mut stmt = conn.prepare(
        "SELECT id, file_uuid, flag_type, flagged_by, note, created_at FROM content_flags ORDER BY created_at DESC"
    )?;
    
    let flags = stmt.query_map([], |row| {
        Ok(ContentFlag {
            id: row.get(0)?,
            file_uuid: row.get(1)?,
            flag_type: row.get(2)?,
            flagged_by: row.get(3)?,
            note: row.get(4).ok(),
            created_at: row.get(5)?,
        })
    })?;
    
    flags.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Log a moderation action
pub fn log_moderation_action(
    conn: &Connection,
    moderator_id: i64,
    action: &str,
    target_type: &str,
    target_id: &str,
    details: Option<&str>,
) -> anyhow::Result<i64> {
    conn.execute(
        "INSERT INTO moderation_log (moderator_id, action, target_type, target_id, details) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![moderator_id, action, target_type, target_id, details],
    )?;
    
    Ok(conn.last_insert_rowid())
}

/// Get moderation log
pub fn get_moderation_log(conn: &Connection, limit: i64) -> anyhow::Result<Vec<ModerationAction>> {
    let mut stmt = conn.prepare(
        "SELECT id, moderator_id, action, target_type, target_id, details, created_at 
         FROM moderation_log ORDER BY created_at DESC LIMIT ?1"
    )?;
    
    let actions = stmt.query_map(params![limit], |row| {
        Ok(ModerationAction {
            id: row.get(0)?,
            moderator_id: row.get(1)?,
            action: row.get(2)?,
            target_type: row.get(3)?,
            target_id: row.get(4)?,
            details: row.get(5).ok(),
            created_at: row.get(6)?,
        })
    })?;
    
    actions.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}
