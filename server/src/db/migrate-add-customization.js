#!/usr/bin/env node
/**
 * Migration: Add customization column to users table
 * 
 * Run this to add the customization column to existing databases.
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/scholar.db');
console.log(`📦 Opening database: ${dbPath}`);

const db = new Database(dbPath);

// Check if column exists
const columns = db.prepare("PRAGMA table_info(users)").all();
const hasCustomization = columns.some(col => col.name === 'customization');

if (hasCustomization) {
    console.log('✓ customization column already exists');
} else {
    console.log('Adding customization column...');
    db.prepare('ALTER TABLE users ADD COLUMN customization TEXT').run();
    console.log('✓ Added customization column');
}

db.close();
console.log('✓ Migration complete');
