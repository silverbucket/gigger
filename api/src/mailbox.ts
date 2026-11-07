import { conversationId, type Message } from "@showday/schemas";
import SockethubClient from "@sockethub/client";
import { resolveAppOrigin } from "./app-origin";
import {
  type EmailAccount,
  type EmailAccounts,
  type InboxWatchStatus,
  receiveCredentials,
} from "./email";
import type { Messages } from "./messages";
import { remoteStore } from "./storage";

/** A `post` activity from Sockethub's email platform, as far as the inbox uses it. */
interface MailPost {
  "@context"?: string[];
  type?: string;
  error?: string;
  actor?: { id?: string; name?: string };
  to?: unknown;
  cc?: unknown;
  object?: {
    type?: string;
    id?: string;
    subject?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: unknown;
    published?: string;
    content?: string;
    html?: string;
    bodyOmitted?: boolean;
    attachments?: unknown[];
    cursor?: { uidValidity: string; uid: number };
    to?: unknown;
    cc?: unknown;
  };
}
/** Pulls a normalised address out of mailto ids, `Name <email>` strings, or plain emails. */
export function normalizeMailAddress(value: string): string | undefined {
  let email = value.trim();
  if (!email) return undefined;
  if (/^mailto:/i.test(email)) email = email.slice(7).trim();
  const angle = /<([^>]+@[^>]+)>/.exec(email);
  if (angle) email = angle[1].trim();
  email = email
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase();
  return email.includes("@") ? email : undefined;
}
/** Normalised recipient addresses from a Sockethub mail activity. */
export function mailRecipients(item: MailPost): string[] {
  const found = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string") {
      const email = normalizeMailAddress(value);
      if (email) found.add(email);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) add(entry);
      return;
    }
    if (value && typeof value === "object") {
      const entry = value as { id?: string; address?: string };
      if (typeof entry.address === "string") add(entry.address);
      else if (typeof entry.id === "string") add(entry.id);
    }
  };
  add(item.to);
  add(item.cc);
  add(item.object?.to);
  add(item.object?.cc);
  return [...found];
}
const mailIdRe = /^[^\r\n]{1,998}$/;
const mailId = (value: unknown) =>
  typeof value === "string" && mailIdRe.test(value) ? value : undefined;
/** A readable fallback for HTML-only mail; the HTML itself is never stored or rendered. */
export function textFromHtml(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** Turns one fetched mail into a stored message, or null for our own copies and malformed items. */
export function fromMail(
  account: Pick<EmailAccount, "bandId" | "settings">,
  item: MailPost,
  now = new Date(),
): Message | null {
  const from = item.actor?.id?.trim().toLowerCase();
  const object = item.object;
  if (!from?.includes("@") || !object?.id) return null;
  if (from === account.settings.address) return null;
  const pullAddress = account.settings.inboxAddress?.trim().toLowerCase();
  if (pullAddress) {
    const recipients = mailRecipients(item);
    if (!recipients.includes(pullAddress)) return null;
  }
  const body =
    object.content?.trim() ||
    (object.html ? textFromHtml(object.html) : "") ||
    (object.bodyOmitted ? "(This email is too large to show here.)" : "");
  const attached = object.attachments?.length ?? 0;
  const content = attached
    ? `${body}\n\n[${attached} attachment${attached === 1 ? "" : "s"} left in the mailbox]`.trim()
    : body;
  const published = Date.parse(object.published ?? "");
  const references = Array.isArray(object.references)
    ? object.references.flatMap((r) => (mailId(r) ? [r as string] : []))
    : [];
  return {
    id: object.id.replace(/[^A-Za-z0-9_-]/g, "_"),
    channel: "email",
    direction: "in",
    conversation: conversationId("email", account.bandId, from),
    bandId: account.bandId,
    actor: {
      id: from,
      ...(item.actor?.name?.trim() ? { name: item.actor.name.trim() } : {}),
    },
    target: { id: account.settings.address },
    object: { type: "Note", content },
    published: new Date(
      Number.isNaN(published) ? now : published,
    ).toISOString(),
    received: now.toISOString(),
    ...(typeof object.subject === "string" ? { subject: object.subject } : {}),
    ...(mailId(object.messageId) ? { messageId: object.messageId } : {}),
    ...(mailId(object.inReplyTo) ? { inReplyTo: object.inReplyTo } : {}),
    ...(references.length ? { references: references.slice(-50) } : {}),
  };
}
const emit = (sc: SockethubClient, event: string, payload: unknown) =>
  new Promise<MailPost>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("email:sockethub-timeout")),
      30000,
    );
    sc.socket.emit(event, payload, (result: MailPost | undefined) => {
      clearTimeout(timer);
      result?.error ? reject(new Error(result.error)) : resolve(result ?? {});
    });
  });

/** One long-lived Sockethub session per band mailbox: IMAP IDLE through `watch`, stored messages, a saved cursor, reconnects with backoff. */
export function mailboxWatchers(
  accounts: EmailAccounts,
  messages: Pick<Messages, "save">,
  options: {
    armadiettoUrl?: string;
    sockethubUrl?: string;
    minDelayMs?: number;
    maxDelayMs?: number;
    log?: (message: string, detail?: unknown) => void;
  } = {},
) {
  const armadiettoUrl =
    options.armadiettoUrl ??
    process.env.ARMADIETTO_URL ??
    "http://armadietto:8000";
  const sockethubUrl =
    options.sockethubUrl ??
    process.env.SOCKETHUB_URL ??
    "http://sockethub:10550";
  const minDelay = options.minDelayMs ?? 2000;
  const maxDelay = options.maxDelayMs ?? 5 * 60 * 1000;
  const log =
    options.log ??
    ((message: string, detail?: unknown) =>
      console.error(message, detail ?? ""));
  type Run = {
    stopped: boolean;
    wake?: () => void;
    client?: SockethubClient;
    done: Promise<void>;
    phase: InboxWatchStatus["phase"];
    catchUp?: boolean;
    /** After check inbox now without a saved cursor: learn uidValidity, then watch from uid 0. */
    rescanWithoutCursor?: boolean;
    activeSession?: string;
  };
  const runs = new Map<string, Run>();
  const key = (username: string, bandId: string) => `${username}/${bandId}`;
  const setPhase = (id: string, phase: InboxWatchStatus["phase"]) => {
    const run = runs.get(id);
    if (run) run.phase = phase;
  };

  /** Connects, watches and stores mail until the session ends; resolves with the failure reason. */
  async function session(run: Run, account: EmailAccount) {
    const sessionId = crypto.randomUUID();
    run.activeSession = sessionId;
    setPhase(`${account.username}/${account.bandId}`, "connecting");
    const sc = await SockethubClient.connect(sockethubUrl, {
      initTimeoutMs: 10000,
    });
    run.client = sc;
    try {
      await sc.ready(15000);
      if (!sc.getRegisteredPlatforms().some((p) => p.id === "email"))
        throw new Error("Email isn't set up on this server yet.");
      const actor = {
        id: account.settings.address,
        type: "person",
        ...(account.settings.name ? { name: account.settings.name } : {}),
      };
      const context = sc.contextFor("email");
      const store = remoteStore(
        armadiettoUrl,
        account.username,
        account.storageToken,
        resolveAppOrigin(),
      );
      let ended!: (reason: Error) => void;
      const ending = new Promise<Error>((resolve) => {
        ended = resolve;
      });
      // Posts are stored in arrival order; a failed write holds the cursor back so the catch-up refetches it.
      let chain = Promise.resolve();
      let unstored = false;
      const sessionLive = () => run.activeSession === sessionId;
      sc.socket.on("message", (activity: MailPost) => {
        if (!sessionLive()) return;
        if (
          !activity?.["@context"]?.some((c) => c.includes("/platform/email/"))
        )
          return;
        if (activity.type === "post") {
          const message = fromMail(account, activity);
          if (!message) return;
          chain = chain.then(async () => {
            if (!sessionLive()) return;
            try {
              await messages.save(store, account.username, message);
              accounts.lastMail(
                account.username,
                account.bandId,
                message.received ?? message.published,
              );
            } catch (error) {
              unstored = true;
              log(`Could not store mail for ${account.username}`, error);
            }
          });
          return;
        }
        if (activity.type === "watch") {
          if (activity.error) return ended(new Error(activity.error));
          const cursor = activity.object?.cursor;
          if (!cursor) return;
          chain = chain.then(() => {
            if (!sessionLive()) return;
            if (unstored) return ended(new Error("storage unavailable"));
            accounts.cursor(account.username, account.bandId, cursor);
          });
          return;
        }
        if (activity.type === "disconnect")
          ended(new Error(activity.error ?? "email:connection-closed"));
      });
      sc.socket.on("disconnect", () =>
        ended(new Error("Sockethub disconnected")),
      );
      await emit(sc, "credentials", {
        "@context": context,
        type: "credentials",
        actor,
        object: {
          type: "credentials",
          ...receiveCredentials(account.settings),
        },
      });
      await emit(sc, "message", {
        "@context": context,
        type: "connect",
        actor,
      });
      const fresh = accounts.get(account.username, account.bandId) ?? account;
      const watched = await emit(sc, "message", {
        "@context": context,
        type: "watch",
        actor,
        object: {
          folder: "INBOX",
          ...(fresh.cursor ? { cursor: fresh.cursor } : {}),
        },
      });
      if (run.rescanWithoutCursor && watched.object?.cursor) {
        const fromStart = {
          uidValidity: watched.object.cursor.uidValidity,
          uid: 0,
        };
        accounts.cursor(account.username, account.bandId, fromStart);
        run.rescanWithoutCursor = false;
        const rescanned = await emit(sc, "message", {
          "@context": context,
          type: "watch",
          actor,
          object: { folder: "INBOX", cursor: fromStart },
        });
        if (rescanned.object?.cursor)
          accounts.cursor(
            account.username,
            account.bandId,
            rescanned.object.cursor,
          );
      } else if (watched.object?.cursor) {
        accounts.cursor(
          account.username,
          account.bandId,
          watched.object.cursor,
        );
      }
      accounts.error(account.username, account.bandId, null);
      setPhase(`${account.username}/${account.bandId}`, "watching");
      return await ending;
    } finally {
      if (run.activeSession === sessionId) run.activeSession = undefined;
      run.client = undefined;
      sc.socket.disconnect();
    }
  }
  async function loop(id: string, run: Run) {
    let attempt = 0;
    while (!run.stopped) {
      const [username, bandId] = id.split("/");
      const account = accounts.get(username, bandId);
      if (!account?.settings.imapHost) break;
      const started = Date.now();
      try {
        const reason = await session(run, account);
        throw reason;
      } catch (cause) {
        if (run.stopped) break;
        const error = cause instanceof Error ? cause.message : String(cause);
        // A cursor the server no longer recognises is dropped; the watch then starts at the end of the folder.
        if (error.startsWith("email:cursor-invalid"))
          accounts.cursor(username, bandId, undefined);
        if (!error.startsWith("email:connection-closed"))
          try {
            accounts.error(username, bandId, friendlyMailError(error));
          } catch {}
        log(`Mailbox watch for ${id} ended: ${error}`);
      }
      if (run.catchUp) {
        run.catchUp = false;
        attempt = 0;
        continue;
      }
      // A session that held for a while earns a fresh backoff; quick failures back off further each time.
      attempt = Date.now() - started > 60000 ? 0 : attempt + 1;
      setPhase(id, "retrying");
      const delay = Math.min(maxDelay, minDelay * 2 ** Math.min(attempt, 20));
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay + Math.random() * delay * 0.2);
        run.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      run.wake = undefined;
    }
    if (runs.get(id) === run) runs.delete(id);
  }
  function start(username: string, bandId: string) {
    const id = key(username, bandId);
    if (runs.has(id)) return;
    const run = { stopped: false, phase: "connecting" } as Run;
    run.done = loop(id, run);
    runs.set(id, run);
  }
  async function stop(username: string, bandId: string) {
    const id = key(username, bandId);
    const run = runs.get(id);
    if (!run) return;
    runs.delete(id);
    run.stopped = true;
    run.client?.socket.disconnect();
    run.wake?.();
    await run.done;
  }
  return {
    /** Watches every account that has an incoming server. */
    startAll() {
      for (const account of accounts.all())
        if (account.settings.imapHost) start(account.username, account.bandId);
    },
    restart(username: string, bandId: string) {
      void stop(username, bandId).then(() => start(username, bandId));
    },
    stop(username: string, bandId: string) {
      void stop(username, bandId);
    },
    watching: (username: string, bandId: string) =>
      runs.has(key(username, bandId)),
    checkNow(username: string, bandId: string) {
      const id = key(username, bandId);
      const account = accounts.get(username, bandId);
      const rescanWithoutCursor = !account?.cursor?.uidValidity;
      if (account?.cursor?.uidValidity) {
        accounts.cursor(username, bandId, {
          uidValidity: account.cursor.uidValidity,
          uid: 0,
        });
      } else if (account) {
        accounts.cursor(username, bandId, undefined);
      }
      const run = runs.get(id);
      if (!run) {
        const pending = {
          stopped: false,
          phase: "connecting",
          ...(rescanWithoutCursor ? { rescanWithoutCursor: true } : {}),
        } as Run;
        pending.done = loop(id, pending);
        runs.set(id, pending);
        return;
      }
      if (rescanWithoutCursor) run.rescanWithoutCursor = true;
      run.catchUp = true;
      run.client?.socket.disconnect();
      run.wake?.();
    },
    status(username: string, bandId: string): InboxWatchStatus {
      const id = key(username, bandId);
      const run = runs.get(id);
      if (run) return { phase: run.phase, live: true };
      const account = accounts.get(username, bandId);
      if (!account?.settings.imapHost) return { phase: "idle", live: false };
      return {
        phase: account.error ? "retrying" : "idle",
        live: false,
      };
    },
    async stopAll() {
      await Promise.all(
        [...runs.keys()].map((id) => {
          const [username, bandId] = id.split("/");
          return stop(username, bandId);
        }),
      );
    },
  };
}
export type MailboxWatchers = ReturnType<typeof mailboxWatchers>;

/** Sockethub's `email:` reasons, in words a band member can act on. */
export function friendlyMailError(error: string) {
  if (error.startsWith("email:blocked-server-address"))
    return "The mail server address is not allowed by this server.";
  if (error.startsWith("email:connect-failed"))
    return "Could not sign in to the mailbox. Check the server, login and password.";
  if (error.startsWith("email:smtp-not-configured"))
    return "No outgoing mail server is set for this band.";
  if (error.startsWith("email:submission-failed"))
    return "The mail server did not accept the message. It may or may not have been sent; check the Sent folder before trying again.";
  if (error.startsWith("email:watch-failed"))
    return "Could not open the inbox folder on the mail server.";
  if (error.startsWith("email:cursor-invalid"))
    return "The mailbox was reset; watching resumes from new mail.";
  if (error.startsWith("email:"))
    return `Mail server problem (${error.split(";")[0].slice(6)}).`;
  return error;
}
