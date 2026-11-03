import type { Database } from "bun:sqlite";
import {
  type Channel,
  type ConversationIndex,
  conversationsPath,
  type Message,
  messagePath,
  replyBlocked,
  withMessage,
} from "@gigger/schemas";
import type { Sender } from "./sender";
import { type RemoteStore, remoteStore } from "./storage";

const context = (kind: string) =>
  `http://remotestorage.io/spec/modules/gigger/${kind}`;
const usernameRe = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const idRe = /^[A-Za-z0-9_-]+$/;

export function messageHandler(
  db: Database,
  senders: Record<Channel, Sender>,
  armadiettoUrl = process.env.ARMADIETTO_URL ?? "http://armadietto:8000",
  appOrigin = process.env.APP_ORIGIN ?? "http://localhost:8080",
) {
  const pageToken = db.query<
    { page_id: string; ig_id: string | null; token: string },
    [string, string]
  >(
    "SELECT page_id, ig_id, token FROM meta_pages WHERE username = ? AND band_id = ?",
  );
  const streams = new Map<string, Set<ReadableStreamDefaultController>>();
  function notify(username: string, message: Message) {
    const data = `data: ${JSON.stringify({ conversation: message.conversation, id: message.id })}\n\n`;
    for (const controller of streams.get(username) ?? [])
      try {
        controller.enqueue(data);
      } catch {
        streams.get(username)?.delete(controller);
      }
  }
  /** Stores the message once (a repeat delivery is a 412) and folds it into the index; the index step also runs on repeats so an earlier index failure heals. */
  async function save(store: RemoteStore, username: string, message: Message) {
    const status = await store.put(messagePath(message), {
      "@context": context("message"),
      ...message,
    });
    await store.update<ConversationIndex>(conversationsPath, (index) =>
      withMessage(index ?? {}, message),
    );
    if (status === 412) return false;
    notify(username, message);
    return true;
  }
  const fail = (error: string, status: number) =>
    Response.json(
      { error },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  /** Checks the token can read the band; with `write`, also that it may write, using an If-Match that can never match so nothing changes. */
  async function verified(
    req: Request,
    username: unknown,
    bandId: unknown,
    write = false,
  ) {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    if (
      typeof username !== "string" ||
      !usernameRe.test(username) ||
      typeof bandId !== "string" ||
      !idRe.test(bandId) ||
      !token
    )
      return null;
    const store = remoteStore(armadiettoUrl, username, token);
    try {
      const band = await store.get(`bands/${bandId}/band`);
      if (!band.value) return null;
      if (
        write &&
        (await store.put(
          `bands/${bandId}/band`,
          band.value,
          "application/json",
          '"none"',
        )) !== 412
      )
        return null;
    } catch {
      return null;
    }
    return store;
  }
  return {
    save,
    verified,
    /** POST /messages/reply {username, bandId, conversation, text} with the account's storage token. */
    async reply(req: Request) {
      if (req.headers.get("origin") && req.headers.get("origin") !== appOrigin)
        return fail("Invalid request origin.", 403);
      let input: Record<string, unknown>;
      try {
        input = await req.json();
      } catch {
        return fail("Invalid request.", 400);
      }
      const { username, bandId, conversation, text } = input ?? {};
      if (
        typeof conversation !== "string" ||
        !idRe.test(conversation) ||
        typeof text !== "string" ||
        !text.trim()
      )
        return fail("Invalid request.", 400);
      const store = await verified(req, username, bandId, true);
      if (!store) return fail("Log in again to send messages.", 401);
      let index: ConversationIndex | undefined;
      try {
        index = (await store.get<ConversationIndex>(conversationsPath)).value;
      } catch {
        return fail("Storage service unavailable. Please retry.", 503);
      }
      const thread = index?.[conversation];
      if (!thread || thread.bandId !== bandId)
        return fail("This conversation is not in your inbox.", 404);
      const blocked = replyBlocked(thread);
      if (blocked) return fail(blocked, 403);
      const page =
        thread.channel === "email"
          ? undefined
          : pageToken.get(username as string, bandId as string);
      if (thread.channel !== "email" && !page)
        return fail("Connect your Facebook Page before replying.", 409);
      if (thread.channel === "instagram" && !page?.ig_id)
        return fail("The connected Page has no Instagram account.", 409);
      const actorId =
        thread.channel === "instagram"
          ? (page?.ig_id as string)
          : (page?.page_id ?? (username as string));
      if (thread.account && thread.account !== actorId)
        return fail(
          "This conversation belongs to a Page that is no longer connected.",
          409,
        );
      const message: Message = {
        id: crypto.randomUUID(),
        channel: thread.channel,
        direction: "out",
        conversation,
        bandId: bandId as string,
        actor: { id: actorId },
        target: thread.peer,
        object: { type: "Note", content: text.trim() },
        published: new Date().toISOString(),
      };
      const markFailed = async (error: string) => {
        const { etag } = await store.get(messagePath(message));
        if (etag)
          await store.put(
            messagePath(message),
            { "@context": context("message"), ...message, error },
            "application/json",
            etag,
          );
      };
      try {
        await save(store, username as string, message);
      } catch {
        // The message may be stored while the index failed; flag it so it never reads as sent.
        await markFailed("Not sent: storage error").catch(() => {});
        return fail("Storage service unavailable. Please retry.", 503);
      }
      try {
        await senders[thread.channel].send(
          message,
          page ? { access_token: page.token } : undefined,
        );
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : "Send failed";
        await markFailed(error);
        return fail(`Saved, but not delivered: ${error}`, 502);
      }
      return Response.json(message, {
        headers: { "Cache-Control": "no-store" },
      });
    },
    /** GET /messages/events?username&bandId&token — EventSource cannot send headers, so the token travels as a query parameter. */
    async events(req: Request) {
      const { searchParams } = new URL(req.url);
      const username = searchParams.get("username");
      const authed = new Request(req.url, {
        headers: { Authorization: `Bearer ${searchParams.get("token")}` },
      });
      if (!(await verified(authed, username, searchParams.get("bandId"))))
        return fail("Log in again to receive messages.", 401);
      let keepAlive: ReturnType<typeof setInterval>;
      let self: ReadableStreamDefaultController;
      const stream = new ReadableStream({
        start(controller) {
          self = controller;
          controller.enqueue(": connected\n\n");
          const set = streams.get(username as string) ?? new Set();
          streams.set(username as string, set.add(controller));
          keepAlive = setInterval(
            () => controller.enqueue(": ping\n\n"),
            25000,
          );
        },
        cancel() {
          clearInterval(keepAlive);
          streams.get(username as string)?.delete(self);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        },
      });
    },
  };
}
export type Messages = ReturnType<typeof messageHandler>;
