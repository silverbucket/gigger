import { Database } from "bun:sqlite";
export function openDatabase(
  path = process.env.DATABASE_PATH ?? "showday.sqlite",
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
  // Connections made before user_id and token encryption cannot be matched by Meta's callbacks; they must be reconnected.
  db.exec("DELETE FROM meta_pages WHERE user_id IS NULL");
  // Per-band email accounts: hosts, logins and the password live in one encrypted blob; the storage token lets the mailbox watcher write into the account.
  db.exec(
    "CREATE TABLE IF NOT EXISTS email_accounts (username TEXT NOT NULL, band_id TEXT NOT NULL, address TEXT NOT NULL, settings TEXT NOT NULL, storage_token TEXT NOT NULL, cursor TEXT, error TEXT, PRIMARY KEY (username, band_id))",
  );
  try {
    db.exec("ALTER TABLE email_accounts ADD COLUMN last_mail_at TEXT");
  } catch {}
  // The shared venue list: name, address, city, country and website only. match_key (folded name|address) keeps one entry per venue;
  // username and source_id name the band venue it came from, so that account's later edits update it.
  db.exec(
    "CREATE TABLE IF NOT EXISTS directory_venues (id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, city TEXT, country TEXT, website TEXT, match_key TEXT NOT NULL UNIQUE, search TEXT NOT NULL, username TEXT NOT NULL, source_id TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (username, source_id))",
  );
  return db;
}
