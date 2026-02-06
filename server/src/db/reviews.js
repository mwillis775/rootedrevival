/**
 * OpenSource Scholar - Open Peer Review Database Module
 * 
 * Anyone can review scientific content. All reviews are public.
 * Cooler heads will prevail through community validation.
 */

const { getDb } = require('./index');
const crypto = require('crypto');

/**
 * Generate a UUID
 */
function generateUuid() {
    return crypto.randomUUID();
}

/**
 * Submit a peer review
 */
function createReview({
    fileId,
    reviewerId,
    summary,
    methodologyScore,
    originalityScore,
    clarityScore,
    significanceScore,
    overallScore,
    detailedReview,
    strengths,
    weaknesses,
    suggestions
}) {
    const db = getDb();
    const uuid = generateUuid();
    
    // Validate scores (1-5)
    const validateScore = (s) => s ? Math.min(5, Math.max(1, parseInt(s))) : null;
    
    const result = db.prepare(`
        INSERT INTO peer_reviews (
            uuid, file_id, reviewer_id, summary,
            methodology_score, originality_score, clarity_score,
            significance_score, overall_score,
            detailed_review, strengths, weaknesses, suggestions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        uuid, fileId, reviewerId, summary,
        validateScore(methodologyScore),
        validateScore(originalityScore),
        validateScore(clarityScore),
        validateScore(significanceScore),
        validateScore(overallScore),
        detailedReview, strengths, weaknesses, suggestions
    );
    
    return { uuid, id: result.lastInsertRowid };
}

/**
 * Get review by UUID
 */
function getReviewByUuid(uuid) {
    const db = getDb();
    
    const review = db.prepare(`
        SELECT pr.*, 
               u.username as reviewer_username,
               u.display_name as reviewer_name,
               uf.title as file_title,
               uf.uuid as file_uuid,
               author.username as author_username
        FROM peer_reviews pr
        JOIN users u ON pr.reviewer_id = u.id
        JOIN user_files uf ON pr.file_id = uf.id
        JOIN users author ON uf.user_id = author.id
        WHERE pr.uuid = ?
    `).get(uuid);
    
    if (review) {
        // Get author response if any
        review.response = db.prepare(`
            SELECT rr.*, u.username, u.display_name
            FROM review_responses rr
            JOIN users u ON rr.author_id = u.id
            WHERE rr.review_id = ?
            ORDER BY rr.created_at DESC
            LIMIT 1
        `).get(review.id);
    }
    
    return review;
}

/**
 * Get reviews for a file
 */
function getReviewsForFile(fileId) {
    const db = getDb();
    
    const reviews = db.prepare(`
        SELECT pr.*, 
               u.username as reviewer_username,
               u.display_name as reviewer_name
        FROM peer_reviews pr
        JOIN users u ON pr.reviewer_id = u.id
        WHERE pr.file_id = ?
        ORDER BY pr.helpful_count DESC, pr.created_at DESC
    `).all(fileId);
    
    const getResponse = db.prepare(`
        SELECT rr.*, u.username, u.display_name
        FROM review_responses rr
        JOIN users u ON rr.author_id = u.id
        WHERE rr.review_id = ?
        ORDER BY rr.created_at DESC
        LIMIT 1
    `);
    
    for (const review of reviews) {
        review.response = getResponse.get(review.id);
    }
    
    return reviews;
}

/**
 * Get reviews by a user
 */
function getReviewsByUser(userId, limit = 20, offset = 0) {
    const db = getDb();
    
    return db.prepare(`
        SELECT pr.*, 
               uf.title as file_title,
               uf.uuid as file_uuid,
               author.username as author_username,
               author.display_name as author_name
        FROM peer_reviews pr
        JOIN user_files uf ON pr.file_id = uf.id
        JOIN users author ON uf.user_id = author.id
        WHERE pr.reviewer_id = ?
        ORDER BY pr.created_at DESC
        LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
}

/**
 * Check if user has already reviewed a file
 */
function hasUserReviewed(userId, fileId) {
    const db = getDb();
    
    const existing = db.prepare(
        'SELECT id FROM peer_reviews WHERE reviewer_id = ? AND file_id = ?'
    ).get(userId, fileId);
    
    return !!existing;
}

/**
 * Vote on a review (helpful / not helpful)
 */
function voteOnReview(userId, reviewId, vote) {
    const db = getDb();
    
    // vote: 1 = helpful, -1 = not helpful
    const normalizedVote = vote > 0 ? 1 : -1;
    
    // Check existing vote
    const existing = db.prepare(
        'SELECT vote FROM review_votes WHERE user_id = ? AND review_id = ?'
    ).get(userId, reviewId);
    
    if (existing) {
        if (existing.vote === normalizedVote) {
            // Remove vote
            db.prepare(
                'DELETE FROM review_votes WHERE user_id = ? AND review_id = ?'
            ).run(userId, reviewId);
            
            // Update counts
            if (normalizedVote === 1) {
                db.prepare(
                    'UPDATE peer_reviews SET helpful_count = helpful_count - 1 WHERE id = ?'
                ).run(reviewId);
            } else {
                db.prepare(
                    'UPDATE peer_reviews SET not_helpful_count = not_helpful_count - 1 WHERE id = ?'
                ).run(reviewId);
            }
            
            return { action: 'removed', vote: null };
        } else {
            // Change vote
            db.prepare(
                'UPDATE review_votes SET vote = ?, created_at = datetime("now") WHERE user_id = ? AND review_id = ?'
            ).run(normalizedVote, userId, reviewId);
            
            // Update counts
            if (normalizedVote === 1) {
                db.prepare(`
                    UPDATE peer_reviews 
                    SET helpful_count = helpful_count + 1,
                        not_helpful_count = not_helpful_count - 1
                    WHERE id = ?
                `).run(reviewId);
            } else {
                db.prepare(`
                    UPDATE peer_reviews 
                    SET helpful_count = helpful_count - 1,
                        not_helpful_count = not_helpful_count + 1
                    WHERE id = ?
                `).run(reviewId);
            }
            
            return { action: 'changed', vote: normalizedVote };
        }
    } else {
        // New vote
        db.prepare(
            'INSERT INTO review_votes (user_id, review_id, vote) VALUES (?, ?, ?)'
        ).run(userId, reviewId, normalizedVote);
        
        // Update counts
        if (normalizedVote === 1) {
            db.prepare(
                'UPDATE peer_reviews SET helpful_count = helpful_count + 1 WHERE id = ?'
            ).run(reviewId);
        } else {
            db.prepare(
                'UPDATE peer_reviews SET not_helpful_count = not_helpful_count + 1 WHERE id = ?'
            ).run(reviewId);
        }
        
        return { action: 'added', vote: normalizedVote };
    }
}

/**
 * Add author response to a review
 */
function addReviewResponse(reviewId, authorId, responseText) {
    const db = getDb();
    
    // Verify the author owns the file being reviewed
    const review = db.prepare(`
        SELECT uf.user_id FROM peer_reviews pr
        JOIN user_files uf ON pr.file_id = uf.id
        WHERE pr.id = ?
    `).get(reviewId);
    
    if (!review || review.user_id !== authorId) {
        throw new Error('Only the content author can respond to reviews');
    }
    
    // Delete any existing response
    db.prepare('DELETE FROM review_responses WHERE review_id = ? AND author_id = ?')
        .run(reviewId, authorId);
    
    db.prepare(`
        INSERT INTO review_responses (review_id, author_id, response_text)
        VALUES (?, ?, ?)
    `).run(reviewId, authorId, responseText);
}

/**
 * Get review statistics for a file
 */
function getReviewStats(fileId) {
    const db = getDb();
    
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total_reviews,
            AVG(methodology_score) as avg_methodology,
            AVG(originality_score) as avg_originality,
            AVG(clarity_score) as avg_clarity,
            AVG(significance_score) as avg_significance,
            AVG(overall_score) as avg_overall
        FROM peer_reviews
        WHERE file_id = ?
    `).get(fileId);
    
    // Get score distribution
    const distribution = db.prepare(`
        SELECT overall_score, COUNT(*) as count
        FROM peer_reviews
        WHERE file_id = ? AND overall_score IS NOT NULL
        GROUP BY overall_score
        ORDER BY overall_score
    `).all(fileId);
    
    stats.scoreDistribution = distribution;
    
    return stats;
}

/**
 * Get top reviewers
 */
function getTopReviewers(limit = 20) {
    const db = getDb();
    
    return db.prepare(`
        SELECT 
            u.id, u.username, u.display_name,
            COUNT(pr.id) as review_count,
            SUM(pr.helpful_count) as total_helpful,
            AVG(pr.helpful_count - pr.not_helpful_count) as avg_helpfulness
        FROM users u
        JOIN peer_reviews pr ON u.id = pr.reviewer_id
        GROUP BY u.id
        HAVING review_count >= 3
        ORDER BY avg_helpfulness DESC, review_count DESC
        LIMIT ?
    `).all(limit);
}

/**
 * Get recent reviews
 */
function getRecentReviews(limit = 20) {
    const db = getDb();
    
    return db.prepare(`
        SELECT pr.*, 
               u.username as reviewer_username,
               u.display_name as reviewer_name,
               uf.title as file_title,
               uf.uuid as file_uuid,
               author.username as author_username
        FROM peer_reviews pr
        JOIN users u ON pr.reviewer_id = u.id
        JOIN user_files uf ON pr.file_id = uf.id
        JOIN users author ON uf.user_id = author.id
        ORDER BY pr.created_at DESC
        LIMIT ?
    `).all(limit);
}

/**
 * Flag a review for moderation
 */
function flagReview(reviewId, flaggerId, reason, details) {
    const db = getDb();
    
    db.prepare(`
        INSERT INTO content_flags (content_type, content_id, flagger_id, reason, details)
        VALUES ('review', ?, ?, ?, ?)
    `).run(reviewId, flaggerId, reason, details);
}

module.exports = {
    createReview,
    getReviewByUuid,
    getReviewsForFile,
    getReviewsByUser,
    hasUserReviewed,
    voteOnReview,
    addReviewResponse,
    getReviewStats,
    getTopReviewers,
    getRecentReviews,
    flagReview
};
