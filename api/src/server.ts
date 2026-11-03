import type { Database } from "bun:sqlite";
import { type Channel, schemas } from "@gigger/schemas";
import { authHandler } from "./auth";
import { openDatabase } from "./db";
import { messageHandler } from "./messages";
import { metaHandler } from "./meta";
import { publicHandler } from "./public";
import { type Sender, sockethubSender } from "./sender";
export const senders = (): Record<Channel, Sender> => ({
  email: sockethubSender("email"),
  messenger: sockethubSender("messenger"),
  instagram: sockethubSender("instagram"),
});
export function handler(
  db: Database,
  auth = authHandler(),
  pages = publicHandler(db),
  messages = messageHandler(db, senders()),
  meta = metaHandler(db, messages),
) {
  return (req: Request) => {
    const path = new URL(req.url).pathname;
    if (path === "/meta/webhook" && ["GET", "POST"].includes(req.method))
      return meta.webhook(req);
    if (req.method === "GET" && path === "/meta/config") return meta.config();
    if (req.method === "GET" && path === "/meta/page") return meta.page(req);
    if (req.method === "POST" && path === "/meta/connect")
      return meta.connect(req);
    if (req.method === "POST" && path === "/meta/disconnect")
      return meta.disconnect(req);
    if (req.method === "POST" && path === "/messages/reply")
      return messages.reply(req);
    if (req.method === "GET" && path === "/messages/events")
      return messages.events(req);
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
    maxRequestBodySize: 1_000_000, // webhook batches exceed 8 KB
    hostname: "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
    fetch: handler(openDatabase()),
  });
