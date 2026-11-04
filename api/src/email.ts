import type { Database } from "bun:sqlite";
import type { Messages } from "./messages";
import { seal, unseal, validKey } from "./secrets";

/** Everything a band's mail account needs; stored as one encrypted JSON blob. */
export interface EmailSettings {
  address: string;
  name?: string;
  /** Empty when the band only sends mail; then no mailbox is watched. */
  imapHost?: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  login: string;
  password: string;
}
export type EmailAccountRow = {
  username: string;
  band_id: string;
  address: string;
  settings: string;
  storage_token: string;
  cursor: string | null;
  error: string | null;
};
export interface EmailAccount {
  username: string;
  bandId: string;
  settings: EmailSettings;
  storageToken: string;
  cursor?: { uidValidity: string; uid: number };
  error?: string;
}
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hostRe = /^[^\s/\\]+$/;
const noStore = { "Cache-Control": "no-store" };

/** Immediate TLS on the usual implicit-TLS ports, STARTTLS otherwise; Sockethub accepts nothing in plain text. */
export const imapSecure = (port: number) => port !== 143;
export const smtpSecure = (port: number) => port === 465;
export function sendCredentials(settings: EmailSettings) {
  return {
    from: settings.address,
    smtp: {
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: smtpSecure(settings.smtpPort),
      username: settings.login,
      password: settings.password,
    },
  };
}
export function receiveCredentials(settings: EmailSettings) {
  return {
    from: settings.address,
    imap: {
      host: settings.imapHost as string,
      port: settings.imapPort,
      secure: imapSecure(settings.imapPort),
      username: settings.login,
      password: settings.password,
    },
  };
}
/** Validates submitted settings; `existing` lets an update keep the stored password. Returns an error message or the settings. */
export function parseSettings(
  input: Record<string, unknown>,
  existing?: EmailSettings,
): EmailSettings | string {
  const str = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string).trim() : "";
  const port = (key: string, fallback: number) => {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === "") return fallback;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : Number.NaN;
  };
  const address = str("address").toLowerCase();
  if (!emailRe.test(address) || address.length > 254)
    return "Enter the band's email address.";
  const name = str("name");
  if (name.length > 200 || /[\r\n]/.test(name))
    return "Keep the display name under 200 characters.";
  const imapHost = str("imapHost");
  const smtpHost = str("smtpHost");
  if (!hostRe.test(smtpHost) || smtpHost.length > 253)
    return "Enter the outgoing (SMTP) server.";
  if (imapHost && (!hostRe.test(imapHost) || imapHost.length > 253))
    return "Enter the incoming (IMAP) server or leave it empty.";
  const imapPort = port("imapPort", 993);
  const smtpPort = port("smtpPort", 587);
  if (Number.isNaN(imapPort) || Number.isNaN(smtpPort))
    return "Ports must be between 1 and 65535.";
  const login = str("login");
  if (!login || login.length > 1024) return "Enter the mail account login.";
  const password =
    typeof input.password === "string" && input.password
      ? input.password
      : (existing?.password ?? "");
  if (!password || password.length > 4096)
    return "Enter the mail account password.";
  return {
    address,
    ...(name ? { name } : {}),
    ...(imapHost ? { imapHost } : {}),
    imapPort,
    smtpHost,
    smtpPort,
    login,
    password,
  };
}
/** What the browser may see: everything but the password. */
export function publicSettings(account: EmailAccount) {
  const { password: _, ...rest } = account.settings;
  return {
    ...rest,
    watching: !!account.settings.imapHost,
    ...(account.error ? { error: account.error } : {}),
  };
}
export interface Watchers {
  restart(username: string, bandId: string): void;
  stop(username: string, bandId: string): void;
}
export function emailAccounts(db: Database, env = process.env) {
  const open = (row: EmailAccountRow | null): EmailAccount | undefined =>
    row
      ? {
          username: row.username,
          bandId: row.band_id,
          settings: JSON.parse(unseal(row.settings, env)),
          storageToken: unseal(row.storage_token, env),
          ...(row.cursor ? { cursor: JSON.parse(row.cursor) } : {}),
          ...(row.error ? { error: row.error } : {}),
        }
      : undefined;
  return {
    get: (username: string, bandId: string) =>
      open(
        db
          .query<EmailAccountRow, [string, string]>(
            "SELECT * FROM email_accounts WHERE username = ? AND band_id = ?",
          )
          .get(username, bandId),
      ),
    all: () =>
      db
        .query<EmailAccountRow, []>("SELECT * FROM email_accounts")
        .all()
        .map((row) => open(row) as EmailAccount),
    put(account: EmailAccount) {
      db.query(
        "INSERT OR REPLACE INTO email_accounts (username, band_id, address, settings, storage_token, cursor, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        account.username,
        account.bandId,
        account.settings.address,
        seal(JSON.stringify(account.settings), env),
        seal(account.storageToken, env),
        account.cursor ? JSON.stringify(account.cursor) : null,
        account.error ?? null,
      );
    },
    cursor(username: string, bandId: string, cursor: EmailAccount["cursor"]) {
      db.query(
        "UPDATE email_accounts SET cursor = ? WHERE username = ? AND band_id = ?",
      ).run(cursor ? JSON.stringify(cursor) : null, username, bandId);
    },
    error(username: string, bandId: string, error: string | null) {
      db.query(
        "UPDATE email_accounts SET error = ? WHERE username = ? AND band_id = ?",
      ).run(error, username, bandId);
    },
    remove(username: string, bandId: string) {
      db.query(
        "DELETE FROM email_accounts WHERE username = ? AND band_id = ?",
      ).run(username, bandId);
    },
  };
}
export type EmailAccounts = ReturnType<typeof emailAccounts>;

export function emailHandler(
  db: Database,
  messages: Pick<Messages, "verified">,
  watchers: Watchers,
  env = process.env,
  internalUrl = env.ARMADIETTO_AUTH_URL ?? "http://armadietto:8001",
) {
  const accounts = emailAccounts(db, env);
  const fail = (error: string, status: number) =>
    Response.json({ error }, { status, headers: noStore });
  const hook = (action: string, body: unknown) =>
    fetch(`${internalUrl}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  async function body(req: Request) {
    try {
      const input = await req.json();
      return input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return {
    accounts,
    /** GET /email/account?username&bandId with Bearer token: the band's mail settings without the password. */
    async get(req: Request) {
      const q = new URL(req.url).searchParams;
      const username = q.get("username");
      const bandId = q.get("bandId");
      if (!(await messages.verified(req, username, bandId)))
        return fail("Log in again.", 401);
      const account = accounts.get(username as string, bandId as string);
      return Response.json(account ? publicSettings(account) : null, {
        headers: noStore,
      });
    },
    /** PUT /email/account {username, bandId, address, name, imapHost, imapPort, smtpHost, smtpPort, login, password} */
    async put(req: Request) {
      const input = await body(req);
      if (!input) return fail("Invalid request.", 400);
      const { username, bandId } = input;
      if (!(await messages.verified(req, username, bandId, true)))
        return fail("Log in again to change email settings.", 401);
      if (!validKey(env))
        return fail("Email is not configured on this server.", 503);
      const existing = accounts.get(username as string, bandId as string);
      const settings = parseSettings(input, existing?.settings);
      if (typeof settings === "string") return fail(settings, 400);
      let storageToken = existing?.storageToken ?? "";
      if (!storageToken) {
        const minted = await hook("token", { username }).catch(() => null);
        if (!minted?.ok)
          return fail("Could not prepare storage for incoming mail.", 503);
        storageToken = (await minted.json()).token;
      }
      // Different mailbox, different UIDs: a kept cursor would point into the wrong account.
      const sameMailbox =
        existing?.settings.imapHost === settings.imapHost &&
        existing?.settings.login === settings.login;
      const account: EmailAccount = {
        username: username as string,
        bandId: bandId as string,
        settings,
        storageToken,
        ...(sameMailbox && existing?.cursor ? { cursor: existing.cursor } : {}),
      };
      accounts.put(account);
      watchers.restart(account.username, account.bandId);
      return Response.json(publicSettings(account), { headers: noStore });
    },
    /** DELETE /email/account {username, bandId}: stops watching, revokes the storage token and forgets the settings. */
    async remove(req: Request) {
      const input = await body(req);
      if (!input) return fail("Invalid request.", 400);
      const { username, bandId } = input;
      if (!(await messages.verified(req, username, bandId, true)))
        return fail("Log in again to change email settings.", 401);
      const account = accounts.get(username as string, bandId as string);
      if (account) {
        watchers.stop(account.username, account.bandId);
        const revoked = await hook("logout", {
          username,
          token: account.storageToken,
        }).catch(() => null);
        if (!revoked?.ok)
          return fail("Could not remove the account. Please retry.", 503);
        accounts.remove(account.username, account.bandId);
      }
      return Response.json({ ok: true }, { headers: noStore });
    },
  };
}
export type EmailHandler = ReturnType<typeof emailHandler>;
