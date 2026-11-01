import { db } from './db.js';

db.prepare('INSERT OR IGNORE INTO items (name) VALUES (?)').run('Welcome to Gigger');
db.close();
console.log('Seed complete');
