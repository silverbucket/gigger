const http = require("node:http");
const fs = require("node:fs");
const { createAuthHandler } = require("./auth.cjs");
const Armadietto = require("./lib/armadietto");
const conf = JSON.parse(fs.readFileSync("/etc/armadietto/conf.json", "utf8"));
process.umask(0o077);
const store = new Armadietto.FileTree({ path: conf.storage_path });
store.removeUser = (username) =>
  fs.promises.rm(store._resolvePath(username, ""), {
    recursive: true,
    force: true,
  });
// shortcut: scan existing accounts for email uniqueness; add an index if signups become slow.
store.findUserByEmail = async (email) => {
  let prefixes;
  try {
    prefixes = await fs.promises.readdir(conf.storage_path, {
      withFileTypes: true,
    });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  for (const prefix of prefixes.filter((entry) => entry.isDirectory())) {
    const users = await fs.promises.readdir(
      `${conf.storage_path}/${prefix.name}`,
      { withFileTypes: true },
    );
    for (const user of users.filter((entry) => entry.isDirectory())) {
      const account = await store.readAuth(user.name);
      if (account?.email?.trim().toLowerCase() === email) return true;
    }
  }
  return false;
};
const server = new Armadietto({
  basePath: conf.basePath,
  store,
  logging: conf.logging,
  http: conf.http,
  https: conf.https,
  allow: { signup: false },
});
server.boot();
const auth = createAuthHandler(store, process.env.APP_ORIGIN);
http
  .createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) {
          res.writeHead(413).end();
          return;
        }
      }
      const input = JSON.parse(body);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        res.writeHead(400).end();
        return;
      }
      if (req.url === "/public-gigs") {
        const { username, slug } = input;
        if (
          typeof username !== "string" ||
          !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(username) ||
          typeof slug !== "string" ||
          !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ||
          slug.length > 60
        ) {
          res.writeHead(400).end();
          return;
        }
        const base = `/public/showday/${slug}/gigs/`;
        const listing = await store.get(username, base);
        const gigs = {};
        for (const id of Object.keys(listing.item?.items ?? {})) {
          if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
          const result = await store.get(username, base + id);
          if (result.item?.value) {
            try {
              gigs[id] = JSON.parse(result.item.value.toString());
            } catch {
              // A malformed public record must not hide other gigs.
            }
          }
        }
        res.writeHead(200).end(JSON.stringify({ gigs }));
        return;
      }
      const result = await auth(req.url.slice(1), input);
      res.writeHead(result.status).end(JSON.stringify(result.body));
    } catch {
      res.writeHead(503).end(
        JSON.stringify({
          error: "Account service unavailable. Please retry.",
        }),
      );
    }
  })
  .listen(8001, "0.0.0.0");
