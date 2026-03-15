//! Review management

use rusqlite::params;

use crate::db::Database;
use crate::models::{Review, NewReview, ReviewStats};

impl Database {
    /// Create a new review
    pub fn create_review(&self, new_review: NewReview) -> anyhow::Result<Review> {
        let conn = self.conn();
        
        conn.execute(
            r#"
            INSERT INTO reviews (
                file_id, reviewer_id, rating, content,
                methodology_score, clarity_score, reproducibility_score, significance_score
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                new_review.file_id,
                new_review.reviewer_id,
                new_review.rating,
                new_review.content,
                new_review.methodology_score,
                new_review.clarity_score,
                new_review.reproducibility_score,
                new_review.significance_score,
            ],
        )?;
        
        let review_id = conn.last_insert_rowid();
        
        // Update reviewer stats
        conn.execute(
            "UPDATE users SET total_reviews = total_reviews + 1 WHERE id = ?1",
            params![new_review.reviewer_id],
        )?;
        
        drop(conn);
        self.get_review_by_id(review_id)
    }
    
    /// Get review by ID
    pub fn get_review_by_id(&self, id: i64) -> anyhow::Result<Review> {
        let conn = self.conn();
        
        let review = conn.query_row(
            r#"
            SELECT r.*, u.username as reviewer_username, u.display_name as reviewer_name
            FROM reviews r
            JOIN users u ON r.reviewer_id = u.id
            WHERE r.id = ?1
            "#,
            params![id],
            |row| Review::from_row(row),
        )?;
        
        Ok(review)
    }
    
    /// Get reviews for a file
    pub fn get_reviews_for_file(&self, file_id: i64, limit: u32, offset: u32) -> anyhow::Result<Vec<Review>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT r.*, u.username as reviewer_username, u.display_name as reviewer_name
            FROM reviews r
            JOIN users u ON r.reviewer_id = u.id
            WHERE r.file_id = ?1
            ORDER BY r.helpful_count DESC, r.created_at DESC
            LIMIT ?2 OFFSET ?3
            "#,
        )?;
        
        let reviews: Vec<Review> = stmt
            .query_map(params![file_id, limit, offset], |row| Review::from_row(row))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(reviews)
    }
    
    /// Check if user has already reviewed a file
    pub fn has_user_reviewed(&self, file_id: i64, user_id: i64) -> anyhow::Result<bool> {
        let conn = self.conn();
        
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM reviews WHERE file_id = ?1 AND reviewer_id = ?2",
            params![file_id, user_id],
            |row| row.get(0),
        )?;
        
        Ok(count > 0)
    }
    
    /// Vote on a review
    pub fn vote_on_review(&self, review_id: i64, user_id: i64, helpful: bool) -> anyhow::Result<()> {
        let conn = self.conn();
        
        // Insert vote
        conn.execute(
            "INSERT INTO review_votes (review_id, user_id, helpful) VALUES (?1, ?2, ?3)",
            params![review_id, user_id, helpful as i64],
        )?;
        
        // Update review counts
        if helpful {
            conn.execute(
                "UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = ?1",
                params![review_id],
            )?;
        } else {
            conn.execute(
                "UPDATE reviews SET unhelpful_count = unhelpful_count + 1 WHERE id = ?1",
                params![review_id],
            )?;
        }
        
        Ok(())
    }
    
    /// Get review statistics for a file
    pub fn get_review_stats(&self, file_id: i64) -> anyhow::Result<ReviewStats> {
        let conn = self.conn();
        
        let stats = conn.query_row(
            r#"
            SELECT 
                COUNT(*) as count,
                AVG(rating) as avg_rating,
                AVG(methodology_score) as avg_methodology,
                AVG(clarity_score) as avg_clarity,
                AVG(reproducibility_score) as avg_reproducibility,
                AVG(significance_score) as avg_significance
            FROM reviews
            WHERE file_id = ?1
            "#,
            params![file_id],
            |row| {
                Ok(ReviewStats {
                    count: row.get(0)?,
                    avg_rating: row.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                    avg_methodology: row.get(2)?,
                    avg_clarity: row.get(3)?,
                    avg_reproducibility: row.get(4)?,
                    avg_significance: row.get(5)?,
                })
            },
        )?;
        
        Ok(stats)
    }
    
    /// Get recent reviews across all files
    pub fn get_recent_reviews(&self, limit: u32) -> anyhow::Result<Vec<Review>> {
        let conn = self.conn();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT r.*, u.username as reviewer_username, u.display_name as reviewer_name
            FROM reviews r
            JOIN users u ON r.reviewer_id = u.id
            JOIN files f ON r.file_id = f.id
            WHERE f.is_public = 1
            ORDER BY r.created_at DESC
            LIMIT ?1
            "#,
        )?;
        
        let reviews: Vec<Review> = stmt
            .query_map(params![limit], |row| Review::from_row(row))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(reviews)
    }
    
    /// Delete a review
    pub fn delete_review(&self, id: i64, user_id: i64) -> anyhow::Result<bool> {
        let conn = self.conn();
        
        let rows = conn.execute(
            "DELETE FROM reviews WHERE id = ?1 AND reviewer_id = ?2",
            params![id, user_id],
        )?;
        
        Ok(rows > 0)
    }
}
