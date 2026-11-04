import type { Database } from "bun:sqlite";
import {
  type Attachment,
  attachmentPath,
  type Channel,
  conversationId,
  type Message,
} from "@gigger/schemas";
import type { Messages } from "./messages";
import { seal, unseal, validKey } from "./secrets";
import { remoteStore } from "./storage";

/** The one Graph API version the server and the browser SDK use. */
export const graphVersion = "v26.0";
const graph = `https://graph.facebook.com/${graphVersion}`;
const noStore = { "Cache-Control": "no-store" };

export function validSignature(
  secret: string,
  rawBody: string,
  header: string | null,
) {
  if (!header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = new Bun.CryptoHasher("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const given = header.slice(7);
  return (
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}
/** Meta's deauthorize and data-deletion callbacks post a `signed_request`: base64url(HMAC-SHA256).base64url(JSON with user_id). */
export function parseSignedRequest(secret: string, signedRequest: string) {
  const [signature, payload] = signedRequest.split(".");
  if (!signature || !payload) return null;
  const given = Buffer.from(signature, "base64url");
  const expected = new Bun.CryptoHasher("sha256", secret)
    .update(payload)
    .digest();
  if (
    given.length !== expected.length ||
    !crypto.timingSafeEqual(given, expected)
  )
    return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof data?.user_id === "string"
      ? (data as { user_id: string })
      : null;
  } catch {
    return null;
  }
}

interface Event {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    app_id?: number | string;
    attachments?: { type: string; payload?: { url?: string } }[];
  };
}
/** Turns one webhook messaging event into a stored message; echoes are our own outgoing messages. */
export function fromWebhook(
  channel: Channel,
  bandId: string,
  event: Event,
  ownAppId?: string,
): Message | null {
  if (!event.message?.mid) return null;
  const out = event.message.is_echo === true;
  // Echoes of replies this app sent are already stored by the reply endpoint.
  if (out && ownAppId && String(event.message.app_id ?? "") === ownAppId)
    return null;
  const peer = out ? event.recipient : event.sender;
  return {
    id: event.message.mid.replace(/[^A-Za-z0-9_-]/g, "_"),
    channel,
    direction: out ? "out" : "in",
    conversation: conversationId(channel, bandId, peer.id),
    bandId,
    actor: { id: event.sender.id },
    target: { id: event.recipient.id },
    object: {
      type: "Note",
      content: event.message.text ?? "",
      ...(event.message.attachments?.length
        ? {
            attachment: event.message.attachments.flatMap((a) =>
              a.payload?.url ? [{ type: a.type, url: a.payload.url }] : [],
            ),
          }
        : {}),
    },
    published: new Date(event.timestamp).toISOString(),
    received: new Date().toISOString(),
  };
}

type PageRow = {
  page_id: string;
  ig_id: string | null;
  username: string;
  band_id: string;
  token: string;
  storage_token: string;
  user_id: string | null;
};
export function metaHandler(
  db: Database,
  messages: Messages,
  env = process.env,
  armadiettoUrl = env.ARMADIETTO_URL ?? "http://armadietto:8000",
  internalUrl = env.ARMADIETTO_AUTH_URL ?? "http://armadietto:8001",
  graphUrl = graph,
) {
  const opened = (row: PageRow | null) =>
    row && {
      ...row,
      token: unseal(row.token, env),
      storage_token: unseal(row.storage_token, env),
    };
  const byPage = (pageId: string) =>
    opened(
      db
        .query<PageRow, [string]>("SELECT * FROM meta_pages WHERE page_id = ?")
        .get(pageId),
    );
  const byIg = (igId: string) =>
    opened(
      db
        .query<PageRow, [string]>("SELECT * FROM meta_pages WHERE ig_id = ?")
        .get(igId),
    );
  const byBand = (username: string, bandId: string) =>
    opened(
      db
        .query<PageRow, [string, string]>(
          "SELECT * FROM meta_pages WHERE username = ? AND band_id = ?",
        )
        .get(username, bandId),
    );
  const byUser = (userId: string) =>
    db
      .query<PageRow, [string]>("SELECT * FROM meta_pages WHERE user_id = ?")
      .all(userId)
      .map((row) => opened(row) as PageRow);
  const fail = (error: string, status: number) =>
    Response.json({ error }, { status, headers: noStore });
  const fb = async (path: string, init?: RequestInit) => {
    const response = await fetch(
      /^https?:/.test(path) ? path : `${graphUrl}${path}`,
      {
        ...init,
        signal: AbortSignal.timeout(15000),
      },
    );
    const body = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(body?.error?.message ?? "Facebook request failed"),
        { code: body?.error?.code },
      );
    return body;
  };
  const hook = (action: string, body: unknown) =>
    fetch(`${internalUrl}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  /** Unsubscribes the Page and revokes its storage token; the row stays until both succeed. Error code 190 means the Page token is already dead; after a deauthorization (`force`) every Graph error is expected. */
  async function release(row: PageRow, force = false) {
    try {
      await fb(
        `/${row.page_id}/subscribed_apps?access_token=${encodeURIComponent(row.token)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      if (!force && (error as { code?: number }).code !== 190)
        throw new Error("Could not unsubscribe from Facebook. Please retry.");
    }
    const revoked = await hook("logout", {
      username: row.username,
      token: row.storage_token,
    }).catch(() => null);
    if (!revoked?.ok) throw new Error("Could not disconnect. Please retry.");
    db.query("DELETE FROM meta_pages WHERE page_id = ?").run(row.page_id);
  }
  // Connect and disconnect run one at a time so two requests cannot both see "no connection" and mint twice.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>) {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  }
  async function store(row: PageRow, message: Message) {
    const rs = remoteStore(armadiettoUrl, row.username, row.storage_token);
    const copies: Attachment[] = [];
    for (const [n, attachment] of (message.object.attachment ?? []).entries()) {
      let file: Response | undefined;
      try {
        file = await fetch(attachment.url, {
          signal: AbortSignal.timeout(20000),
        });
      } catch {}
      if (!file?.ok) {
        copies.push(attachment); // keep the original CDN link rather than lose the attachment
        continue;
      }
      const mediaType =
        file.headers.get("content-type") ?? "application/octet-stream";
      const path = attachmentPath(message, n);
      // A failed storage write propagates so the webhook answers 500 and Meta redelivers.
      await rs.put(path, new Uint8Array(await file.arrayBuffer()), mediaType);
      copies.push({ ...attachment, url: `gigger/${path}`, mediaType });
    }
    if (copies.length) message.object.attachment = copies;
    if (
      message.direction === "in" &&
      !(await rs.get<Record<string, unknown>>("conversations/index")).value?.[
        message.conversation
      ]
    )
      try {
        const profile = await fb(
          `/${message.actor.id}?fields=name&access_token=${encodeURIComponent(row.token)}`,
        );
        if (typeof profile.name === "string") message.actor.name = profile.name;
      } catch {}
    await messages.save(rs, row.username, message);
  }
  return {
    /** GET /meta/webhook verification and POST /meta/webhook deliveries. */
    async webhook(req: Request) {
      if (req.method === "GET") {
        const q = new URL(req.url).searchParams;
        return q.get("hub.mode") === "subscribe" &&
          env.META_VERIFY_TOKEN &&
          q.get("hub.verify_token") === env.META_VERIFY_TOKEN
          ? new Response(q.get("hub.challenge") ?? "")
          : new Response("Forbidden", { status: 403 });
      }
      const raw = await req.text();
      if (
        !env.META_APP_SECRET ||
        !validSignature(
          env.META_APP_SECRET,
          raw,
          req.headers.get("x-hub-signature-256"),
        )
      )
        return new Response("Invalid signature", { status: 401 });
      let body: {
        object?: string;
        entry?: { id: string; messaging?: Event[] }[];
      };
      try {
        body = JSON.parse(raw);
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      const channel: Channel | null =
        body.object === "page"
          ? "messenger"
          : body.object === "instagram"
            ? "instagram"
            : null;
      if (!channel) return new Response("EVENT_RECEIVED");
      let failed = false;
      for (const entry of body.entry ?? []) {
        const row = channel === "messenger" ? byPage(entry.id) : byIg(entry.id);
        if (!row) continue;
        for (const event of entry.messaging ?? []) {
          const message = fromWebhook(
            channel,
            row.band_id,
            event,
            env.META_APP_ID,
          );
          if (message)
            try {
              await store(row, message);
            } catch (error) {
              failed = true;
              console.error("Could not store message", message.id, error);
            }
        }
      }
      // A 500 makes Meta redeliver; stored events are then skipped by their 412.
      return failed
        ? new Response("Storage unavailable", { status: 500 })
        : new Response("EVENT_RECEIVED");
    },
    /** GET /meta/config: what the browser needs to start Facebook Login for Business. */
    config() {
      return Response.json({
        appId: env.META_APP_ID ?? "",
        configId: env.META_CONFIG_ID ?? "",
        graphVersion,
        humanAgent: env.META_HUMAN_AGENT === "1",
      });
    },
    /** GET /meta/page?username&bandId with Bearer token: the connected page, if any. */
    async page(req: Request) {
      const q = new URL(req.url).searchParams;
      const username = q.get("username");
      const bandId = q.get("bandId");
      if (!(await messages.verified(req, username, bandId)))
        return fail("Log in again.", 401);
      const row = byBand(username as string, bandId as string);
      return Response.json(
        row ? { pageId: row.page_id, instagram: !!row.ig_id } : null,
        { headers: noStore },
      );
    },
    /** POST /meta/connect {username, bandId, accessToken, pageId?}: swap for a long-lived Page token, store it, subscribe the app. */
    async connect(req: Request) {
      let input: Record<string, unknown>;
      try {
        input = await req.json();
      } catch {
        return fail("Invalid request.", 400);
      }
      const { username, bandId, accessToken, pageId } = input ?? {};
      if (typeof accessToken !== "string" || !accessToken)
        return fail("Invalid request.", 400);
      if (!(await messages.verified(req, username, bandId, true)))
        return fail("Log in again to connect a page.", 401);
      if (!env.META_APP_ID || !env.META_APP_SECRET || !validKey(env))
        return fail("Facebook is not configured on this server.", 503);
      return serial(async () => {
        try {
          const longLived = await fb(
            `/oauth/access_token?grant_type=fb_exchange_token&client_id=${env.META_APP_ID}&client_secret=${env.META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(accessToken)}`,
          );
          type Page = {
            id: string;
            name: string;
            access_token: string;
            instagram_business_account?: { id: string };
          };
          const pages: Page[] = [];
          let next: string | undefined =
            `/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(longLived.access_token)}`;
          while (next && pages.length < 500) {
            const batch: { data: Page[]; paging?: { next?: string } } =
              await fb(next);
            pages.push(...batch.data);
            next = batch.paging?.next;
          }
          const page = pageId
            ? pages.find((p) => p.id === pageId)
            : pages.length === 1
              ? pages[0]
              : undefined;
          if (!page)
            return Response.json(
              {
                error: pages.length
                  ? "Choose a page."
                  : "No Facebook Pages found for this login.",
                pages: pages.map(({ id, name }) => ({ id, name })),
              },
              { status: 409, headers: noStore },
            );
          const me = await fb(
            `/me?fields=id&access_token=${encodeURIComponent(longLived.access_token)}`,
          );
          const owner = byPage(page.id);
          if (
            owner &&
            (owner.username !== username || owner.band_id !== bandId)
          )
            return fail("This Page is already connected to another band.", 409);
          const existing = byBand(username as string, bandId as string);
          // Switching Pages releases the old one first; reconnecting the same Page keeps its storage token.
          if (existing && existing.page_id !== page.id) await release(existing);
          await fb(
            `/${page.id}/subscribed_apps?subscribed_fields=messages,message_echoes&access_token=${encodeURIComponent(page.access_token)}`,
            { method: "POST" },
          );
          let token =
            existing?.page_id === page.id ? existing.storage_token : "";
          if (!token) {
            const minted = await hook("token", { username });
            if (!minted.ok) throw new Error("Could not create a storage token");
            token = (await minted.json()).token;
          }
          db.query(
            "INSERT OR REPLACE INTO meta_pages (page_id, ig_id, username, band_id, token, storage_token, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ).run(
            page.id,
            page.instagram_business_account?.id ?? null,
            username as string,
            bandId as string,
            seal(page.access_token, env),
            seal(token, env),
            String(me.id),
          );
          return Response.json(
            {
              pageId: page.id,
              name: page.name,
              instagram: !!page.instagram_business_account,
            },
            { headers: noStore },
          );
        } catch (cause) {
          return fail(
            cause instanceof Error
              ? cause.message
              : "Could not connect the page.",
            502,
          );
        }
      });
    },
    /** POST /meta/disconnect {username, bandId} */
    async disconnect(req: Request) {
      let input: Record<string, unknown>;
      try {
        input = await req.json();
      } catch {
        return fail("Invalid request.", 400);
      }
      const { username, bandId } = input ?? {};
      if (!(await messages.verified(req, username, bandId, true)))
        return fail("Log in again.", 401);
      return serial(async () => {
        const row = byBand(username as string, bandId as string);
        if (row)
          try {
            await release(row);
          } catch (cause) {
            return fail(
              cause instanceof Error ? cause.message : "Could not disconnect.",
              503,
            );
          }
        return Response.json({ ok: true }, { headers: noStore });
      });
    },
    /** POST /meta/deauthorize and POST /meta/data-deletion from Meta: drop every Page connection of that Facebook user. Data deletion also answers with a status URL and confirmation code, as App Review requires. */
    async deauthorize(req: Request, deletion = false) {
      const form = await req.formData().catch(() => null);
      const signed = form?.get("signed_request");
      const user =
        env.META_APP_SECRET && typeof signed === "string"
          ? parseSignedRequest(env.META_APP_SECRET, signed)
          : null;
      if (!user) return fail("Invalid signed request.", 400);
      return serial(async () => {
        for (const row of byUser(user.user_id))
          try {
            await release(row, true);
          } catch (error) {
            console.error("Could not release page", row.page_id, error);
            return fail("Could not release the page.", 500);
          }
        const code = crypto.randomUUID();
        return Response.json(
          deletion
            ? {
                url: `${env.APP_ORIGIN ?? "http://localhost:8080"}/api/meta/deletion-status?code=${code}`,
                confirmation_code: code,
              }
            : { ok: true },
          { headers: noStore },
        );
      });
    },
    /** GET /meta/deletion-status?code: deletion happens inside the callback, so every code is complete. */
    deletionStatus() {
      return new Response(
        "Gigger removed the Facebook Page connection and the tokens it held for this account.",
      );
    },
  };
}
