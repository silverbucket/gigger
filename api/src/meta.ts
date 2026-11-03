import type { Database } from "bun:sqlite";
import {
  type Attachment,
  attachmentPath,
  type Channel,
  conversationId,
  type Message,
} from "@gigger/schemas";
import type { Messages } from "./messages";
import { remoteStore } from "./storage";

const graph = "https://graph.facebook.com/v21.0";
const noStore = { "Cache-Control": "no-store" };

export function validSignature(
  secret: string,
  rawBody: string,
  header: string | null,
) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = new Bun.CryptoHasher("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const given = header.slice(7);
  return (
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
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
    conversation: conversationId(channel, peer.id),
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
};
export function metaHandler(
  db: Database,
  messages: Messages,
  env = process.env,
  armadiettoUrl = env.ARMADIETTO_URL ?? "http://armadietto:8000",
  internalUrl = env.ARMADIETTO_AUTH_URL ?? "http://armadietto:8001",
  graphUrl = graph,
) {
  const byPage = db.query<PageRow, [string]>(
    "SELECT * FROM meta_pages WHERE page_id = ?",
  );
  const byIg = db.query<PageRow, [string]>(
    "SELECT * FROM meta_pages WHERE ig_id = ?",
  );
  const byBand = db.query<PageRow, [string, string]>(
    "SELECT * FROM meta_pages WHERE username = ? AND band_id = ?",
  );
  const fail = (error: string, status: number) =>
    Response.json({ error }, { status, headers: noStore });
  const fb = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${graphUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
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
  /** Unsubscribes the Page and revokes its storage token; the row stays until both succeed. Error code 190 means the Page token is already dead. */
  async function release(row: PageRow) {
    try {
      await fb(
        `/${row.page_id}/subscribed_apps?access_token=${encodeURIComponent(row.token)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 190)
        throw new Error("Could not unsubscribe from Facebook. Please retry.");
    }
    const revoked = await hook("logout", {
      username: row.username,
      token: row.storage_token,
    }).catch(() => null);
    if (!revoked?.ok) throw new Error("Could not disconnect. Please retry.");
    db.query("DELETE FROM meta_pages WHERE page_id = ?").run(row.page_id);
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
        const row =
          channel === "messenger" ? byPage.get(entry.id) : byIg.get(entry.id);
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
      });
    },
    /** GET /meta/page?username&bandId with Bearer token: the connected page, if any. */
    async page(req: Request) {
      const q = new URL(req.url).searchParams;
      const username = q.get("username");
      const bandId = q.get("bandId");
      if (!(await messages.verified(req, username, bandId)))
        return fail("Log in again.", 401);
      const row = byBand.get(username as string, bandId as string);
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
      if (!env.META_APP_ID || !env.META_APP_SECRET)
        return fail("Facebook is not configured on this server.", 503);
      try {
        const longLived = await fb(
          `/oauth/access_token?grant_type=fb_exchange_token&client_id=${env.META_APP_ID}&client_secret=${env.META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(accessToken)}`,
        );
        const { data: pages } = (await fb(
          `/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(longLived.access_token)}`,
        )) as {
          data: {
            id: string;
            name: string;
            access_token: string;
            instagram_business_account?: { id: string };
          }[];
        };
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
        const owner = byPage.get(page.id);
        if (owner && (owner.username !== username || owner.band_id !== bandId))
          return fail("This Page is already connected to another band.", 409);
        const existing = byBand.get(username as string, bandId as string);
        // Switching Pages releases the old one first; reconnecting the same Page keeps its storage token.
        if (existing && existing.page_id !== page.id) await release(existing);
        await fb(
          `/${page.id}/subscribed_apps?subscribed_fields=messages,message_echoes&access_token=${encodeURIComponent(page.access_token)}`,
          { method: "POST" },
        );
        let token = existing?.page_id === page.id ? existing.storage_token : "";
        if (!token) {
          const minted = await hook("token", { username });
          if (!minted.ok) throw new Error("Could not create a storage token");
          token = (await minted.json()).token;
        }
        db.query(
          "INSERT OR REPLACE INTO meta_pages (page_id, ig_id, username, band_id, token, storage_token) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(
          page.id,
          page.instagram_business_account?.id ?? null,
          username as string,
          bandId as string,
          page.access_token,
          token,
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
      const row = byBand.get(username as string, bandId as string);
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
    },
  };
}
