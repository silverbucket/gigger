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
  // Connected Facebook Pages: the Page token sends replies, the storage token lets webhooks write into the account.
  db.exec(
    "CREATE TABLE IF NOT EXISTS meta_pages (page_id TEXT PRIMARY KEY, ig_id TEXT, username TEXT NOT NULL, band_id TEXT NOT NULL, token TEXT NOT NULL, storage_token TEXT NOT NULL, user_id TEXT, UNIQUE (username, band_id))",
  );
  // user_id was added later; it links a Page to the Facebook user Meta names in deauthorize and data-deletion callbacks.
  try {
    db.exec("ALTER TABLE meta_pages ADD COLUMN user_id TEXT");
  } catch {}
  return db;
}
