import { expect, test } from "bun:test";
import {
  type Conversation,
  conversationId,
  emailReplyHeaders,
  type Message,
  withMessage,
} from "@showday/schemas";
import { openDatabase } from "../src/db";
import {
  emailAccounts,
  emailHandler,
  parseSettings,
  receiveCredentials,
  sendCredentials,
} from "../src/email";
import { friendlyMailError, fromMail, textFromHtml } from "../src/mailbox";
import { messageHandler } from "../src/messages";
import { handler } from "../src/server";

process.env.TOKEN_KEY = "0f".repeat(32);

const valid = {
  address: "Band@Example.com",
  name: "The Band",
  imapHost: "imap.example.com",
  imapPort: "993",
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  login: "band@example.com",
  password: "app-password",
};

test("settings are validated, normalised and turned into Sockethub credentials", () => {
  const settings = parseSettings(valid);
  expect(settings).toEqual({
    address: "band@example.com",
    name: "The Band",
    imapHost: "imap.example.com",
    imapPort: 993,
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    login: "band@example.com",
    password: "app-password",
  });
  if (typeof settings === "string") throw new Error(settings);
  expect(sendCredentials(settings)).toEqual({
    from: "band@example.com",
    smtp: {
      host: "smtp.example.com",
      port: 587,
      secure: false,
      username: "band@example.com",
      password: "app-password",
    },
  });
  expect(receiveCredentials(settings).imap).toMatchObject({
    host: "imap.example.com",
    port: 993,
    secure: true,
  });
  // Implicit TLS on 465 and 993, STARTTLS on everything else.
  expect(
    sendCredentials({ ...settings, smtpPort: 465 }).smtp.secure,
  ).toBeTrue();
  expect(
    receiveCredentials({ ...settings, imapPort: 143 }).imap.secure,
  ).toBeFalse();
  // Defaults, a send-only account, and a kept password on update.
  expect(
    parseSettings({ ...valid, imapHost: "", imapPort: "", smtpPort: "" }),
  ).toMatchObject({ imapPort: 993, smtpPort: 587 });
  expect(parseSettings({ ...valid, imapHost: "" })).not.toHaveProperty(
    "imapHost",
  );
  expect(
    parseSettings({ ...valid, password: "" }, {
      ...(parseSettings(valid) as object),
      password: "kept",
    } as never),
  ).toMatchObject({ password: "kept" });
  expect(parseSettings({ ...valid, address: "nope" })).toMatch(/address/);
  expect(parseSettings({ ...valid, smtpHost: "" })).toMatch(/SMTP/);
  expect(parseSettings({ ...valid, imapHost: "bad host" })).toMatch(/IMAP/);
  expect(parseSettings({ ...valid, smtpPort: 70000 })).toMatch(/Ports/);
  expect(parseSettings({ ...valid, login: "" })).toMatch(/login/);
  expect(parseSettings({ ...valid, password: "" })).toMatch(/password/);
  expect(parseSettings({ ...valid, name: "x".repeat(201) })).toMatch(/name/);
});

test("incoming email carries its thread into the index and the reply answers it", () => {
  const conversation = conversationId("email", "b", "jo@example.com");
  const incoming: Message = {
    id: "mail-1",
    channel: "email",
    direction: "in",
    conversation,
    bandId: "b",
    actor: { id: "jo@example.com", name: "Jo" },
    target: { id: "band@example.com" },
    object: { type: "Note", content: "Free in May?" },
    published: "2025-03-01T10:00:00.000Z",
    subject: "Booking for May?",
    messageId: "<jo-2@example.com>",
    inReplyTo: "<jo-1@example.com>",
    references: ["<jo-1@example.com>"],
  };
  const index = withMessage({}, incoming);
  expect(index[conversation]).toMatchObject({
    subject: "Booking for May?",
    messageId: "<jo-2@example.com>",
    references: ["<jo-1@example.com>"],
  });
  const headers = emailReplyHeaders(index[conversation], "Message from Band");
  expect(headers).toEqual({
    subject: "Re: Booking for May?",
    inReplyTo: "<jo-2@example.com>",
    references: ["<jo-1@example.com>", "<jo-2@example.com>"],
  });
  // Our reply keeps the thread state; an older inbound message does not replace a newer one.
  const reply: Message = {
    ...incoming,
    id: "out-1",
    direction: "out",
    actor: incoming.target,
    target: incoming.actor,
    published: "2025-03-01T11:00:00.000Z",
    ...headers,
  };
  const afterReply = withMessage(index, reply);
  expect(afterReply[conversation].messageId).toBe("<jo-2@example.com>");
  const older = withMessage(afterReply, {
    ...incoming,
    id: "mail-0",
    published: "2025-02-01T10:00:00.000Z",
    messageId: "<jo-1@example.com>",
  });
  expect(older[conversation].messageId).toBe("<jo-2@example.com>");
  // Subjects already marked as replies are not doubled; a thread without headers gets the fallback.
  expect(
    emailReplyHeaders(
      { ...index[conversation], subject: "RE: Booking" } as Conversation,
      "x",
    ).subject,
  ).toBe("RE: Booking");
  expect(
    emailReplyHeaders(
      { bandId: "b", channel: "email", peer: { id: "jo" }, preview: "" },
      "Message from Band",
    ),
  ).toEqual({ subject: "Message from Band" });
});

test("a Sockethub post becomes a stored message; our own copies and junk are skipped", () => {
  const account = {
    bandId: "b",
    settings: {
      address: "band@example.com",
      imapPort: 993,
      smtpHost: "s",
      smtpPort: 587,
      login: "l",
      password: "p",
    },
  };
  const now = new Date("2025-03-01T12:00:00.000Z");
  const message = fromMail(
    account,
    {
      "@context": ["https://sockethub.org/ns/context/platform/email/v1.jsonld"],
      type: "post",
      actor: { id: "Jo@Example.com", name: " Jo " },
      object: {
        type: "message",
        id: "email:band%40example.com:INBOX:17:42",
        subject: "Booking for May?",
        messageId: "<jo-2@example.com>",
        inReplyTo: "<jo-1@example.com>",
        references: ["<jo-1@example.com>", 7, "bad\r\nid"],
        published: "2025-03-01T10:00:00.000Z",
        content: "",
        html: "<p>Free in <b>May</b>?</p><style>p{}</style><br>Jo &amp; co",
        attachments: [
          { contentType: "application/pdf", filename: "rider.pdf" },
        ],
      },
    },
    now,
  );
  expect(message).toEqual({
    id: "email_band_40example_com_INBOX_17_42",
    channel: "email",
    direction: "in",
    conversation: conversationId("email", "b", "jo@example.com"),
    bandId: "b",
    actor: { id: "jo@example.com", name: "Jo" },
    target: { id: "band@example.com" },
    object: {
      type: "Note",
      content: "Free in May?\n\nJo & co\n\n[1 attachment left in the mailbox]",
    },
    published: "2025-03-01T10:00:00.000Z",
    received: "2025-03-01T12:00:00.000Z",
    subject: "Booking for May?",
    messageId: "<jo-2@example.com>",
    inReplyTo: "<jo-1@example.com>",
    references: ["<jo-1@example.com>"],
  });
  expect(
    fromMail(account, {
      type: "post",
      actor: { id: "band@example.com" },
      object: { id: "x", content: "to myself" },
    }),
  ).toBeNull();
  expect(
    fromMail(account, {
      type: "post",
      actor: { id: "nobody" },
      object: { id: "x" },
    }),
  ).toBeNull();
  expect(
    fromMail(
      account,
      {
        type: "post",
        actor: { id: "jo@example.com" },
        object: { id: "big", bodyOmitted: true, published: "not a date" },
      },
      now,
    ),
  ).toMatchObject({
    object: { content: "(This email is too large to show here.)" },
    published: now.toISOString(),
  });
  expect(textFromHtml("<div>a</div><div>b</div>")).toBe("a\nb");
  expect(friendlyMailError("email:connect-failed")).toMatch(/sign in/);
  expect(friendlyMailError("email:submission-failed-or-uncertain; x")).toMatch(
    /Sent folder/,
  );
  expect(friendlyMailError("email:odd-thing; details")).toBe(
    "Mail server problem (odd-thing).",
  );
  expect(friendlyMailError("plain")).toBe("plain");
});

/** Just enough remoteStorage for the handler's permission checks, plus the account service hooks. */
function fakeArmadietto() {
  const minted: string[] = [];
  const revoked: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/token") {
        const token = `storage-${minted.length + 1}`;
        minted.push(token);
        return Response.json({ token });
      }
      if (path === "/logout") {
        revoked.push(((await req.json()) as { token: string }).token);
        return Response.json({ ok: true });
      }
      const auth = req.headers.get("authorization");
      if (!["Bearer user-token", "Bearer read-only"].includes(auth ?? ""))
        return new Response("", { status: 401 });
      if (/\/showday\/bands\/band1\/band$/.test(path))
        return req.method === "GET"
          ? Response.json({ id: "band1", name: "The Band" })
          : new Response("", {
              status: auth === "Bearer read-only" ? 403 : 412,
            });
      return new Response("", { status: 404 });
    },
  });
  return { server, minted, revoked, stop: () => server.stop(true) };
}

test("email account settings are stored encrypted, read back without the password, restart the watcher and can be removed", async () => {
  const armadietto = fakeArmadietto();
  const db = openDatabase(":memory:");
  const restarted: string[] = [];
  const stopped: string[] = [];
  const messages = messageHandler(
    db,
    {
      email: { send: async () => {} },
      messenger: { send: async () => {} },
      instagram: { send: async () => {} },
    },
    armadietto.server.url.origin,
    "http://app.test",
  );
  const watchers = {
    restart: (u: string, b: string) => void restarted.push(`${u}/${b}`),
    stop: (u: string, b: string) => void stopped.push(`${u}/${b}`),
  };
  const email = emailHandler(
    db,
    messages,
    watchers,
    process.env,
    armadietto.server.url.origin,
  );
  const api = Bun.serve({
    port: 0,
    fetch: handler(
      db,
      undefined,
      undefined,
      messages,
      undefined,
      watchers,
      email,
    ),
  });
  const call = (method: string, body?: unknown, token = "user-token") =>
    fetch(
      new URL(
        method === "GET"
          ? "/email/account?username=sam&bandId=band1"
          : "/email/account",
        api.url,
      ),
      {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
  try {
    expect(await (await call("GET")).json()).toBeNull();
    expect((await call("GET", undefined, "bad")).status).toBe(401);
    const account = { username: "sam", bandId: "band1" };
    expect(
      (await call("PUT", { ...account, ...valid }, "read-only")).status,
    ).toBe(401);
    expect(
      (await call("PUT", { ...account, ...valid, smtpHost: "" })).status,
    ).toBe(400);
    const saved = await call("PUT", { ...account, ...valid });
    expect(saved.status).toBe(200);
    const shown = await saved.json();
    expect(shown).toEqual({
      address: "band@example.com",
      name: "The Band",
      imapHost: "imap.example.com",
      imapPort: 993,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      login: "band@example.com",
      watching: true,
    });
    expect(JSON.stringify(shown)).not.toContain("app-password");
    expect(restarted).toEqual(["sam/band1"]);
    expect(armadietto.minted).toEqual(["storage-1"]);
    // Nothing secret sits in the database in clear text.
    const row = db
      .query<{ settings: string; storage_token: string; address: string }, []>(
        "SELECT settings, storage_token, address FROM email_accounts",
      )
      .get() as { settings: string; storage_token: string; address: string };
    expect(row.address).toBe("band@example.com");
    expect(row.settings).toStartWith("enc:");
    expect(row.settings).not.toContain("app-password");
    expect(row.settings).not.toContain("smtp.example.com");
    expect(row.storage_token).toStartWith("enc:");
    const accounts = emailAccounts(db);
    expect(accounts.get("sam", "band1")?.settings.password).toBe(
      "app-password",
    );
    expect(accounts.get("sam", "band1")?.storageToken).toBe("storage-1");
    // Updating without a password keeps the old one and the storage token; the same mailbox keeps its cursor, another loses it.
    accounts.cursor("sam", "band1", { uidValidity: "1", uid: 5 });
    accounts.error("sam", "band1", "Could not sign in to the mailbox.");
    expect((await call("GET")).ok).toBeTrue();
    expect((await (await call("GET")).json()).error).toMatch(/sign in/);
    const updated = await call("PUT", {
      ...account,
      ...valid,
      name: "Renamed",
      password: "",
    });
    expect(updated.status).toBe(200);
    expect(accounts.get("sam", "band1")).toMatchObject({
      settings: { name: "Renamed", password: "app-password" },
      storageToken: "storage-1",
      cursor: { uidValidity: "1", uid: 5 },
    });
    expect(accounts.get("sam", "band1")?.error).toBeUndefined();
    expect(armadietto.minted).toHaveLength(1);
    await call("PUT", { ...account, ...valid, imapHost: "other.example.com" });
    expect(accounts.get("sam", "band1")?.cursor).toBeUndefined();
    expect(restarted).toHaveLength(3);
    // Removal stops the watcher, revokes the storage token and forgets everything.
    expect((await call("DELETE", account)).status).toBe(200);
    expect(stopped).toEqual(["sam/band1"]);
    expect(armadietto.revoked).toEqual(["storage-1"]);
    expect(accounts.all()).toEqual([]);
    expect(await (await call("GET")).json()).toBeNull();
    expect((await call("DELETE", account)).status).toBe(200);
  } finally {
    api.stop(true);
    armadietto.stop();
    db.close();
  }
});

test("without TOKEN_KEY the server refuses to store mail settings", async () => {
  const armadietto = fakeArmadietto();
  const db = openDatabase(":memory:");
  const messages = messageHandler(
    db,
    {
      email: { send: async () => {} },
      messenger: { send: async () => {} },
      instagram: { send: async () => {} },
    },
    armadietto.server.url.origin,
    "http://app.test",
  );
  const email = emailHandler(
    db,
    messages,
    { restart() {}, stop() {} },
    { TOKEN_KEY: "" } as NodeJS.ProcessEnv,
    armadietto.server.url.origin,
  );
  try {
    const response = await email.put(
      new Request("http://api.test/email/account", {
        method: "PUT",
        headers: { Authorization: "Bearer user-token" },
        body: JSON.stringify({ username: "sam", bandId: "band1", ...valid }),
      }),
    );
    expect(response.status).toBe(503);
  } finally {
    armadietto.stop();
    db.close();
  }
});
