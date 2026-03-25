const Database = require('better-sqlite3');
const db = new Database('data/scholar.db');
const info = db.pragma('table_info(users)');
const cols = info.map(c => c.name);
console.log('Existing columns:', cols.join(', '));
if (cols.indexOf('encrypted_private_key') === -1) {
    db.exec('ALTER TABLE users ADD COLUMN encrypted_private_key TEXT');
    console.log('Added encrypted_private_key');
} else { console.log('encrypted_private_key exists'); }
if (cols.indexOf('key_salt') === -1) {
    db.exec('ALTER TABLE users ADD COLUMN key_salt TEXT');
    console.log('Added key_salt');
} else { console.log('key_salt exists'); }
if (cols.indexOf('public_key') === -1) {
    db.exec('ALTER TABLE users ADD COLUMN public_key TEXT');
    console.log('Added public_key');
} else { console.log('public_key exists'); }
db.close();
console.log('Done');
