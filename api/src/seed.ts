import { openDatabase } from "./db";
export function seed(db: ReturnType<typeof openDatabase>) {
  db.query("INSERT OR IGNORE INTO items (name) VALUES (?)").run(
    "Welcome to Showday",
  );
}
if (import.meta.main) {
  const db = openDatabase();
  seed(db);
  db.close();
  console.log("Seed complete");
}
