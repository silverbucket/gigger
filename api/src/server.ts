import type { Database } from "bun:sqlite";
import { schemas } from "@gigger/schemas";
import { openDatabase } from "./db";
export function handler(db: Database) {
  return (req: Request) => {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/health") {
      db.query("SELECT 1").get();
      return Response.json({ status: "ok" });
    }
    if (req.method === "GET" && path === "/items")
      return Response.json(
        db.query("SELECT id, name FROM items ORDER BY id").all(),
      );
    if (req.method === "GET" && path === "/schemas")
      return Response.json(schemas);
    return Response.json({ error: "Not found" }, { status: 404 });
  };
}
if (import.meta.main)
  Bun.serve({
    hostname: "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
    fetch: handler(openDatabase()),
  });
