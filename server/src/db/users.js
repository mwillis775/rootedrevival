/**
 * OpenSource Scholar - User Repository
 * 
 * Database operations for user accounts.
 */

const { getDb, generateUuid } = require('./index');
const { hashPassword, verifyPassword, generateSessionToken, hashToken } = require('../crypto');
const config = require('../config');

/**
 * Create a new user
 */
async function createUser({ username, email, password, displayName = null }) {
    const db = getDb();
    
    // Validate inputs
    if (!username || !password) {
        throw new Error('Username and password are required');
    }
    
    if (username.length < 3 || username.length > 30) {
        throw new Error('Username must be 3-30 characters');
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        throw new Error('Username can only contain letters, numbers, underscores, and hyphens');
    }
    
    if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
    }
    
    // Check if username already exists
    const existingUsername = db.prepare(
        'SELECT id FROM users WHERE username = ?'
    ).get(username.toLowerCase());
    
    if (existingUsername) {
        throw new Error('Username already registered');
    }
    
    // Check if email already exists (if provided)
    if (email) {
        const existingEmail = db.prepare(
            'SELECT id FROM users WHERE email = ?'
        ).get(email.toLowerCase());
        if (existingEmail) {
            throw new Error('Email already registered');
        }
    }
    
    // Hash password
    const passwordHash = await hashPassword(password);
    
    // Insert user
    const result = db.prepare(`
        INSERT INTO users (username, email, password_hash, display_name)
        VALUES (?, ?, ?, ?)
    `).run(username.toLowerCase(), email ? email.toLowerCase() : null, passwordHash, displayName || username);
    
    return {
        id: result.lastInsertRowid,
        username: username.toLowerCase(),
        email: email ? email.toLowerCase() : null,
        displayName: displayName || username
    };
}

/**
 * Authenticate a user and create a session
 */
async function authenticateUser(usernameOrEmail, password, { ipAddress, userAgent } = {}) {
    const db = getDb();
    
    // Find user
    const user = db.prepare(`
        SELECT id, username, email, password_hash, display_name, is_banned, is_admin, is_moderator
        FROM users 
        WHERE username = ? OR email = ?
    `).get(usernameOrEmail.toLowerCase(), usernameOrEmail.toLowerCase());
    
    if (!user) {
        throw new Error('Invalid credentials');
    }
    
    if (user.is_banned) {
        throw new Error('Account is banned');
    }
    
    // Verify password
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
        throw new Error('Invalid credentials');
    }
    
    // Create session
    const { token, hash } = generateSessionToken();
    const expiresAt = new Date(Date.now() + config.sessionMaxAge).toISOString();
    
    db.prepare(`
        INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?)
    `).run(user.id, hash, expiresAt, ipAddress || null, userAgent || null);
    
    return {
        token,
        expiresAt,
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            displayName: user.display_name,
            isAdmin: !!user.is_admin,
            isModerator: !!user.is_moderator
        }
    };
}

/**
 * Validate a session token and return the user
 */
function validateSession(token) {
    const db = getDb();
    
    const tokenHash = hashToken(token);
    
    const session = db.prepare(`
        SELECT s.id as session_id, s.expires_at, 
               u.id, u.username, u.email, u.display_name, u.is_admin, u.is_moderator, u.is_banned
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token_hash = ? AND s.expires_at > datetime('now')
    `).get(tokenHash);
    
    if (!session) {
        return null;
    }
    
    if (session.is_banned) {
        // Invalidate all sessions for banned user
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(session.id);
        return null;
    }
    
    return {
        sessionId: session.session_id,
        user: {
            id: session.id,
            username: session.username,
            email: session.email,
            displayName: session.display_name,
            isAdmin: !!session.is_admin,
            isModerator: !!session.is_moderator
        }
    };
}

/**
 * Invalidate a session
 */
function invalidateSession(token) {
    const db = getDb();
    const tokenHash = hashToken(token);
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

/**
 * Invalidate all sessions for a user
 */
function invalidateAllSessions(userId) {
    const db = getDb();
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/**
 * Get user by ID
 */
function getUserById(id) {
    const db = getDb();
    return db.prepare(`
        SELECT id, username, email, display_name, bio, affiliation, orcid, customization,
               public_key, created_at, is_admin, is_moderator
        FROM users WHERE id = ?
    `).get(id);
}

/**
 * Get user by username
 */
function getUserByUsername(username) {
    const db = getDb();
    return db.prepare(`
        SELECT id, username, email, display_name, bio, affiliation, orcid, customization,
               public_key, created_at, is_admin, is_moderator
        FROM users WHERE username = ?
    `).get(username.toLowerCase());
}

/**
 * Update user profile
 */
function updateUserProfile(userId, { displayName, bio, affiliation, orcid, customization }) {
    const db = getDb();
    
    const updates = [];
    const params = [];
    
    if (displayName !== undefined) {
        updates.push('display_name = ?');
        params.push(displayName);
    }
    if (bio !== undefined) {
        updates.push('bio = ?');
        params.push(bio);
    }
    if (affiliation !== undefined) {
        updates.push('affiliation = ?');
        params.push(affiliation);
    }
    if (orcid !== undefined) {
        updates.push('orcid = ?');
        params.push(orcid);
    }
    if (customization !== undefined) {
        updates.push('customization = ?');
        params.push(customization);
    }
    
    if (updates.length === 0) return;
    
    updates.push("updated_at = datetime('now')");
    params.push(userId);
    
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

/**
 * Change user password
 */
async function changePassword(userId, currentPassword, newPassword) {
    const db = getDb();
    
    if (newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters');
    }
    
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    if (!user) {
        throw new Error('User not found');
    }
    
    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) {
        throw new Error('Current password is incorrect');
    }
    
    const newHash = await hashPassword(newPassword);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(newHash, userId);
    
    // Invalidate all other sessions
    invalidateAllSessions(userId);
}

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions() {
    const db = getDb();
    const result = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
    return result.changes;
}

module.exports = {
    createUser,
    authenticateUser,
    validateSession,
    invalidateSession,
    invalidateAllSessions,
    getUserById,
    getUserByUsername,
    updateUserProfile,
    changePassword,
    cleanupExpiredSessions,
    setPublicKey: function(userId, publicKey) {
        const db = getDb();
        db.prepare("UPDATE users SET public_key = ? WHERE id = ?").run(publicKey, userId);
    },
    getPublicKey: function(username) {
        const db = getDb();
        const row = db.prepare('SELECT public_key FROM users WHERE username = ?').get(username.toLowerCase());
        return row ? row.public_key : null;
    },
    getE2EKeysByUsername: function(username) {
        const db = getDb();
        return db.prepare(
            'SELECT public_key, encrypted_private_key FROM users WHERE username = ?'
        ).get(username.toLowerCase());
    },
    setE2EKeys: function(userId, { encryptedPrivateKey, keySalt, publicKey }) {
        const db = getDb();
        db.prepare(
            "UPDATE users SET encrypted_private_key = ?, key_salt = ?, public_key = ? WHERE id = ?"
        ).run(encryptedPrivateKey, keySalt, publicKey, userId);
    },
    getE2EKeys: function(userId) {
        const db = getDb();
        return db.prepare(
            'SELECT encrypted_private_key, key_salt, public_key FROM users WHERE id = ?'
        ).get(userId);
    }
};
