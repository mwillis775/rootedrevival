#!/usr/bin/env node
/**
 * OpenSource Scholar - Database Initialization
 * 
 * Creates the SQLite database and runs schema migrations.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('../config');

console.log('📚 OpenSource Scholar - Database Initialization');
console.log('━'.repeat(50));

// Ensure data directory exists
const dataDir = path.dirname(config.dbPath);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`✓ Created data directory: ${dataDir}`);
}

// Create database connection
const db = new Database(config.dbPath);
console.log(`✓ Database opened: ${config.dbPath}`);

// Enable foreign keys and WAL mode
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Read and execute schema
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

console.log('✓ Executing schema...');
db.exec(schema);

// Insert default disciplines
const defaultDisciplines = [
    { slug: 'humanities', name: 'Humanities', description: 'History, philosophy, literature, ethics, and cultural studies', icon: '📜' },
    { slug: 'social-sciences', name: 'Social Sciences', description: 'Psychology, sociology, economics, political science, anthropology', icon: '🏛️' },
    { slug: 'stem', name: 'STEM', description: 'Science, technology, engineering, mathematics', icon: '🔬' },
    { slug: 'medicine-health', name: 'Medicine & Health', description: 'Clinical research, public health, evidence-based medicine', icon: '⚕️' },
    { slug: 'arts-design', name: 'Arts & Design', description: 'Creative practice, visual research, design theory', icon: '🎨' },
    { slug: 'interdisciplinary', name: 'Interdisciplinary', description: 'Work that bridges fields and connects methods', icon: '🔗' },
    
    // Sub-disciplines
    { slug: 'philosophy', name: 'Philosophy', parent: 'humanities', icon: '🤔' },
    { slug: 'history', name: 'History', parent: 'humanities', icon: '📚' },
    { slug: 'literature', name: 'Literature', parent: 'humanities', icon: '📖' },
    { slug: 'linguistics', name: 'Linguistics', parent: 'humanities', icon: '💬' },
    
    { slug: 'psychology', name: 'Psychology', parent: 'social-sciences', icon: '🧠' },
    { slug: 'sociology', name: 'Sociology', parent: 'social-sciences', icon: '👥' },
    { slug: 'economics', name: 'Economics', parent: 'social-sciences', icon: '📊' },
    { slug: 'political-science', name: 'Political Science', parent: 'social-sciences', icon: '🗳️' },
    { slug: 'anthropology', name: 'Anthropology', parent: 'social-sciences', icon: '🌍' },
    
    { slug: 'physics', name: 'Physics', parent: 'stem', icon: '⚛️' },
    { slug: 'chemistry', name: 'Chemistry', parent: 'stem', icon: '🧪' },
    { slug: 'biology', name: 'Biology', parent: 'stem', icon: '🧬' },
    { slug: 'computer-science', name: 'Computer Science', parent: 'stem', icon: '💻' },
    { slug: 'mathematics', name: 'Mathematics', parent: 'stem', icon: '📐' },
    { slug: 'engineering', name: 'Engineering', parent: 'stem', icon: '⚙️' },
    { slug: 'environmental-science', name: 'Environmental Science', parent: 'stem', icon: '🌱' },
    
    { slug: 'medicine', name: 'Medicine', parent: 'medicine-health', icon: '🏥' },
    { slug: 'public-health', name: 'Public Health', parent: 'medicine-health', icon: '🏃' },
    { slug: 'neuroscience', name: 'Neuroscience', parent: 'medicine-health', icon: '🧠' },
    
    { slug: 'visual-arts', name: 'Visual Arts', parent: 'arts-design', icon: '🖼️' },
    { slug: 'music', name: 'Music', parent: 'arts-design', icon: '🎵' },
    { slug: 'architecture', name: 'Architecture', parent: 'arts-design', icon: '🏛️' },
    { slug: 'design', name: 'Design', parent: 'arts-design', icon: '✏️' }
];

const insertDiscipline = db.prepare(`
    INSERT OR IGNORE INTO disciplines (slug, name, description, icon, parent_id, sort_order)
    VALUES (@slug, @name, @description, @icon, @parent_id, @sort_order)
`);

const getParentId = db.prepare('SELECT id FROM disciplines WHERE slug = ?');

let sortOrder = 0;
for (const d of defaultDisciplines) {
    let parentId = null;
    if (d.parent) {
        const parent = getParentId.get(d.parent);
        if (parent) parentId = parent.id;
    }
    
    insertDiscipline.run({
        slug: d.slug,
        name: d.name,
        description: d.description || null,
        icon: d.icon || '📄',
        parent_id: parentId,
        sort_order: sortOrder++
    });
}

console.log(`✓ Inserted ${defaultDisciplines.length} disciplines`);

// Run GrabNet schema migration
const grabSchemaPath = path.join(__dirname, 'schema-grabnet.sql');
if (fs.existsSync(grabSchemaPath)) {
    const grabSchema = fs.readFileSync(grabSchemaPath, 'utf8');
    console.log('✓ Executing GrabNet schema...');
    db.exec(grabSchema);
    console.log('✓ GrabNet tables created (user_sites, user_files, peer_reviews, etc.)');
}

// Create uploads directory
if (!fs.existsSync(config.uploadsDir)) {
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    console.log(`✓ Created uploads directory: ${config.uploadsDir}`);
}

// Create sites directory for GrabNet
const sitesDir = config.sitesDir || path.join(config.dataDir, 'sites');
if (!fs.existsSync(sitesDir)) {
    fs.mkdirSync(sitesDir, { recursive: true });
    console.log(`✓ Created sites directory: ${sitesDir}`);
}

db.close();
console.log('\n✅ Database initialization complete!');
console.log(`   Database: ${config.dbPath}`);
console.log(`   Uploads: ${config.uploadsDir}`);
console.log(`   Sites: ${sitesDir}`);
