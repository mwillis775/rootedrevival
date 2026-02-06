/**
 * ⚠️ REMOVE BEFORE GOING LIVE ⚠️
 * 
 * This script creates a test admin account with credentials:
 * Username: admin
 * Password: admin
 * 
 * DO NOT deploy to production with this account!
 * Delete this file and the account before launch.
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

// Password hashing (same as in crypto.js)
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

// Database path
const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/scholar.db');

console.log('⚠️  DEVELOPMENT ONLY - Remove before going live! ⚠️');
console.log('');
console.log('Creating admin account...');
console.log('Database:', dbPath);

try {
    const db = new Database(dbPath);
    
    // Check if admin already exists
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    
    if (existing) {
        console.log('Admin account already exists (id:', existing.id, ')');
        console.log('');
        console.log('To reset, run:');
        console.log('  DELETE FROM users WHERE username = "admin";');
    } else {
        const passwordHash = hashPassword('admin');
        
        const result = db.prepare(`
            INSERT INTO users (username, email, password_hash, display_name, is_admin, email_verified)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('admin', 'admin@localhost', passwordHash, 'Administrator', 1, 1);
        
        console.log('✅ Admin account created!');
        console.log('');
        console.log('   Username: admin');
        console.log('   Password: admin');
        console.log('   User ID:', result.lastInsertRowid);
    }
    
    console.log('');
    console.log('⚠️  REMINDER: Delete this account before production deployment!');
    
    db.close();
} catch (err) {
    console.error('Error:', err.message);
    console.log('');
    console.log('Make sure the database exists. Run the schema first:');
    console.log('  sqlite3 data/scholar.db < src/db/schema.sql');
    process.exit(1);
}
