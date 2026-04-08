#!/usr/bin/env node
/**
 * Migration: Add node/peer tracking columns to users table
 * 
 * Run: node server/src/db/migrate-add-node-tracking.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const config = require('../config');

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

console.log('Adding node tracking columns to users table...');

const columns = [
    { name: 'peer_id', def: 'TEXT' },
    { name: 'node_version', def: 'TEXT' },
    { name: 'node_last_seen', def: 'TEXT' },
    { name: 'node_grabnet_running', def: 'INTEGER DEFAULT 0' },
    { name: 'node_content_pinned', def: 'INTEGER DEFAULT 0' },
    { name: 'node_bytes_hosted', def: 'INTEGER DEFAULT 0' },
];

for (const col of columns) {
    try {
        db.prepare(`ALTER TABLE users ADD COLUMN ${col.name} ${col.def}`).run();
        console.log(`  + Added ${col.name}`);
    } catch (e) {
        if (e.message.includes('duplicate column')) {
            console.log(`  - ${col.name} already exists`);
        } else {
            throw e;
        }
    }
}

console.log('Done.');
db.close();
