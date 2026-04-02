/**
 * Migration: Add encrypted file columns to paper_files table.
 * Safe to run multiple times — checks for existing columns first.
 *
 * Usage: cd server && node add-e2e-file-columns.js
 */
const Database = require('better-sqlite3');
const db = new Database('data/scholar.db');

const info = db.pragma('table_info(paper_files)');
const cols = info.map(c => c.name);
console.log('Existing paper_files columns:', cols.join(', '));

if (!cols.includes('encrypted')) {
    db.exec('ALTER TABLE paper_files ADD COLUMN encrypted INTEGER DEFAULT 0');
    console.log('Added encrypted');
} else {
    console.log('encrypted already exists');
}

if (!cols.includes('encryption_metadata')) {
    db.exec('ALTER TABLE paper_files ADD COLUMN encryption_metadata TEXT');
    console.log('Added encryption_metadata');
} else {
    console.log('encryption_metadata already exists');
}

db.close();
console.log('Done');
