import { Database } from "bun:sqlite";
export function openDatabase(
  path = process.env.DATABASE_PATH ?? "gigger.sqlite",
) {
  const db = new Database(path, { create: true });
  db.exec(
    "CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)",
  );
  return db;
}
