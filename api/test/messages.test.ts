import { expect, test } from "bun:test";
import {
  type Conversation,
  conversationId,
  type Message,
  needsHumanAgentTag,
  replyBlocked,
  withMessage,
} from "@gigger/schemas";
import { openDatabase } from "../src/db";
import { messageHandler } from "../src/messages";
import {
  fromWebhook,
  metaHandler,
  parseSignedRequest,
  validSignature,
} from "../src/meta";
import { seal, unseal } from "../src/secrets";
import type { Sender } from "../src/sender";
import { handler } from "../src/server";

const secret = "app-secret";
process.env.TOKEN_KEY = "0f".repeat(32);
const signedRequest = (payload: unknown) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = Buffer.from(
    new Bun.CryptoHasher("sha256", secret).update(body).digest(),
  ).toString("base64url");
  return `${signature}.${body}`;
};
const sign = (body: string) =>
  `sha256=${new Bun.CryptoHasher("sha256", secret).update(body).digest("hex")}`;

/** In-memory remoteStorage with ETags, If-Match/If-None-Match and one injected 412. */
function fakeArmadietto(options: { conflictOnce?: boolean } = {}) {
  const docs = new Map<
    string,
    { body: Uint8Array; type: string; etag: string }
  >();
  let conflict = options.conflictOnce ?? false;
  const flags = { failFiles: false };
  const minted: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/token") {
        minted.push("server-token");
        return Response.json({ token: "server-token" });
      }
      if (path === "/logout") return Response.json({ ok: true });
      const auth = req.headers.get("authorization");
      if (
        ![
          "Bearer user-token",
          "Bearer server-token",
          "Bearer read-only",
        ].includes(auth ?? "")
      )
        return new Response("", { status: 401 });
      if (/\/gigger\/bands\/band[12]\/band$/.test(path))
        return req.method === "GET"
          ? Response.json({ id: "band1", name: "The Band" })
          : new Response("", {
              status: auth === "Bearer read-only" ? 403 : 412,
            });
      const doc = docs.get(path);
      if (req.method === "GET")
        return doc
          ? new Response(doc.body as BodyInit, {
              headers: { "Content-Type": doc.type, ETag: doc.etag },
            })
          : new Response("", { status: 404 });
      if (req.method === "PUT") {
        if (flags.failFiles && path.includes("/files/"))
          return new Response("", { status: 500 });
        const ifMatch = req.headers.get("if-match");
        if (req.headers.get("if-none-match") === "*" && doc)
          return new Response("", { status: 412 });
        if (ifMatch && (!doc || doc.etag !== ifMatch || conflict)) {
          conflict = false;
          return new Response("", { status: 412 });
        }
        docs.set(path, {
          body: new Uint8Array(await req.arrayBuffer()),
          type: req.headers.get("content-type") ?? "",
          etag: `"${crypto.randomUUID()}"`,
        });
        return new Response("", { status: 200 });
      }
      return new Response("", { status: 405 });
    },
  });
  const json = (path: string) => {
    const doc = docs.get(`/storage/storage/sam/gigger/${path}`);
    return doc ? JSON.parse(new TextDecoder().decode(doc.body)) : undefined;
  };
  return {
    server,
    docs,
    json,
    minted,
    flags,
    stop: () => server.stop(true),
    stopStorage: () => server.stop(true),
  };
}
function stubSenders() {
  const sent: { message: Message; credentials?: Record<string, unknown> }[] =
    [];
  let failWith = "";
  const sender: Sender = {
    async send(message, credentials) {
      if (failWith) throw new Error(failWith);
      sent.push({ message, credentials });
    },
  };
  return {
    sent,
    fail: (reason: string) => {
      failWith = reason;
    },
    senders: { email: sender, messenger: sender, instagram: sender },
  };
}
function setup(options?: {
  conflictOnce?: boolean;
  humanAgent?: boolean;
  mailAccount?: boolean;
}) {
  const armadietto = fakeArmadietto(options);
  const db = openDatabase(":memory:");
  const stub = stubSenders();
  const messages = messageHandler(
    db,
    stub.senders,
    armadietto.server.url.origin,
    "http://app.test",
    {
      ...process.env,
      META_HUMAN_AGENT: options?.humanAgent ? "1" : "0",
    } as NodeJS.ProcessEnv,
  );
  const graph = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path.startsWith("/psid-1"))
        return Response.json({ name: "Jana Promoter" });
      return Response.json({ error: { message: "unknown" } }, { status: 400 });
    },
  });
  const meta = metaHandler(
    db,
    messages,
    {
      META_APP_SECRET: secret,
      META_VERIFY_TOKEN: "verify-me",
      TOKEN_KEY: process.env.TOKEN_KEY,
    } as NodeJS.ProcessEnv,
    armadietto.server.url.origin,
    armadietto.server.url.origin,
    graph.url.origin.replace(/\/$/, ""),
  );
  const api = Bun.serve({
    port: 0,
    fetch: handler(db, undefined, undefined, messages, meta),
  });
  db.query(
    "INSERT INTO meta_pages (page_id, ig_id, username, band_id, token, storage_token) VALUES ('page-1', 'ig-1', 'sam', 'band1', ?, ?)",
  ).run(seal("page-token"), seal("server-token"));
  if (options?.mailAccount !== false)
    db.query(
      "INSERT INTO email_accounts (username, band_id, address, settings, storage_token) VALUES ('sam', 'band1', 'band@example.com', ?, ?)",
    ).run(
      seal(
        JSON.stringify({
          address: "band@example.com",
          name: "The Band",
          imapHost: "imap.example.com",
          imapPort: 993,
          smtpHost: "smtp.example.com",
          smtpPort: 587,
          login: "band@example.com",
          password: "mail-secret",
        }),
      ),
      seal("server-token"),
    );
  const url = (path: string) => new URL(path, api.url);
  return {
    ...armadietto,
    ...stub,
    db,
    url,
    stop() {
      armadietto.stop();
      graph.stop(true);
      api.stop(true);
      db.close();
    },
  };
}
const webhookBody = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    object: "page",
    entry: [
      {
        id: "page-1",
        messaging: [
          {
            sender: { id: "psid-1" },
            recipient: { id: "page-1" },
            timestamp: 1735689600000,
            message: { mid: "m_abc.1", text, ...extra },
          },
        ],
      },
    ],
  });

test("webhook verifies the challenge and rejects bad signatures", async () => {
  const t = setup();
  try {
    expect(
      await (
        await fetch(
          t.url(
            "/meta/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42",
          ),
        )
      ).text(),
    ).toBe("42");
    expect(
      (
        await fetch(
          t.url(
            "/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42",
          ),
        )
      ).status,
    ).toBe(403);
    const body = webhookBody("hi");
    expect(
      (await fetch(t.url("/meta/webhook"), { method: "POST", body })).status,
    ).toBe(401);
    expect(
      (
        await fetch(t.url("/meta/webhook"), {
          method: "POST",
          body,
          headers: { "X-Hub-Signature-256": sign("other") },
        })
      ).status,
    ).toBe(401);
    expect(validSignature(secret, body, sign(body))).toBe(true);
    expect(validSignature(secret, body, `sha256=${"0".repeat(64)}`)).toBe(
      false,
    );
    expect(validSignature(secret, body, `sha256=${"é".repeat(64)}`)).toBe(
      false,
    );
    expect(validSignature(secret, body, null)).toBe(false);
    expect(t.docs.size).toBe(0);
  } finally {
    t.stop();
  }
});

test("a signed Messenger event becomes a stored message with an index entry, once", async () => {
  const t = setup();
  try {
    const body = webhookBody("Can you play Friday?");
    const post = () =>
      fetch(t.url("/meta/webhook"), {
        method: "POST",
        body,
        headers: { "X-Hub-Signature-256": sign(body) },
      });
    expect((await post()).status).toBe(200);
    const conversation = conversationId("messenger", "band1", "psid-1");
    const stored = t.json(`conversations/${conversation}/2025-01/m_abc_1`);
    expect(stored).toMatchObject({
      channel: "messenger",
      direction: "in",
      conversation,
      bandId: "band1",
      actor: { id: "psid-1", name: "Jana Promoter" },
      target: { id: "page-1" },
      object: { type: "Note", content: "Can you play Friday?" },
      published: "2025-01-01T00:00:00.000Z",
    });
    expect(t.json("conversations/index")[conversation]).toMatchObject({
      bandId: "band1",
      channel: "messenger",
      peer: { id: "psid-1", name: "Jana Promoter" },
      lastIn: "2025-01-01T00:00:00.000Z",
      preview: "Can you play Friday?",
    });
    const before = t.docs.get(
      `/storage/storage/sam/gigger/conversations/index`,
    )?.etag;
    expect((await post()).status).toBe(200); // Meta retries deliveries
    expect(
      t.docs.get(`/storage/storage/sam/gigger/conversations/index`)?.etag,
    ).toBe(before);
  } finally {
    t.stop();
  }
});

test("echo events are outgoing messages and attachments are copied into storage", async () => {
  const t = setup();
  const cdn = Bun.serve({
    port: 0,
    fetch: () =>
      new Response("PNGDATA", { headers: { "Content-Type": "image/png" } }),
  });
  try {
    const body = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: "ig-1",
          messaging: [
            {
              sender: { id: "ig-1" },
              recipient: { id: "fan-9" },
              timestamp: 1735689600000,
              message: {
                mid: "m_echo",
                text: "See you there",
                is_echo: true,
                attachments: [
                  { type: "image", payload: { url: `${cdn.url}pic.png` } },
                ],
              },
            },
          ],
        },
      ],
    });
    await fetch(t.url("/meta/webhook"), {
      method: "POST",
      body,
      headers: { "X-Hub-Signature-256": sign(body) },
    });
    const conversation = conversationId("instagram", "band1", "fan-9");
    const path = `conversations/${conversation}/2025-01/m_echo`;
    expect(t.json(path)).toMatchObject({
      direction: "out",
      channel: "instagram",
      actor: { id: "ig-1" },
      target: { id: "fan-9" },
      object: {
        attachment: [
          {
            type: "image",
            url: `gigger/conversations/${conversation}/2025-01/files/m_echo-0`,
            mediaType: "image/png",
          },
        ],
      },
    });
    expect(
      new TextDecoder().decode(
        t.docs.get(
          `/storage/storage/sam/gigger/conversations/${conversation}/2025-01/files/m_echo-0`,
        )?.body,
      ),
    ).toBe("PNGDATA");
    expect(t.json("conversations/index")[conversation]).toMatchObject({
      lastOut: "2025-01-01T00:00:00.000Z",
      peer: { id: "fan-9" },
    });
    expect(t.json("conversations/index")[conversation].lastIn).toBeUndefined();
    expect(
      fromWebhook("messenger", "b", {
        sender: { id: "a" },
        recipient: { id: "b" },
        timestamp: 1,
      }),
    ).toBeNull();
    // A failed attachment write must not be acknowledged with an expiring CDN link stored instead.
    t.flags.failFiles = true;
    const retry = body.replace("m_echo", "m_echo2");
    expect(
      (
        await fetch(t.url("/meta/webhook"), {
          method: "POST",
          body: retry,
          headers: { "X-Hub-Signature-256": sign(retry) },
        })
      ).status,
    ).toBe(500);
    expect(
      t.json(`conversations/${conversation}/2025-01/m_echo2`),
    ).toBeUndefined();
  } finally {
    cdn.stop(true);
    t.stop();
  }
});

test("the 24-hour rule blocks Meta replies but never email", () => {
  const now = Date.parse("2025-01-02T00:00:00Z");
  const base: Conversation = {
    bandId: "b",
    channel: "messenger",
    peer: { id: "p" },
    preview: "",
  };
  expect(replyBlocked({ ...base, lastIn: "2025-01-01T00:00:01Z" }, now)).toBe(
    "",
  );
  expect(
    replyBlocked({ ...base, lastIn: "2025-01-01T00:00:00Z" }, now),
  ).toMatch(/24 hours/);
  expect(
    replyBlocked(
      { ...base, channel: "instagram", lastIn: "2024-12-01T00:00:00Z" },
      now,
    ),
  ).toMatch(/Instagram/);
  expect(replyBlocked({ ...base }, now)).toMatch(/Messenger/);
  expect(
    replyBlocked({ ...base, lastIn: "2026-01-01T00:00:00Z" }, now),
  ).toMatch(/24 hours/); // clock skew is not a licence
  expect(replyBlocked({ ...base, channel: "email" }, now)).toBe("");
  // With the Human Agent permission the window is 7 days, and anything past 24 hours needs the tag.
  const twoDays = { ...base, lastIn: "2024-12-31T00:00:00Z" };
  expect(replyBlocked(twoDays, now, true)).toBe("");
  expect(needsHumanAgentTag(twoDays, now)).toBe(true);
  expect(
    needsHumanAgentTag({ ...base, lastIn: "2025-01-01T12:00:00Z" }, now),
  ).toBe(false);
  expect(
    replyBlocked({ ...base, lastIn: "2024-12-25T00:00:00Z" }, now, true),
  ).toMatch(/7 days/);
  const inbound: Message = {
    id: "1",
    channel: "messenger",
    direction: "in",
    conversation: "c",
    bandId: "b",
    actor: { id: "p", name: "Pat" },
    target: { id: "page" },
    object: { type: "Note", content: "x".repeat(200) },
    published: "2025-01-01T10:00:00Z",
  };
  const index = withMessage({}, inbound);
  expect(index.c.preview).toHaveLength(120);
  const older = withMessage(index, {
    ...inbound,
    id: "0",
    published: "2024-12-31T10:00:00Z",
    object: { type: "Note", content: "old" },
  });
  expect(older.c.lastIn).toBe("2025-01-01T10:00:00Z");
  expect(
    withMessage(index, {
      ...inbound,
      direction: "out",
      actor: { id: "page" },
      target: { id: "p" },
      published: "2025-01-01T11:00:00Z",
    }).c,
  ).toMatchObject({
    lastIn: "2025-01-01T10:00:00Z",
    lastOut: "2025-01-01T11:00:00Z",
    peer: { id: "p", name: "Pat" },
  });
});

test("reply saves the outgoing message, retries the index on 412, hands it to the sender and streams an event", async () => {
  const t = setup({ conflictOnce: true });
  try {
    const conversation = conversationId("messenger", "band1", "psid-1");
    const seed = webhookBody("Hello", {});
    await fetch(t.url("/meta/webhook"), {
      method: "POST",
      body: seed,
      headers: { "X-Hub-Signature-256": sign(seed) },
    });
    const ticketFor = (token: string) =>
      fetch(t.url("/messages/ticket"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: "sam", bandId: "band1" }),
      });
    expect((await ticketFor("bad")).status).toBe(401);
    const { ticket } = await (await ticketFor("user-token")).json();
    const events = await fetch(t.url(`/messages/events?ticket=${ticket}`));
    expect(events.headers.get("content-type")).toBe("text/event-stream");
    // A ticket opens one stream; the storage token itself never works here.
    expect(
      (await fetch(t.url(`/messages/events?ticket=${ticket}`))).status,
    ).toBe(401);
    expect(
      (await fetch(t.url("/messages/events?ticket=user-token"))).status,
    ).toBe(401);
    const reader = events.body?.getReader();
    const reply = (body: unknown, token = "user-token") =>
      fetch(t.url("/messages/reply"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Origin: "http://app.test",
        },
        body: JSON.stringify(body),
      });
    const recent = new Date(Date.now() - 60000).toISOString();
    // The webhook seed is dated 2025; make the contact's last message recent so the window is open.
    const indexPath = `/storage/storage/sam/gigger/conversations/index`;
    const current = t.json("conversations/index");
    current[conversation].lastIn = recent;
    t.docs.set(indexPath, {
      body: new TextEncoder().encode(JSON.stringify(current)),
      type: "application/json",
      etag: '"seeded"',
    });
    const sent = await reply({
      username: "sam",
      bandId: "band1",
      conversation,
      text: "  Yes, Friday works  ",
    });
    expect(sent.status).toBe(200);
    const message = await sent.json();
    expect(message).toMatchObject({
      direction: "out",
      channel: "messenger",
      actor: { id: "page-1" },
      target: { id: "psid-1" },
      object: { content: "Yes, Friday works" },
    });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({
      message: { id: message.id },
      credentials: { token: "page-token", apiVersion: "v26.0" },
    });
    expect(
      t.json(
        `conversations/${conversation}/${message.published.slice(0, 7)}/${message.id}`,
      ),
    ).toMatchObject({ object: { content: "Yes, Friday works" } });
    expect(t.json("conversations/index")[conversation]).toMatchObject({
      lastIn: recent,
      lastOut: message.published,
      preview: "Yes, Friday works",
    });
    let chunk = "";
    while (!chunk.includes("data:"))
      chunk += new TextDecoder().decode((await reader?.read())?.value);
    expect(chunk).toContain(`"conversation":"${conversation}"`);
    await reader?.cancel();

    expect(
      (
        await reply(
          { username: "sam", bandId: "band1", conversation, text: "x" },
          "bad",
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await reply(
          { username: "sam", bandId: "band1", conversation, text: "x" },
          "read-only",
        )
      ).status,
    ).toBe(401);
    const ig = conversationId("instagram", "band1", "fan-9");
    const withIg = t.json("conversations/index");
    withIg[ig] = {
      bandId: "band1",
      channel: "instagram",
      peer: { id: "fan-9" },
      lastIn: recent,
      preview: "",
    };
    t.docs.set(indexPath, {
      body: new TextEncoder().encode(JSON.stringify(withIg)),
      type: "application/json",
      etag: '"ig"',
    });
    const igReply = await reply({
      username: "sam",
      bandId: "band1",
      conversation: ig,
      text: "hello from ig",
    });
    expect(igReply.status).toBe(200);
    expect((await igReply.json()).actor).toEqual({ id: "ig-1" });
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1].credentials).toEqual({
      token: "page-token",
      apiVersion: "v26.0",
      login: "facebook",
      pageId: "page-1",
    });
    expect(t.json("conversations/index")[ig].account).toBe("ig-1");
    // A conversation that ran through a Page no longer connected cannot be answered with the new one.
    const foreign = t.json("conversations/index");
    foreign[conversation].account = "old-page";
    t.docs.set(indexPath, {
      body: new TextEncoder().encode(JSON.stringify(foreign)),
      type: "application/json",
      etag: '"foreign"',
    });
    expect(
      (
        await reply({
          username: "sam",
          bandId: "band1",
          conversation,
          text: "x",
        })
      ).status,
    ).toBe(409);
    foreign[conversation].account = "page-1";
    t.docs.set(indexPath, {
      body: new TextEncoder().encode(JSON.stringify(foreign)),
      type: "application/json",
      etag: '"restored"',
    });
    // Email replies go out as the address the enquiry was sent to, not the storage username.
    const mail = conversationId("email", "band1", "jo@example.com");
    foreign[mail] = {
      bandId: "band1",
      channel: "email",
      peer: { id: "jo@example.com" },
      account: "old-address@example.com",
      preview: "",
      subject: "Booking for May?",
      messageId: "<jo-2@example.com>",
      references: ["<jo-1@example.com>"],
    };
    t.docs.set(indexPath, {
      body: new TextEncoder().encode(JSON.stringify(foreign)),
      type: "application/json",
      etag: '"mail"',
    });
    const mailReply = await reply({
      username: "sam",
      bandId: "band1",
      conversation: mail,
      text: "by mail",
    });
    expect(mailReply.status).toBe(200);
    expect(await mailReply.json()).toMatchObject({
      actor: { id: "band@example.com", name: "The Band" },
      target: { id: "jo@example.com" },
      subject: "Re: Booking for May?",
      inReplyTo: "<jo-2@example.com>",
      references: ["<jo-1@example.com>", "<jo-2@example.com>"],
    });
    expect(t.sent.at(-1)?.credentials).toEqual({
      from: "band@example.com",
      smtp: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        username: "band@example.com",
        password: "mail-secret",
      },
    });
    t.sent.pop();
    // A band without a mail account is told to set one up rather than failing at Sockethub.
    t.db.query("DELETE FROM email_accounts").run();
    const unconfigured = await reply({
      username: "sam",
      bandId: "band1",
      conversation: mail,
      text: "by mail",
    });
    expect(unconfigured.status).toBe(409);
    expect((await unconfigured.json()).error).toMatch(/email account/);
    expect(
      (
        await reply({
          username: "sam",
          bandId: "band1",
          conversation: "nope",
          text: "x",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await reply({
          username: "sam",
          bandId: "band1",
          conversation,
          text: " ",
        })
      ).status,
    ).toBe(400);

    t.fail("platform offline");
    const failed = await reply({
      username: "sam",
      bandId: "band1",
      conversation,
      text: "again",
    });
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toContain("platform offline");
    // Sockethub's window-closed reason becomes an explanation of Meta's 24-hour and 7-day rules.
    t.fail("meta:messaging-window-closed (code 10, subcode 2534022)");
    const closed = await reply({
      username: "sam",
      bandId: "band1",
      conversation,
      text: "late",
    });
    expect(closed.status).toBe(502);
    const explanation = (await closed.json()).error as string;
    expect(explanation).toMatch(/Messenger closed the reply window/);
    expect(explanation).toMatch(/24 hours/);
    expect(explanation).toMatch(/7 days/);
    expect(explanation).not.toContain("meta:");
    t.fail("");
    const stale = t.json("conversations/index");
    stale[conversation].lastIn = "2020-01-01T00:00:00Z";
    t.docs.set(indexPath, {
      body: new TextEncoder().encode(JSON.stringify(stale)),
      type: "application/json",
      etag: '"stale"',
    });
    const blocked = await reply({
      username: "sam",
      bandId: "band1",
      conversation,
      text: "too late",
    });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toMatch(/24 hours/);
    expect(t.sent).toHaveLength(2);
  } finally {
    t.stop();
  }
});

test("with META_HUMAN_AGENT a reply after 24 hours carries the tag, after 7 days it is blocked", async () => {
  const t = setup({ humanAgent: true });
  try {
    const conversation = conversationId("messenger", "band1", "psid-1");
    const seed = webhookBody("Hello");
    await fetch(t.url("/meta/webhook"), {
      method: "POST",
      body: seed,
      headers: { "X-Hub-Signature-256": sign(seed) },
    });
    const indexPath = "/storage/storage/sam/gigger/conversations/index";
    const setLastIn = (daysAgo: number) => {
      const index = t.json("conversations/index");
      index[conversation].lastIn = new Date(
        Date.now() - daysAgo * 86400000,
      ).toISOString();
      t.docs.set(indexPath, {
        body: new TextEncoder().encode(JSON.stringify(index)),
        type: "application/json",
        etag: `"${daysAgo}"`,
      });
    };
    const reply = () =>
      fetch(t.url("/messages/reply"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-token",
        },
        body: JSON.stringify({
          username: "sam",
          bandId: "band1",
          conversation,
          text: "Sorry for the wait",
        }),
      });
    setLastIn(2);
    const tagged = await reply();
    expect(tagged.status).toBe(200);
    expect((await tagged.json()).tag).toBe("HUMAN_AGENT");
    expect(t.sent[0].message.tag).toBe("HUMAN_AGENT");
    setLastIn(0.5);
    expect((await (await reply()).json()).tag).toBeUndefined();
    setLastIn(8);
    const blocked = await reply();
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toMatch(/7 days/);
    expect(t.sent).toHaveLength(2);
  } finally {
    t.stop();
  }
});

test("connecting a page stores the long-lived token and subscribes the app; disconnecting removes it", async () => {
  const calls: string[] = [];
  let unsubscribeFails = false;
  const graph = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      calls.push(`${req.method} ${url.pathname}`);
      if (url.pathname === "/oauth/access_token")
        return Response.json({ access_token: "long-user" });
      if (url.pathname === "/me") return Response.json({ id: "fb-user-1" });
      if (url.pathname === "/me/accounts" && !url.searchParams.has("after"))
        return Response.json({
          data: [{ id: "page-1", name: "Other Page", access_token: "p1" }],
          paging: { next: `${url.origin}/me/accounts?after=1` },
        });
      if (url.pathname === "/me/accounts")
        return Response.json({
          data: [
            {
              id: "page-2",
              name: "Band Page",
              access_token: "page-2-token",
              instagram_business_account: { id: "ig-2" },
            },
          ],
        });
      if (url.pathname === "/page-2/subscribed_apps")
        return unsubscribeFails && req.method === "DELETE"
          ? Response.json(
              { error: { message: "down", code: 2 } },
              { status: 500 },
            )
          : Response.json({ success: true });
      return Response.json({ error: { message: "nope" } }, { status: 400 });
    },
  });
  const armadietto = fakeArmadietto();
  const db = openDatabase(":memory:");
  const messages = messageHandler(
    db,
    stubSenders().senders,
    armadietto.server.url.origin,
    "http://app.test",
  );
  const meta = metaHandler(
    db,
    messages,
    {
      META_APP_ID: "app",
      META_APP_SECRET: secret,
      TOKEN_KEY: process.env.TOKEN_KEY,
    } as NodeJS.ProcessEnv,
    armadietto.server.url.origin,
    armadietto.server.url.origin,
    graph.url.origin,
  );
  const api = Bun.serve({
    port: 0,
    fetch: handler(db, undefined, undefined, messages, meta),
  });
  const post = (path: string, body: unknown, token = "user-token") =>
    fetch(new URL(path, api.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  try {
    expect(
      (
        await post(
          "/meta/connect",
          {
            username: "sam",
            bandId: "band1",
            accessToken: "short",
            pageId: "page-2",
          },
          "bad",
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await post(
          "/meta/connect",
          {
            username: "sam",
            bandId: "band1",
            accessToken: "short",
            pageId: "page-2",
          },
          "read-only",
        )
      ).status,
    ).toBe(401);
    // A malformed key is refused before any Page is subscribed or storage token minted.
    const badKey = metaHandler(
      db,
      messages,
      {
        META_APP_ID: "app",
        META_APP_SECRET: secret,
        TOKEN_KEY: "short",
      } as NodeJS.ProcessEnv,
      armadietto.server.url.origin,
      armadietto.server.url.origin,
      graph.url.origin,
    );
    expect(
      (
        await badKey.connect(
          new Request("http://api.test/meta/connect", {
            method: "POST",
            headers: { Authorization: "Bearer user-token" },
            body: JSON.stringify({
              username: "sam",
              bandId: "band1",
              accessToken: "short",
              pageId: "page-2",
            }),
          }),
        )
      ).status,
    ).toBe(503);
    expect(armadietto.minted).toHaveLength(0);
    const choose = await post("/meta/connect", {
      username: "sam",
      bandId: "band1",
      accessToken: "short",
    });
    expect(choose.status).toBe(409);
    expect(
      (await choose.json()).pages.map((p: { id: string }) => p.id),
    ).toEqual(["page-1", "page-2"]);
    const connected = await post("/meta/connect", {
      username: "sam",
      bandId: "band1",
      accessToken: "short",
      pageId: "page-2",
    });
    expect(await connected.json()).toEqual({
      pageId: "page-2",
      name: "Band Page",
      instagram: true,
    });
    expect(calls).toContain("POST /page-2/subscribed_apps");
    const rows = db
      .query<Record<string, string | null>, []>("SELECT * FROM meta_pages")
      .all();
    expect(rows[0].token).toStartWith("enc:");
    expect(
      rows.map(
        (row): Record<string, string | null> => ({
          ...row,
          token: unseal(row.token as string),
          storage_token: unseal(row.storage_token as string),
        }),
      ),
    ).toEqual([
      {
        page_id: "page-2",
        ig_id: "ig-2",
        username: "sam",
        band_id: "band1",
        token: "page-2-token",
        storage_token: "server-token",
        user_id: "fb-user-1",
      },
    ]);
    const page = await fetch(
      new URL("/meta/page?username=sam&bandId=band1", api.url),
      { headers: { Authorization: "Bearer user-token" } },
    );
    expect(await page.json()).toEqual({ pageId: "page-2", instagram: true });
    // Concurrent connects are serialized: the second band sees the Page taken, and only one token exists.
    await post("/meta/disconnect", { username: "sam", bandId: "band1" });
    armadietto.minted.length = 0;
    const race = await Promise.all([
      post("/meta/connect", {
        username: "sam",
        bandId: "band1",
        accessToken: "short",
        pageId: "page-2",
      }),
      post("/meta/connect", {
        username: "sam",
        bandId: "band2",
        accessToken: "short",
        pageId: "page-2",
      }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(armadietto.minted).toHaveLength(1);
    expect(db.query("SELECT band_id FROM meta_pages").all()).toEqual([
      { band_id: "band1" },
    ]);
    // Reconnecting the same Page keeps its storage token instead of minting an untracked one.
    await post("/meta/connect", {
      username: "sam",
      bandId: "band1",
      accessToken: "short",
      pageId: "page-2",
    });
    expect(armadietto.minted).toHaveLength(1);
    expect(
      (
        await post("/meta/connect", {
          username: "sam",
          bandId: "band2",
          accessToken: "short",
        })
      ).status,
    ).toBe(409);
    unsubscribeFails = true;
    expect(
      (await post("/meta/disconnect", { username: "sam", bandId: "band1" }))
        .status,
    ).toBe(503);
    expect(db.query("SELECT * FROM meta_pages").all()).toHaveLength(1);
    unsubscribeFails = false;
    expect(
      (await post("/meta/disconnect", { username: "sam", bandId: "band1" }))
        .status,
    ).toBe(200);
    expect(calls).toContain("DELETE /page-2/subscribed_apps");
    expect(db.query("SELECT * FROM meta_pages").all()).toEqual([]);
    // Meta's deauthorize and data-deletion callbacks remove the user's connections even when the Page token is already dead.
    await post("/meta/connect", {
      username: "sam",
      bandId: "band1",
      accessToken: "short",
      pageId: "page-2",
    });
    const callback = (path: string, body: string) =>
      fetch(new URL(path, api.url), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ signed_request: body }),
      });
    expect(
      (
        await callback(
          "/meta/deauthorize",
          `bad.${signedRequest({}).split(".")[1]}`,
        )
      ).status,
    ).toBe(400);
    expect(db.query("SELECT * FROM meta_pages").all()).toHaveLength(1);
    unsubscribeFails = true;
    const deleted = await callback(
      "/meta/data-deletion",
      signedRequest({ algorithm: "HMAC-SHA256", user_id: "fb-user-1" }),
    );
    expect(deleted.status).toBe(200);
    const receipt = await deleted.json();
    expect(receipt.url).toContain(
      `/api/meta/deletion-status?code=${receipt.confirmation_code}`,
    );
    expect(db.query("SELECT * FROM meta_pages").all()).toEqual([]);
    expect(
      (await fetch(new URL("/meta/deletion-status?code=x", api.url))).status,
    ).toBe(200);
    expect(parseSignedRequest(secret, "nope")).toBeNull();
  } finally {
    graph.stop(true);
    armadietto.stop();
    api.stop(true);
    db.close();
  }
});
