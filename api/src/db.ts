import { DatabaseSync } from 'node:sqlite';

export const db = new DatabaseSync(process.env.DATABASE_PATH ?? 'gigger.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)');
