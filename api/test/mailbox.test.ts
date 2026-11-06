import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { conversationId } from "@gigger/schemas";
import { Server, type Socket } from "socket.io";
import { openDatabase } from "../src/db";
import { type EmailAccount, emailAccounts } from "../src/email";
import { mailboxWatchers } from "../src/mailbox";
import { messageHandler } from "../src/messages";

process.env.TOKEN_KEY = "0f".repeat(32);
const CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://sockethub.org/ns/context/v1.jsonld",
  "https://sockethub.org/ns/context/platform/email/v1.jsonld",
];

/** A Sockethub lookalike with the email platform: acks credentials, connect and watch, and lets the test push activities. */
function stubSockethub() {
  const http = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        name: "sockethub",
        apiVersion: 1,
        endpoints: { socketIO: "/sockethub" },
        platforms: [{ id: "email", apiVersion: 1 }],
      }),
    );
  });
  const io = new Server(http, { path: "/sockethub", transports: ["polling"] });
  const received: { event: string; payload: Record<string, unknown> }[] = [];
  const sockets: Socket[] = [];
  io.on("connection", (socket) => {
    sockets.push(socket);
    socket.on("schemas", (_fingerprint, ack) =>
      ack({
        apiVersion: 1,
        contexts: { as: CONTEXT[0], sockethub: CONTEXT[1] },
        platforms: [
          {
            id: "email",
            apiVersion: 1,
            contextUrl: CONTEXT[2],
            contextVersion: "1",
            schemaVersion: "1",
            types: ["connect", "watch", "send"],
            schemas: { credentials: {}, messages: {} },
          },
        ],
      }),
    );
    socket.on("credentials", (payload, ack) => {
      received.push({ event: "credentials", payload });
      ack({});
    });
    socket.on("message", (payload, ack) => {
      received.push({ event: "message", payload });
      if (payload.type === "watch")
        return ack({
          "@context": CONTEXT,
          type: "watch",
          object: {
            type: "subscription",
            folder: "INBOX",
            cursor: payload.object?.cursor ?? { uidValidity: "1", uid: 10 },
          },
        });
      ack({ ...payload });
    });
  });
  return {
    received,
    sockets,
    current: () => sockets.at(-1) as Socket,
    push: (activity: Record<string, unknown>) =>
      (sockets.at(-1) as Socket).emit("message", {
        "@context": CONTEXT,
        ...activity,
      }),
    start: () =>
      new Promise<string>((resolve) =>
        http.listen(0, () =>
          resolve(
            `http://127.0.0.1:${(http.address() as { port: number }).port}`,
          ),
        ),
      ),
    stop: () => io.close(),
  };
}
/** In-memory remoteStorage with ETags; `broken` makes every write fail. */
function fakeStorage() {
  const docs = new Map<string, { body: string; etag: string }>();
  const state = { broken: false };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.headers.get("authorization") !== "Bearer server-token")
        return new Response("", { status: 401 });
      const path = new URL(req.url).pathname;
      const doc = docs.get(path);
      if (req.method === "GET")
        return doc
          ? new Response(doc.body, {
              headers: { "Content-Type": "application/json", ETag: doc.etag },
            })
          : new Response("", { status: 404 });
      if (state.broken) return new Response("", { status: 500 });
      if (req.headers.get("if-none-match") === "*" && doc)
        return new Response("", { status: 412 });
      const ifMatch = req.headers.get("if-match");
      if (ifMatch && doc?.etag !== ifMatch)
        return new Response("", { status: 412 });
      docs.set(path, {
        body: await req.text(),
        etag: `"${crypto.randomUUID()}"`,
      });
      return new Response("", { status: 200 });
    },
  });
  return {
    server,
    state,
    json: (path: string) => {
      const doc = docs.get(`/storage/storage/sam/showday/${path}`);
      return doc ? JSON.parse(doc.body) : undefined;
    },
    stop: () => server.stop(true),
  };
}
async function until(check: () => boolean, what: string, timeout = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${what}`);
    await Bun.sleep(10);
  }
}

test("the mailbox watcher connects with the saved cursor, stores posted mail, keeps the cursor and reconnects with backoff", async () => {
  const sockethub = stubSockethub();
  const storage = fakeStorage();
  const db = openDatabase(":memory:");
  const accounts = emailAccounts(db);
  const account: EmailAccount = {
    username: "sam",
    bandId: "band1",
    settings: {
      address: "band@example.com",
      name: "The Band",
      imapHost: "imap.example.com",
      imapPort: 993,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      login: "band@example.com",
      password: "mail-secret",
    },
    storageToken: "server-token",
  };
  accounts.put(account);
  // A send-only account is never watched.
  accounts.put({
    ...account,
    bandId: "band2",
    settings: { ...account.settings, imapHost: undefined },
  });
  const messages = messageHandler(
    db,
    {
      email: { send: async () => {} },
      messenger: { send: async () => {} },
      instagram: { send: async () => {} },
    },
    storage.server.url.origin,
  );
  const logged: string[] = [];
  const watchers = mailboxWatchers(accounts, messages, {
    armadiettoUrl: storage.server.url.origin,
    sockethubUrl: await sockethub.start(),
    minDelayMs: 50,
    maxDelayMs: 200,
    log: (message) => void logged.push(message),
  });
  try {
    watchers.startAll();
    await until(() => sockethub.received.length >= 3, "first session");
    expect(watchers.watching("sam", "band1")).toBeTrue();
    expect(watchers.watching("sam", "band2")).toBeFalse();
    expect(sockethub.received.map((r) => r.payload.type)).toEqual([
      "credentials",
      "connect",
      "watch",
    ]);
    expect(sockethub.received[0].payload).toMatchObject({
      actor: { id: "band@example.com", type: "person", name: "The Band" },
      object: {
        type: "credentials",
        from: "band@example.com",
        imap: {
          host: "imap.example.com",
          port: 993,
          secure: true,
          username: "band@example.com",
          password: "mail-secret",
        },
      },
    });
    expect(sockethub.received[0].payload.object).not.toHaveProperty("smtp");
    expect(sockethub.received[2].payload.object).toEqual({ folder: "INBOX" });
    await until(
      () => accounts.get("sam", "band1")?.cursor?.uid === 10,
      "cursor from the watch acknowledgement",
    );
    // New mail arrives as a post followed by the cursor it moved to.
    const conversation = conversationId("email", "band1", "jo@example.com");
    sockethub.push({
      type: "post",
      actor: { id: "jo@example.com", type: "person", name: "Jo" },
      target: { id: "band@example.com", type: "person" },
      object: {
        type: "message",
        id: "email:band%40example.com:INBOX:1:11",
        subject: "Booking for May?",
        messageId: "<jo-2@example.com>",
        references: [],
        published: "2025-03-01T10:00:00.000Z",
        content: "Free in May?",
      },
    });
    sockethub.push({
      type: "watch",
      object: {
        type: "subscription",
        folder: "INBOX",
        cursor: { uidValidity: "1", uid: 11 },
      },
    });
    await until(
      () => accounts.get("sam", "band1")?.cursor?.uid === 11,
      "cursor after the post",
    );
    expect(storage.json("conversations/index")[conversation]).toMatchObject({
      channel: "email",
      peer: { id: "jo@example.com", name: "Jo" },
      account: "band@example.com",
      subject: "Booking for May?",
      messageId: "<jo-2@example.com>",
      preview: "Free in May?",
    });
    expect(
      storage.json(
        `conversations/${conversation}/2025-03/email_band_40example_com_INBOX_1_11`,
      ),
    ).toMatchObject({ direction: "in", object: { content: "Free in May?" } });
    // Mail from the band's own address is not an enquiry.
    sockethub.push({
      type: "post",
      actor: { id: "band@example.com", type: "person" },
      object: { type: "message", id: "email:x:INBOX:1:12", content: "me" },
    });
    // The server drops the IMAP connection: the next session resumes from the saved cursor.
    sockethub.push({
      type: "disconnect",
      error: "email:connection-closed; reconnect and fetch using your cursor",
    });
    await until(() => sockethub.sockets.length >= 2, "reconnect");
    await until(() => sockethub.received.length >= 6, "second session");
    expect(sockethub.received[5].payload).toMatchObject({
      type: "watch",
      object: { folder: "INBOX", cursor: { uidValidity: "1", uid: 11 } },
    });
    expect(accounts.get("sam", "band1")?.error).toBeUndefined();
    // A cursor the mailbox no longer recognises is dropped before reconnecting.
    sockethub.push({ type: "watch", error: "email:cursor-invalid" });
    await until(() => sockethub.received.length >= 9, "third session");
    expect(sockethub.received[8].payload.object).toEqual({ folder: "INBOX" });
    await until(
      () =>
        sockethub.received.length >= 9 &&
        accounts.get("sam", "band1")?.error === undefined,
      "error cleared",
    );
    // While storage is down the cursor does not move past unstored mail, and the session restarts.
    storage.state.broken = true;
    sockethub.push({
      type: "post",
      actor: { id: "kim@example.com", type: "person" },
      object: {
        type: "message",
        id: "email:band%40example.com:INBOX:1:13",
        content: "Lost?",
        published: "2025-03-02T10:00:00.000Z",
      },
    });
    sockethub.push({
      type: "watch",
      object: {
        type: "subscription",
        folder: "INBOX",
        cursor: { uidValidity: "1", uid: 13 },
      },
    });
    await until(() => sockethub.received.length >= 12, "fourth session");
    expect(accounts.get("sam", "band1")?.cursor?.uid).toBe(10);
    expect(logged.some((l) => l.includes("Could not store mail"))).toBeTrue();
    expect(sockethub.received[11].payload.object).toEqual({
      folder: "INBOX",
      cursor: { uidValidity: "1", uid: 10 },
    });
    storage.state.broken = false;
    // Repeated quick failures back off further each time.
    const before = Date.now();
    sockethub.push({ type: "disconnect", error: "email:connection-closed" });
    await until(() => sockethub.received.length >= 15, "fifth session");
    sockethub.push({ type: "disconnect", error: "email:connection-closed" });
    await until(() => sockethub.received.length >= 18, "sixth session");
    expect(Date.now() - before).toBeGreaterThanOrEqual(150);
    // A connection failure is reported on the account so band settings can show it.
    sockethub.push({ type: "watch", error: "email:connect-failed" });
    await until(
      () => accounts.get("sam", "band1")?.error !== undefined,
      "error recorded",
    );
    expect(accounts.get("sam", "band1")?.error).toMatch(/sign in/);
    // Stopping ends the session and no new one starts.
    const connections = sockethub.sockets.length;
    await watchers.stopAll();
    expect(watchers.watching("sam", "band1")).toBeFalse();
    await Bun.sleep(300);
    expect(sockethub.sockets.length).toBeLessThanOrEqual(connections + 1);
    await until(
      () => sockethub.sockets.every((s) => !s.connected),
      "sockets closed",
    );
  } finally {
    await watchers.stopAll();
    sockethub.stop();
    storage.stop();
    db.close();
  }
}, 20000);
