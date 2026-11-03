import { Database } from "bun:sqlite";
export function openDatabase(
  path = process.env.DATABASE_PATH ?? "gigger.sqlite",
) {
  const db = new Database(path, { create: true });
  db.exec(
    "CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)",
  );
  // Maps a public page address to the account whose public remoteStorage folder holds it.
  db.exec(
    "CREATE TABLE IF NOT EXISTS public_pages (slug TEXT PRIMARY KEY, username TEXT NOT NULL, band_id TEXT NOT NULL, UNIQUE (username, band_id))",
  );
  return db;
}
