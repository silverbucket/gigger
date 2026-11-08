import type { Database } from "bun:sqlite";
import { countryCodes, STORAGE_MODULE_SLUG } from "@showday/schemas";
import { resolveAppOrigin } from "./app-origin";
import { armadiettoStorageHeaders } from "./storage";

/** A venue as every account sees it: only the public basics, never contact details or surveys. */
export interface DirectoryVenue {
  id: string;
  name: string;
  address: string;
  city?: string;
  country?: string;
  website?: string;
}
type Row = {
  id: string;
  name: string;
  address: string;
  city: string | null;
  country: string | null;
  website: string | null;
};

const usernameRe = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const idRe = /^[A-Za-z0-9_-]{1,100}$/;
/** Accent- and case-insensitive, with runs of space and punctuation collapsed. */
export const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const field = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.trim().length <= max
    ? value.trim()
    : undefined;
function website(value: unknown) {
  const url = field(value, 500);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}
const toVenue = (row: Row): DirectoryVenue => ({
  id: row.id,
  name: row.name,
  address: row.address,
  ...(row.city ? { city: row.city } : {}),
  ...(row.country ? { country: row.country } : {}),
  ...(row.website ? { website: row.website } : {}),
});

/** The shared venue list: any band can add the venues it plays and find the ones other bands added. */
export function venueHandler(
  db: Database,
  armadiettoUrl = process.env.ARMADIETTO_URL ?? "http://armadietto:8000",
  appOrigin = resolveAppOrigin(),
) {
  // A token that could read the band stays trusted for a few minutes, so typing a search doesn't hit storage on every key.
  const trusted = new Map<string, number>();
  const trustFor = 5 * 60_000;
  const noStore = { "Cache-Control": "no-store" };
  const fail = (error: string, status: number) =>
    Response.json({ error }, { status, headers: noStore });

  async function verify(req: Request, username: unknown, bandId: unknown) {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    if (
      typeof username !== "string" ||
      !usernameRe.test(username) ||
      typeof bandId !== "string" ||
      !idRe.test(bandId) ||
      !token
    )
      return fail("Invalid request.", 400);
    const key = JSON.stringify([username, bandId, token]);
    if ((trusted.get(key) ?? 0) > Date.now()) return null;
    try {
      const check = await fetch(
        `${armadiettoUrl}/storage/storage/${encodeURIComponent(username)}/${STORAGE_MODULE_SLUG}/bands/${bandId}/band`,
        {
          headers: armadiettoStorageHeaders(token, appOrigin),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!check.ok)
        return fail(
          "Could not verify access to this band. Please retry.",
          [401, 403, 404].includes(check.status) ? 403 : 503,
        );
    } catch {
      return fail("Storage service unavailable. Please retry.", 503);
    }
    if (trusted.size > 10_000) trusted.clear();
    trusted.set(key, Date.now() + trustFor);
    return null;
  }

  const byKey = db.query<{ id: string }, [string]>(
    "SELECT id FROM directory_venues WHERE match_key = ?",
  );
  const bySource = db.query<{ id: string }, [string, string]>(
    "SELECT id FROM directory_venues WHERE username = ? AND source_id = ?",
  );
  const search = db.query<Row, [string, string]>(
    "SELECT id, name, address, city, country, website FROM directory_venues WHERE search LIKE ? ESCAPE '\\' ORDER BY CASE WHEN search LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, name LIMIT 20",
  );

  return {
    /** GET /venues?username&bandId&q with the account's storage token. */
    async search(req: Request) {
      const params = new URL(req.url).searchParams;
      const denied = await verify(
        req,
        params.get("username"),
        params.get("bandId"),
      );
      if (denied) return denied;
      const needle = fold(params.get("q") ?? "").slice(0, 100);
      if (needle.length < 2) return Response.json([], { headers: noStore });
      const like = needle.replace(/[\\%_]/g, (c) => `\\${c}`);
      const rows = search.all(`%${like}%`, `${like}%`);
      return Response.json(rows.map(toVenue), { headers: noStore });
    },
    /**
     * POST /venues {username, bandId, sourceId, name, address, city?, country?, website?}.
     * A venue already listed under the same name and address is kept as it is;
     * otherwise the account's own earlier entry for that venue is updated, or a new one added.
     */
    async add(req: Request) {
      if (req.headers.get("origin") && req.headers.get("origin") !== appOrigin)
        return fail("Invalid request origin.", 403);
      let input: Record<string, unknown>;
      try {
        input = (await req.json()) ?? {};
      } catch {
        return fail("Invalid request.", 400);
      }
      const denied = await verify(req, input.username, input.bandId);
      if (denied) return denied;
      const username = input.username as string;
      const sourceId = input.sourceId;
      const name = field(input.name, 200);
      const address = field(input.address, 500);
      const city = field(input.city, 100);
      const country =
        typeof input.country === "string" &&
        countryCodes.includes(input.country)
          ? input.country
          : null;
      if (
        typeof sourceId !== "string" ||
        !idRe.test(sourceId) ||
        !name ||
        !address
      )
        return fail("A shared venue needs a name and an address.", 400);
      const matchKey = `${fold(name)}|${fold(address)}`;
      const existing = byKey.get(matchKey);
      if (existing)
        return Response.json({ id: existing.id }, { headers: noStore });
      const values = [
        name,
        address,
        city ?? null,
        country,
        website(input.website) ?? null,
        matchKey,
        fold([name, city, address].filter(Boolean).join(" ")),
      ];
      const own = bySource.get(username, sourceId);
      if (own) {
        db.query(
          "UPDATE directory_venues SET name = ?, address = ?, city = ?, country = ?, website = ?, match_key = ?, search = ?, updated_at = ? WHERE id = ?",
        ).run(...values, new Date().toISOString(), own.id);
        return Response.json({ id: own.id }, { headers: noStore });
      }
      const id = crypto.randomUUID();
      db.query(
        "INSERT INTO directory_venues (id, name, address, city, country, website, match_key, search, username, source_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, ...values, username, sourceId, new Date().toISOString());
      return Response.json({ id }, { headers: noStore });
    },
  };
}
