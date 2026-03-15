//! User management

use chrono::{DateTime, Duration, Utc};
use rusqlite::params;
use argon2::{self, Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::password_hash::SaltString;
use rand::rngs::OsRng;

use crate::db::Database;
use crate::models::{User, Session, NewUser};

impl Database {
    /// Create a new user with GrabNet identity
    pub fn create_user(&self, new_user: NewUser) -> anyhow::Result<User> {
        let conn = self.conn();
        
        // Hash password
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(new_user.password.as_bytes(), &salt)
            .map_err(|e| anyhow::anyhow!("Password hashing failed: {}", e))?
            .to_string();
        
        conn.execute(
            r#"
            INSERT INTO users (username, email, password_hash, public_key, display_name)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            params![
                new_user.username,
                new_user.email,
                password_hash,
                new_user.public_key,
                new_user.display_name.as_ref().unwrap_or(&new_user.username),
            ],
        )?;
        
        let user_id = conn.last_insert_rowid();
        drop(conn);
        self.get_user_by_id(user_id)
    }
    
    /// Get user by ID
    pub fn get_user_by_id(&self, id: i64) -> anyhow::Result<User> {
        let conn = self.conn();
        
        let user = conn.query_row(
            "SELECT * FROM users WHERE id = ?1",
            params![id],
            |row| User::from_row(row),
        )?;
        
        Ok(user)
    }
    
    /// Get user by username
    pub fn get_user_by_username(&self, username: &str) -> anyhow::Result<Option<User>> {
        let conn = self.conn();
        
        let result = conn.query_row(
            "SELECT * FROM users WHERE username = ?1",
            params![username],
            |row| User::from_row(row),
        );
        
        match result {
            Ok(user) => Ok(Some(user)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    
    /// Get user by public key
    pub fn get_user_by_public_key(&self, public_key: &str) -> anyhow::Result<Option<User>> {
        let conn = self.conn();
        
        let result = conn.query_row(
            "SELECT * FROM users WHERE public_key = ?1",
            params![public_key],
            |row| User::from_row(row),
        );
        
        match result {
            Ok(user) => Ok(Some(user)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    
    /// Authenticate user with password
    pub fn authenticate_user(&self, username: &str, password: &str) -> anyhow::Result<Option<User>> {
        let conn = self.conn();
        
        let result: Result<(i64, String), _> = conn.query_row(
            "SELECT id, password_hash FROM users WHERE username = ?1 OR email = ?1",
            params![username],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        
        match result {
            Ok((id, hash)) => {
                let parsed_hash = PasswordHash::new(&hash)
                    .map_err(|e| anyhow::anyhow!("Invalid password hash: {}", e))?;
                if Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_ok() {
                    // Update last login
                    conn.execute(
                        "UPDATE users SET last_login = datetime('now') WHERE id = ?1",
                        params![id],
                    )?;
                    drop(conn);
                    Ok(Some(self.get_user_by_id(id)?))
                } else {
                    Ok(None)
                }
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    
    /// Create a session for a user
    pub fn create_session(&self, user_id: i64, ip: Option<&str>, user_agent: Option<&str>) -> anyhow::Result<Session> {
        let conn = self.conn();
        
        // Generate secure token
        let mut rng = OsRng;
        let token_bytes: [u8; 32] = rand::Rng::gen(&mut rng);
        let token = hex::encode(token_bytes);
        
        // Session expires in 30 days
        let expires_at = Utc::now() + Duration::days(30);
        
        conn.execute(
            r#"
            INSERT INTO sessions (user_id, token, expires_at, ip_address, user_agent)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            params![
                user_id,
                token,
                expires_at.to_rfc3339(),
                ip,
                user_agent,
            ],
        )?;
        
        let session_id = conn.last_insert_rowid();
        
        Ok(Session {
            id: session_id,
            user_id,
            token,
            expires_at,
        })
    }
    
    /// Validate session token
    pub fn validate_session(&self, token: &str) -> anyhow::Result<Option<(Session, User)>> {
        let conn = self.conn();
        
        let result: Result<(i64, i64, String), _> = conn.query_row(
            r#"
            SELECT id, user_id, expires_at FROM sessions 
            WHERE token = ?1 AND expires_at > datetime('now')
            "#,
            params![token],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        );
        
        match result {
            Ok((id, user_id, expires_str)) => {
                let expires_at = DateTime::parse_from_rfc3339(&expires_str)?
                    .with_timezone(&Utc);
                
                let session = Session {
                    id,
                    user_id,
                    token: token.to_string(),
                    expires_at,
                };
                
                drop(conn);
                let user = self.get_user_by_id(user_id)?;
                
                Ok(Some((session, user)))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    
    /// Delete a session (logout)
    pub fn delete_session(&self, token: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM sessions WHERE token = ?1", params![token])?;
        Ok(())
    }
    
    /// Update user profile
    pub fn update_user(&self, id: i64, display_name: Option<&str>, bio: Option<&str>, affiliation: Option<&str>) -> anyhow::Result<()> {
        let conn = self.conn();
        
        if let Some(name) = display_name {
            conn.execute(
                "UPDATE users SET display_name = ?1 WHERE id = ?2",
                params![name, id],
            )?;
        }
        
        if let Some(bio_text) = bio {
            conn.execute(
                "UPDATE users SET bio = ?1 WHERE id = ?2",
                params![bio_text, id],
            )?;
        }
        
        if let Some(affil) = affiliation {
            conn.execute(
                "UPDATE users SET affiliation = ?1 WHERE id = ?2",
                params![affil, id],
            )?;
        }
        
        Ok(())
    }
    
    /// Cleanup expired sessions
    pub fn cleanup_sessions(&self) -> anyhow::Result<u64> {
        let conn = self.conn();
        let count = conn.execute(
            "DELETE FROM sessions WHERE expires_at < datetime('now')",
            [],
        )?;
        Ok(count as u64)
    }
    
    // =========================================================================
    // Admin Methods
    // =========================================================================
    
    /// Get admin dashboard statistics
    pub fn get_admin_stats(&self) -> anyhow::Result<serde_json::Value> {
        let conn = self.conn();
        
        let total_users: i64 = conn.query_row(
            "SELECT COUNT(*) FROM users", [], |row| row.get(0)
        )?;
        
        let total_files: i64 = conn.query_row(
            "SELECT COUNT(*) FROM files", [], |row| row.get(0)
        )?;
        
        let total_reviews: i64 = conn.query_row(
            "SELECT COUNT(*) FROM reviews", [], |row| row.get(0)
        )?;
        
        let total_storage_bytes: i64 = conn.query_row(
            "SELECT COALESCE(SUM(size), 0) FROM files", [], |row| row.get(0)
        )?;
        
        let active_sessions: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE expires_at > datetime('now')", [], |row| row.get(0)
        )?;
        
        Ok(serde_json::json!({
            "total_users": total_users,
            "total_files": total_files,
            "total_reviews": total_reviews,
            "total_storage_bytes": total_storage_bytes,
            "active_sessions": active_sessions,
        }))
    }
    
    /// List users for admin (with pagination)
    pub fn list_users_admin(&self, offset: i64, limit: i64, search: Option<&str>) -> anyhow::Result<(Vec<serde_json::Value>, i64)> {
        let conn = self.conn();
        
        // Build query based on search
        let (query, count_query) = if search.is_some() {
            (
                r#"
                SELECT id, username, email, display_name, is_admin, is_moderator, is_verified,
                       total_uploads, total_reviews, reputation_score, created_at, last_login
                FROM users
                WHERE username LIKE ?1 OR email LIKE ?1
                ORDER BY created_at DESC
                LIMIT ?2 OFFSET ?3
                "#,
                "SELECT COUNT(*) FROM users WHERE username LIKE ?1 OR email LIKE ?1"
            )
        } else {
            (
                r#"
                SELECT id, username, email, display_name, is_admin, is_moderator, is_verified,
                       total_uploads, total_reviews, reputation_score, created_at, last_login
                FROM users
                ORDER BY created_at DESC
                LIMIT ?1 OFFSET ?2
                "#,
                "SELECT COUNT(*) FROM users"
            )
        };
        
        let search_pattern = search.map(|s| format!("%{}%", s));
        
        let total: i64 = if let Some(ref pattern) = search_pattern {
            conn.query_row(count_query, [pattern], |row| row.get(0))?
        } else {
            conn.query_row(count_query, [], |row| row.get(0))?
        };
        
        let mut stmt = conn.prepare(query)?;
        let mut users = Vec::new();
        
        let rows = if let Some(ref pattern) = search_pattern {
            stmt.query(rusqlite::params![pattern, limit, offset])?
        } else {
            stmt.query(rusqlite::params![limit, offset])?
        };
        
        let mut rows = rows;
        while let Some(row) = rows.next()? {
            users.push(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "username": row.get::<_, String>(1)?,
                "email": row.get::<_, Option<String>>(2)?,
                "display_name": row.get::<_, Option<String>>(3)?,
                "is_admin": row.get::<_, i32>(4)? != 0,
                "is_moderator": row.get::<_, i32>(5)? != 0,
                "is_verified": row.get::<_, i32>(6)? != 0,
                "total_uploads": row.get::<_, i64>(7)?,
                "total_reviews": row.get::<_, i64>(8)?,
                "reputation_score": row.get::<_, i64>(9)?,
                "created_at": row.get::<_, String>(10)?,
                "last_login": row.get::<_, Option<String>>(11)?,
            }));
        }
        
        Ok((users, total))
    }
    
    /// Update user role (admin/moderator/verified status)
    pub fn update_user_role(
        &self, 
        user_id: i64, 
        is_admin: Option<bool>, 
        is_moderator: Option<bool>,
        is_verified: Option<bool>
    ) -> anyhow::Result<()> {
        let conn = self.conn();
        
        if let Some(admin) = is_admin {
            conn.execute(
                "UPDATE users SET is_admin = ?1 WHERE id = ?2",
                rusqlite::params![admin as i32, user_id],
            )?;
        }
        
        if let Some(mod_status) = is_moderator {
            conn.execute(
                "UPDATE users SET is_moderator = ?1 WHERE id = ?2",
                rusqlite::params![mod_status as i32, user_id],
            )?;
        }
        
        if let Some(verified) = is_verified {
            conn.execute(
                "UPDATE users SET is_verified = ?1 WHERE id = ?2",
                rusqlite::params![verified as i32, user_id],
            )?;
        }
        
        Ok(())
    }
    
    /// Delete a user and all their data
    pub fn delete_user(&self, user_id: i64) -> anyhow::Result<()> {
        let conn = self.conn();
        
        // Foreign keys with ON DELETE CASCADE handle files, reviews, sessions, etc.
        conn.execute("DELETE FROM users WHERE id = ?1", rusqlite::params![user_id])?;
        
        Ok(())
    }
    
    // =========================================================================
    // Password Reset Methods
    // =========================================================================
    
    /// Get user by email
    pub fn get_user_by_email(&self, email: &str) -> anyhow::Result<Option<User>> {
        let conn = self.conn();
        
        let result = conn.query_row(
            "SELECT * FROM users WHERE email = ?1",
            params![email],
            |row| User::from_row(row),
        );
        
        match result {
            Ok(user) => Ok(Some(user)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    
    /// Store password reset token
    pub fn store_reset_token(&self, user_id: i64, token: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        
        // Token expires in 1 hour
        let expires_at = Utc::now() + Duration::hours(1);
        
        // Delete any existing reset tokens for this user
        conn.execute(
            "DELETE FROM password_reset_tokens WHERE user_id = ?1",
            params![user_id],
        )?;
        
        conn.execute(
            r#"
            INSERT INTO password_reset_tokens (user_id, token, expires_at)
            VALUES (?1, ?2, ?3)
            "#,
            params![user_id, token, expires_at.to_rfc3339()],
        )?;
        
        Ok(())
    }
    
    /// Validate password reset token
    pub fn validate_reset_token(&self, token: &str) -> anyhow::Result<Option<i64>> {
        let conn = self.conn();
        
        let result = conn.query_row(
            r#"
            SELECT user_id FROM password_reset_tokens 
            WHERE token = ?1 AND expires_at > datetime('now')
            "#,
            params![token],
            |row| row.get(0),
        );
        
        match result {
            Ok(user_id) => Ok(Some(user_id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    
    /// Delete password reset token
    pub fn delete_reset_token(&self, token: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM password_reset_tokens WHERE token = ?1", params![token])?;
        Ok(())
    }
    
    /// Update user password
    pub fn update_password(&self, user_id: i64, new_password: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        
        // Hash new password
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(new_password.as_bytes(), &salt)
            .map_err(|e| anyhow::anyhow!("Password hashing failed: {}", e))?
            .to_string();
        
        conn.execute(
            "UPDATE users SET password_hash = ?1 WHERE id = ?2",
            params![password_hash, user_id],
        )?;
        
        Ok(())
    }
    
    /// Delete all sessions for a user
    pub fn delete_all_user_sessions(&self, user_id: i64) -> anyhow::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM sessions WHERE user_id = ?1", params![user_id])?;
        Ok(())
    }
    
    // =========================================================================
    // Email Verification Methods
    // =========================================================================
    
    /// Store email verification token
    pub fn store_email_token(&self, user_id: i64, token: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        
        // Token expires in 24 hours
        let expires_at = Utc::now() + Duration::hours(24);
        
        // Delete any existing verification tokens for this user
        conn.execute(
            "DELETE FROM email_verification_tokens WHERE user_id = ?1",
            params![user_id],
        )?;
        
        conn.execute(
            r#"
            INSERT INTO email_verification_tokens (user_id, token, expires_at)
            VALUES (?1, ?2, ?3)
            "#,
            params![user_id, token, expires_at.to_rfc3339()],
        )?;
        
        Ok(())
    }
    
    /// Validate email verification token
    pub fn validate_email_token(&self, token: &str) -> anyhow::Result<Option<i64>> {
        let conn = self.conn();
        
        let result = conn.query_row(
            r#"
            SELECT user_id FROM email_verification_tokens 
            WHERE token = ?1 AND expires_at > datetime('now')
            "#,
            params![token],
            |row| row.get(0),
        );
        
        match result {
            Ok(user_id) => Ok(Some(user_id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    
    /// Delete email verification token
    pub fn delete_email_token(&self, token: &str) -> anyhow::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM email_verification_tokens WHERE token = ?1", params![token])?;
        Ok(())
    }
    
    /// Mark user email as verified
    pub fn verify_user_email(&self, user_id: i64) -> anyhow::Result<()> {
        let conn = self.conn();
        conn.execute(
            "UPDATE users SET email_verified = 1 WHERE id = ?1",
            params![user_id],
        )?;
        Ok(())
    }
}
