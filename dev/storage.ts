/**
 * A stand-in for the Armadietto container: an in-memory remoteStorage server
 * plus the account hook from `armadietto/auth.cjs`, persisted to one JSON file
 * so accounts and records survive restarts. Local development only.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type AuthStore, createAuthHandler } from "../armadietto/auth.cjs";

type Doc = { body: Uint8Array; type: string; etag: string };
type User = {
  email: string;
  hash: string;
  /** token → scopes granted, e.g. { showday: ["r", "w"] } */
  tokens: Record<string, Record<string, string[]>>;
};
type Snapshot = {
  users: Record<string, User>;
  docs: Record<string, Omit<Doc, "body"> & { body: string }>;
};

const USERNAME = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const baseHeaders = {
  "Cache-Control": "no-cache",
  Expires: "0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Content-Length, If-Match, If-None-Match, Origin, X-Requested-With",
  "Access-Control-Expose-Headers": "ETag, Content-Length",
};
const etagOf = (text: string) =>
  `"${createHash("sha1").update(text).digest("hex").slice(0, 32)}"`;
const encoder = new TextEncoder();

/** Accounts, tokens and documents, with a debounced JSON snapshot. */
export class MemoryStore implements AuthStore {
  users = new Map<string, User>();
  docs = new Map<string, Doc>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private file?: string) {
    if (!file) return;
    try {
      const snapshot: Snapshot = JSON.parse(readFileSync(file, "utf8"));
      for (const [name, user] of Object.entries(snapshot.users))
        this.users.set(name, user);
      for (const [key, doc] of Object.entries(snapshot.docs))
        this.docs.set(key, {
          ...doc,
          body: new Uint8Array(Buffer.from(doc.body, "base64")),
        });
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  }

  private key = (username: string, path: string) => `${username}:${path}`;

  private persist() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 200);
  }
  /** Writes the snapshot now; called on shutdown so the last change is kept. */
  flush() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const snapshot: Snapshot = { users: {}, docs: {} };
    for (const [name, user] of this.users) snapshot.users[name] = user;
    for (const [key, doc] of this.docs)
      snapshot.docs[key] = {
        ...doc,
        body: Buffer.from(doc.body).toString("base64"),
      };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(snapshot));
  }

  // --- AuthStore ---
  async readAuth(username: string) {
    return this.users.get(username);
  }
  async findUserByEmail(email: string) {
    for (const user of this.users.values())
      if (user.email === email) return true;
    return false;
  }
  async createUser(user: {
    username: string;
    email: string;
    password: string;
  }) {
    this.users.set(user.username, {
      email: user.email,
      hash: await Bun.password.hash(user.password),
      tokens: {},
    });
    this.persist();
  }
  async removeUser(username: string) {
    this.users.delete(username);
    for (const key of this.docs.keys())
      if (key.startsWith(`${username}:`)) this.docs.delete(key);
    this.persist();
  }
  async authenticate(input: { username: string; password: string }) {
    const user = this.users.get(input.username);
    if (!user || !(await Bun.password.verify(input.password, user.hash)))
      throw new Error("Incorrect username or password.");
  }
  async authorize(
    _clientId: string | undefined,
    username: string,
    permissions: Record<string, string[]>,
  ) {
    const user = this.users.get(username);
    if (!user) throw new Error("No such user");
    const token = crypto.randomUUID().replace(/-/g, "");
    user.tokens[token] = permissions;
    this.persist();
    return token;
  }
  async revokeAccess(username: string, token: string) {
    const user = this.users.get(username);
    if (user) {
      delete user.tokens[token];
      this.persist();
    }
  }
  async put(username: string, path: string, contentType: string, body: Buffer) {
    const result = this.write(
      username,
      path,
      contentType,
      new Uint8Array(body),
    );
    return { created: result.status === 201 };
  }
  async get(username: string, path: string) {
    if (path.endsWith("/"))
      return { item: { items: this.listing(username, path) } };
    const doc = this.docs.get(this.key(username, path));
    return doc ? { item: { value: doc.body } } : {};
  }

  // --- storage primitives (paths start with "/") ---
  tokenUser(token: string) {
    for (const [name, user] of this.users)
      if (user.tokens[token])
        return { username: name, scopes: user.tokens[token] };
    return undefined;
  }
  /** Can this token touch `path` on `username`'s storage? Reads of public documents need no token. */
  allowed(scopes: Record<string, string[]>, path: string, write: boolean) {
    const folder = path.replace(/^\/public\//, "/").split("/")[1] ?? "";
    const granted = scopes[folder] ?? scopes["*"];
    return !!granted && (!write || granted.includes("w"));
  }
  document(username: string, path: string) {
    return this.docs.get(this.key(username, path));
  }
  listing(username: string, folder: string) {
    const prefix = this.key(username, folder);
    const items: Record<string, unknown> = {};
    const folders = new Map<string, string[]>();
    for (const [key, doc] of this.docs) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1)
        items[rest] = {
          ETag: doc.etag.slice(1, -1),
          "Content-Type": doc.type,
          "Content-Length": doc.body.byteLength,
        };
      else {
        const name = rest.slice(0, slash + 1);
        folders.set(name, [...(folders.get(name) ?? []), doc.etag]);
      }
    }
    for (const [name, etags] of folders)
      items[name] = { ETag: etagOf(etags.sort().join()).slice(1, -1) };
    return items;
  }
  folderEtag(username: string, folder: string) {
    const items = this.listing(username, folder);
    return Object.keys(items).length
      ? etagOf(JSON.stringify(items))
      : undefined;
  }
  write(username: string, path: string, type: string, body: Uint8Array) {
    const key = this.key(username, path);
    // A document cannot sit where a folder is, nor a folder where a document is.
    for (const other of this.docs.keys())
      if (other.startsWith(`${key}/`)) return { status: 409 as const };
    const parts = path.split("/");
    for (let i = 2; i < parts.length; i++)
      if (this.docs.has(this.key(username, parts.slice(0, i).join("/"))))
        return { status: 409 as const };
    const existed = this.docs.has(key);
    const etag = etagOf(`${Date.now()}:${Math.random()}`);
    this.docs.set(key, { body, type, etag });
    this.persist();
    return { status: existed ? (200 as const) : (201 as const), etag };
  }
  remove(username: string, path: string) {
    const deleted = this.docs.delete(this.key(username, path));
    if (deleted) this.persist();
    return deleted;
  }
}

/** WebFinger, storage and the OAuth path Armadietto would serve under `/storage`. */
export function storageHandler(store: MemoryStore) {
  const respond = (
    body: BodyInit | null,
    status: number,
    headers: Record<string, string> = {},
  ) => new Response(body, { status, headers: { ...baseHeaders, ...headers } });
  const json = (body: unknown, status = 200, headers = {}) =>
    respond(JSON.stringify(body), status, {
      "Content-Type": "application/ld+json",
      ...headers,
    });
  return async (req: Request) => {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return respond(null, 204);
    if (url.pathname === "/storage/.well-known/webfinger") {
      const resource = url.searchParams.get("resource") ?? "";
      const match = /^acct:([^@]+)@(.+)$/.exec(resource);
      if (!match) return json({ error: "Unknown resource" }, 404);
      const username = decodeURIComponent(match[1]).toLowerCase();
      const origin = `${url.protocol}//${req.headers.get("host") ?? url.host}`;
      return json(
        {
          links: [
            {
              href: `${origin}/storage/storage/${encodeURIComponent(username)}`,
              rel: "http://tools.ietf.org/id/draft-dejong-remotestorage",
              properties: {
                "http://remotestorage.io/spec/version":
                  "draft-dejong-remotestorage-22",
                "http://tools.ietf.org/html/rfc6749#section-4.2": `${origin}/storage/oauth/${encodeURIComponent(username)}`,
                "http://tools.ietf.org/html/rfc6750#section-2.3": null,
                "http://remotestorage.io/spec/web-authoring": null,
              },
            },
          ],
        },
        200,
        { "Content-Type": "application/jrd+json" },
      );
    }
    if (url.pathname.startsWith("/storage/oauth"))
      return respond(
        "The local dev storage has no authorization page. Use the app's login form.",
        501,
        { "Content-Type": "text/plain" },
      );
    const match = /^\/storage\/storage\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (!match) return json({ error: "Not found" }, 404);
    const username = decodeURIComponent(match[1]);
    const path = decodeURIComponent(match[2]);
    const isFolder = path.endsWith("/");
    const write = req.method !== "GET" && req.method !== "HEAD";
    const publicRead = !write && !isFolder && path.startsWith("/public/");
    if (!publicRead) {
      const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
      const grant = token ? store.tokenUser(token) : undefined;
      if (!grant || grant.username !== username) return respond(null, 401);
      if (!store.allowed(grant.scopes, path, write)) return respond(null, 403);
    }
    if (isFolder) {
      if (write) return respond(null, 405);
      const etag = store.folderEtag(username, path);
      if (
        etag &&
        req.headers.get("if-none-match")?.split(/,\s*/).includes(etag)
      )
        return respond(null, 304, { ETag: etag });
      return json(
        {
          "@context": "http://remotestorage.io/spec/folder-description",
          items: store.listing(username, path),
        },
        200,
        etag ? { ETag: etag } : {},
      );
    }
    // Read the body before looking at the document: an await between the
    // condition checks and the write would let a concurrent writer slip past them.
    const body =
      req.method === "PUT"
        ? new Uint8Array(await req.arrayBuffer())
        : undefined;
    const doc = store.document(username, path);
    if (req.method === "GET" || req.method === "HEAD") {
      if (!doc) return respond(null, 404);
      if (req.headers.get("if-none-match")?.split(/,\s*/).includes(doc.etag))
        return respond(null, 304, { ETag: doc.etag });
      return respond(
        req.method === "HEAD" ? null : (doc.body as BodyInit),
        200,
        {
          ETag: doc.etag,
          "Content-Type": doc.type,
          "Content-Length": `${doc.body.byteLength}`,
        },
      );
    }
    const ifMatch = req.headers.get("if-match");
    if (ifMatch && (!doc || doc.etag !== ifMatch)) return respond(null, 412);
    if (req.method === "PUT") {
      if (req.headers.get("if-none-match") === "*" && doc)
        return respond(null, 412);
      const result = store.write(
        username,
        path,
        req.headers.get("content-type") ?? "application/octet-stream",
        body as Uint8Array,
      );
      return result.status === 409
        ? json({ error: "Conflicts with an existing folder or document" }, 409)
        : respond(null, result.status, { ETag: result.etag as string });
    }
    if (req.method === "DELETE") {
      if (!doc) return respond(null, 404);
      store.remove(username, path);
      return respond(null, 200, { ETag: doc.etag });
    }
    return respond(null, 405);
  };
}

/** The container-only hook the API calls: signup, login, logout, server tokens and public gig reads. */
export function authHookHandler(store: MemoryStore, appOrigin: string) {
  const auth = createAuthHandler(store, appOrigin);
  return async (req: Request) => {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    if (req.method !== "POST")
      return new Response(null, { status: 405, headers });
    let input: Record<string, unknown>;
    try {
      input = await req.json();
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error();
    } catch {
      return new Response(null, { status: 400, headers });
    }
    const path = new URL(req.url).pathname;
    if (path === "/public-gigs") {
      const { username, slug } = input;
      if (
        typeof username !== "string" ||
        !USERNAME.test(username) ||
        typeof slug !== "string" ||
        !SLUG.test(slug) ||
        slug.length > 60
      )
        return new Response(null, { status: 400, headers });
      const base = `/public/showday/${slug}/gigs/`;
      const gigs: Record<string, unknown> = {};
      for (const id of Object.keys(store.listing(username, base))) {
        if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
        const doc = store.document(username, base + id);
        if (!doc) continue;
        try {
          gigs[id] = JSON.parse(new TextDecoder().decode(doc.body));
        } catch {
          // A malformed public record must not hide other gigs.
        }
      }
      return Response.json({ gigs }, { headers });
    }
    const result = await auth(path.slice(1), input);
    return Response.json(result.body, { status: result.status, headers });
  };
}

export type DevStorageOptions = {
  storagePort?: number;
  authPort?: number;
  /** JSON snapshot path; omit for a purely in-memory store. */
  file?: string;
  appOrigin?: string;
};
/** Starts both servers and returns the store with a `stop()`. */
export function startDevStorage(options: DevStorageOptions = {}) {
  const store = new MemoryStore(options.file);
  const storage = Bun.serve({
    hostname: "127.0.0.1",
    port: options.storagePort ?? 8700,
    fetch: storageHandler(store),
  });
  const hook = Bun.serve({
    hostname: "127.0.0.1",
    port: options.authPort ?? 8701,
    fetch: authHookHandler(store, options.appOrigin ?? "http://localhost:5173"),
  });
  return {
    store,
    storageUrl: storage.url.origin,
    authUrl: hook.url.origin,
    stop() {
      storage.stop(true);
      hook.stop(true);
    },
  };
}

/** Encode a JSON record the way the app stores it. */
export const jsonBody = (value: unknown) =>
  encoder.encode(JSON.stringify(value));

if (import.meta.main) {
  const dev = startDevStorage({
    file: process.env.DEV_STORAGE_FILE ?? ".dev/storage.json",
    storagePort: Number(process.env.STORAGE_PORT ?? 8700),
    authPort: Number(process.env.AUTH_PORT ?? 8701),
    appOrigin: process.env.APP_ORIGIN,
  });
  console.log(`dev storage ${dev.storageUrl}, account hook ${dev.authUrl}`);
}
