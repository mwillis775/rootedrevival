/**
 * OpenSource Scholar - Database Connection
 * 
 * Provides the main database connection and helper utilities.
 */

const Database = require('better-sqlite3');
const config = require('../config');

let db = null;

/**
 * Get the database connection (lazy initialization)
 */
function getDb() {
    if (!db) {
        db = new Database(config.dbPath);
        db.pragma('foreign_keys = ON');
        db.pragma('journal_mode = WAL');
    }
    return db;
}

/**
 * Close the database connection
 */
function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}

/**
 * Run a function within a transaction
 */
function transaction(fn) {
    const database = getDb();
    return database.transaction(fn)();
}

/**
 * Generate a UUID v4
 */
function generateUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

module.exports = {
    getDb,
    closeDb,
    transaction,
    generateUuid
};
