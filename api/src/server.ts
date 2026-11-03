import type { Database } from "bun:sqlite";
import { schemas } from "@gigger/schemas";
import { authHandler } from "./auth";
import { openDatabase } from "./db";
import { publicHandler } from "./public";
export function handler(
  db: Database,
  auth = authHandler(),
  pages = publicHandler(db),
) {
  return (req: Request) => {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path.startsWith("/b/"))
      return pages.serve(path);
    if (req.method === "POST" && path === "/public/pages")
      return pages.claim(req);
    if (req.method === "POST" && /^\/auth\/(signup|login|logout)$/.test(path))
      return auth(req, path.slice(6));
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
    maxRequestBodySize: 8192,
    hostname: "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
    fetch: handler(openDatabase()),
  });
