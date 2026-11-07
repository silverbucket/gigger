import type { Database } from "bun:sqlite";
import {
  type PublicGig,
  type PublicPage,
  STORAGE_MODULE_SLUG,
  slugPattern,
} from "@showday/schemas";
import { resolveAppOrigin } from "./app-origin";
import { armadiettoStorageHeaders } from "./storage";
import { zip } from "./zip";

type Row = PublicGig & { id: string };
const slugRe = new RegExp(slugPattern);
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const timeRe = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const hexColorRe = /^#[0-9A-Fa-f]{6}$/;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanTheme(input: unknown) {
  if (!input || typeof input !== "object") return undefined;
  const { background, text, accent } = input as Record<string, unknown>;
  const theme = {
    ...(typeof background === "string" && hexColorRe.test(background)
      ? { background }
      : {}),
    ...(typeof text === "string" && hexColorRe.test(text) ? { text } : {}),
    ...(typeof accent === "string" && hexColorRe.test(accent)
      ? { accent }
      : {}),
  };
  return Object.keys(theme).length ? theme : undefined;
}
function cleanContact(input: unknown) {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const contact = {
    ...(typeof raw.email === "string" &&
    emailRe.test(raw.email.trim()) &&
    raw.email.length <= 254
      ? { email: raw.email.trim().toLowerCase() }
      : {}),
    ...(typeof raw.phone === "string" && raw.phone.trim().length <= 200
      ? { phone: raw.phone.trim() }
      : {}),
    ...(typeof raw.website === "string" &&
    /^https?:\/\/[^\s/]+[^\s]*$/.test(raw.website.trim())
      ? { website: raw.website.trim() }
      : {}),
  };
  return Object.keys(contact).length ? contact : undefined;
}

/** Rebuilds the page from scratch with only the allowed public fields, whatever the stored document carries. */
export function cleanPage(input: unknown): PublicPage | null {
  if (!input || typeof input !== "object") return null;
  const { name, locale, gigs, bio, banner, bannerType, theme, contact } =
    input as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) return null;
  const clean: PublicPage = { name: name.trim(), gigs: {} };
  if (typeof locale === "string") {
    try {
      clean.locale = Intl.getCanonicalLocales(locale)[0];
    } catch {}
  }
  if (typeof bio === "string" && bio.trim())
    clean.bio = bio.trim().slice(0, 5000);
  if (banner === "banner") clean.banner = "banner";
  if (
    typeof bannerType === "string" &&
    /^image\/[a-z+]+$/i.test(bannerType) &&
    clean.banner
  )
    clean.bannerType = bannerType;
  const cleanedTheme = cleanTheme(theme);
  if (cleanedTheme) clean.theme = cleanedTheme;
  const cleanedContact = cleanContact(contact);
  if (cleanedContact) clean.contact = cleanedContact;
  for (const [id, value] of Object.entries(
    (gigs && typeof gigs === "object" ? gigs : {}) as Record<string, unknown>,
  )) {
    if (!/^[A-Za-z0-9_-]+$/.test(id) || !value || typeof value !== "object")
      continue;
    const gig = value as Record<string, unknown>;
    if (typeof gig.date !== "string" || !dateRe.test(gig.date)) continue;
    const parsedDate = new Date(`${gig.date}T00:00:00Z`);
    if (
      Number.isNaN(parsedDate.valueOf()) ||
      parsedDate.toISOString().slice(0, 10) !== gig.date
    )
      continue;
    clean.gigs[id] = {
      date: gig.date,
      venue: typeof gig.venue === "string" ? gig.venue : "",
      ...(typeof gig.start === "string" && timeRe.test(gig.start)
        ? { start: gig.start }
        : {}),
      ...(typeof gig.city === "string" && gig.city ? { city: gig.city } : {}),
      ...(typeof gig.ticketUrl === "string" &&
      /^https?:\/\/[^\s/]+[^\s]*$/.test(gig.ticketUrl)
        ? { ticketUrl: gig.ticketUrl }
        : {}),
      ...(typeof gig.description === "string" && gig.description
        ? { description: gig.description }
        : {}),
    };
  }
  return clean;
}

export function splitGigs(page: PublicPage, today: string) {
  const rows: Row[] = Object.entries(page.gigs)
    .map(([id, gig]) => ({ id, ...gig }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return {
    upcoming: rows.filter((gig) => gig.date >= today),
    past: rows.filter((gig) => gig.date < today).reverse(),
  };
}

function utc(gig: PublicGig) {
  const [y, m, d] = gig.date.split("-").map(Number);
  const [h, min] = (gig.start ?? "00:00").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, min));
}
function formatter(locale: string | undefined) {
  return (gig: PublicGig, options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        timeZone: "UTC",
        ...options,
      }).format(utc(gig));
    } catch {
      return new Intl.DateTimeFormat("en", {
        timeZone: "UTC",
        ...options,
      }).format(utc(gig));
    }
  };
}
const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );

const defaultTheme = {
  background: "#e7c244",
  text: "#15120b",
  accent: "#15120b",
  muted: "#4f4729",
  rule: "#b8962e",
  ticketText: "#e7c244",
};
function pageColors(page: PublicPage) {
  const theme = page.theme ?? {};
  return {
    background: theme.background ?? defaultTheme.background,
    text: theme.text ?? defaultTheme.text,
    accent: theme.accent ?? defaultTheme.accent,
    muted: defaultTheme.muted,
    rule: defaultTheme.rule,
    ticketText: defaultTheme.ticketText,
  };
}
function pageCss(page: PublicPage) {
  const c = pageColors(page);
  return `
:root{--bg:${c.background};--text:${c.text};--accent:${c.accent};--muted:${c.muted};--rule:${c.rule};--ticket-text:${c.ticketText}}
body{margin:0;background:var(--bg);color:var(--text);font:1.0625rem/1.55 Georgia,"Iowan Old Style","Times New Roman",serif}
header,main,footer{max-width:36rem;margin:0 auto;padding:0 1.25rem;box-sizing:border-box}
header{padding-top:2rem}
.banner{margin:0 -1.25rem 1.5rem;max-height:16rem;overflow:hidden;background:var(--accent)}
.banner img{display:block;width:100%;height:auto;max-height:16rem;object-fit:cover}
h1{font-size:clamp(2.5rem,12vw,4.5rem);line-height:.95;margin:0 0 .6rem;font-weight:400;letter-spacing:-.02em;overflow-wrap:anywhere}
header p,.bio{margin:0;font-style:italic;color:var(--muted)}
.bio{margin-top:.75rem;white-space:pre-line;font-style:normal}
.reach{margin:1rem 0 0;font-size:1rem}
.reach a{color:inherit}
h2{font-size:1rem;font-weight:400;font-style:italic;margin:2.75rem 0 0;padding-bottom:.4rem;border-bottom:2px solid var(--accent)}
ol,ul{list-style:none;margin:0;padding:0}
.gigs li{display:grid;grid-template-columns:4.5rem 1fr;gap:0 1rem;padding:1.25rem 0;border-bottom:1px solid var(--rule)}
.gigs time{display:flex;flex-direction:column;line-height:1}
.day{font-size:3.25rem;letter-spacing:-.04em}
.month{font-style:italic;margin-top:.35rem}
.year{margin-top:.35rem}
.where{margin:.25rem 0 0;font-size:1.375rem;line-height:1.2;overflow-wrap:anywhere}
.when{margin:.3rem 0 0;color:var(--muted)}
.desc{margin:.75rem 0 0;white-space:pre-line}
.tickets{display:inline-block;margin-top:1rem;padding:.7rem 1.25rem;background:var(--accent);color:var(--ticket-text);text-decoration:none;min-height:44px;box-sizing:border-box}
.past li{display:grid;grid-template-columns:7.5rem 1fr;gap:1rem;padding:.65rem 0;border-bottom:1px solid var(--rule);color:var(--muted)}
.empty{font-size:1.25rem;margin:2rem 0}
footer{padding:3rem 1.25rem 4rem;display:flex;gap:1.5rem;flex-wrap:wrap}
a{color:inherit}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
@media (min-width:40rem){.gigs li{grid-template-columns:6rem 1fr}.day{font-size:4rem}}
`;
}
function contactBlock(page: PublicPage) {
  const contact = page.contact;
  if (!contact) return "";
  const parts: string[] = [];
  if (contact.email)
    parts.push(
      `<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>`,
    );
  if (contact.phone)
    parts.push(
      `<a href="tel:${esc(contact.phone.replace(/\s/g, ""))}">${esc(contact.phone)}</a>`,
    );
  if (contact.website)
    parts.push(
      `<a href="${esc(contact.website)}" rel="noopener noreferrer">${esc(contact.website.replace(/^https?:\/\//, ""))}</a>`,
    );
  return parts.length ? `<p class="reach">${parts.join(" · ")}</p>` : "";
}

/** `base` is the URL prefix for the JSON and ICS links: "/b/<slug>/" when served, "" inside the export. */
export function renderPage(page: PublicPage, base: string, today: string) {
  const { upcoming, past } = splitGigs(page, today);
  const fmt = formatter(page.locale);
  const lang = page.locale ?? "en";
  const cs = lang.toLowerCase().split("-")[0] === "cs";
  const labels = cs
    ? {
        title: "živě",
        description: `Kde bude ${page.name} hrát.`,
        upcoming: "Nadcházející koncerty",
        past: "Minulé koncerty",
        empty: "Zatím nejsou ohlášené žádné koncerty. Zkuste to později.",
        none: "Momentálně nejsou naplánované žádné koncerty",
        tickets: "Vstupenky",
        calendar: "Přidat koncerty do kalendáře",
        json: "Data koncertů ve formátu JSON",
        count: `${upcoming.length} ${upcoming.length === 1 ? "nadcházející koncert" : upcoming.length < 5 ? "nadcházející koncerty" : "nadcházejících koncertů"}`,
      }
    : {
        title: "live",
        description: `Where ${page.name} plays next.`,
        upcoming: "Upcoming gigs",
        past: "Past gigs",
        empty: "No gigs announced yet. Check back soon.",
        none: "Nothing booked right now",
        tickets: "Tickets",
        calendar: "Add these gigs to your calendar",
        json: "Gig data as JSON",
        count: `${upcoming.length} upcoming ${upcoming.length === 1 ? "gig" : "gigs"}`,
      };
  const upcomingItems = upcoming
    .map(
      (gig) => `<li>
<time lang="${esc(lang)}" datetime="${gig.date}${gig.start ? `T${gig.start}` : ""}"><span class="day">${esc(fmt(gig, { day: "numeric" }))}</span><span class="month">${esc(fmt(gig, { month: "short" }))}</span>${gig.date.slice(0, 4) !== today.slice(0, 4) ? `<span class="year">${gig.date.slice(0, 4)}</span>` : ""}</time>
<div>
<p class="where">${esc(gig.venue)}${gig.city ? `, ${esc(gig.city)}` : ""}</p>
<p class="when" lang="${esc(lang)}">${esc(fmt(gig, { weekday: "long" }))}${gig.start ? `, ${esc(fmt(gig, { hour: "numeric", minute: "2-digit" }))}` : ""}</p>
${gig.description ? `<p class="desc">${esc(gig.description)}</p>` : ""}
${gig.ticketUrl ? `<a class="tickets" href="${esc(gig.ticketUrl)}">${labels.tickets}</a>` : ""}
</div>
</li>`,
    )
    .join("\n");
  const pastItems = past
    .map(
      (gig) =>
        `<li><time lang="${esc(lang)}" datetime="${gig.date}">${esc(fmt(gig, { dateStyle: "medium" }))}</time><span>${esc(gig.venue)}${gig.city ? `, ${esc(gig.city)}` : ""}</span></li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="${cs ? "cs" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.name)} ${labels.title}</title>
<meta name="description" content="${esc(labels.description)}">
<style>${pageCss(page)}</style>
</head>
<body>
<header>
${page.banner ? `<figure class="banner"><img src="${esc(base)}banner" alt=""></figure>` : ""}
<h1>${esc(page.name)}</h1>
<p>${upcoming.length ? labels.count : labels.none}</p>
${page.bio ? `<p class="bio">${esc(page.bio)}</p>` : ""}
${contactBlock(page)}
</header>
<main>
<section aria-labelledby="upcoming">
<h2 id="upcoming">${labels.upcoming}</h2>
${upcoming.length ? `<ol class="gigs">\n${upcomingItems}\n</ol>` : `<p class="empty">${labels.empty}</p>`}
</section>
${past.length ? `<section aria-labelledby="past">\n<h2 id="past">${labels.past}</h2>\n<ul class="past">\n${pastItems}\n</ul>\n</section>` : ""}
</main>
<footer>
<a href="${base}gigs.ics">${labels.calendar}</a>
<a href="${base}gigs.json">${labels.json}</a>
</footer>
</body>
</html>
`;
}

export function renderJson(page: PublicPage) {
  const gigs = Object.entries(page.gigs)
    .map(([id, gig]) => ({ id, ...gig }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return JSON.stringify(
    {
      name: page.name,
      locale: page.locale,
      ...(page.bio ? { bio: page.bio } : {}),
      ...(page.banner
        ? { banner: page.banner, bannerType: page.bannerType }
        : {}),
      ...(page.theme ? { theme: page.theme } : {}),
      ...(page.contact ? { contact: page.contact } : {}),
      gigs,
    },
    null,
    2,
  );
}

const icsText = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/[,;]/g, "\\$&").replace(/\r?\n/g, "\\n");
export function renderIcs(page: PublicPage, identity: string) {
  const stamp = `${new Date().toISOString().replace(/[-:]|\.\d{3}/g, "")}`;
  const events = Object.entries(page.gigs).map(([id, gig]) => {
    const date = gig.date.replace(/-/g, "");
    return [
      "BEGIN:VEVENT",
      `UID:${id}@${identity}`,
      `DTSTAMP:${stamp}`,
      gig.start
        ? `DTSTART;TZID=Europe/Prague:${date}T${gig.start.replace(":", "")}00`
        : `DTSTART;VALUE=DATE:${date}`,
      `SUMMARY:${icsText(`${page.name} at ${gig.venue}`)}`,
      `LOCATION:${icsText([gig.venue, gig.city].filter(Boolean).join(", "))}`,
      ...(gig.description ? [`DESCRIPTION:${icsText(gig.description)}`] : []),
      ...(gig.ticketUrl ? [`URL:${gig.ticketUrl}`] : []),
      "END:VEVENT",
    ];
  });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Showday//Public gigs//EN",
    `X-WR-CALNAME:${icsText(page.name)}`,
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Prague",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "END:STANDARD",
    "END:VTIMEZONE",
    ...events.flat(),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function publicHandler(
  db: Database,
  armadiettoUrl = process.env.ARMADIETTO_URL ?? "http://armadietto:8000",
  appOrigin = resolveAppOrigin(),
  internalUrl = process.env.ARMADIETTO_AUTH_URL ?? "http://armadietto:8001",
) {
  const owner = db.query<{ username: string; band_id: string }, [string]>(
    "SELECT username, band_id FROM public_pages WHERE slug = ?",
  );
  const claim = db.transaction(
    (username: string, bandId: string, slug: string) => {
      db.query(
        "DELETE FROM public_pages WHERE username = ? AND band_id = ?",
      ).run(username, bandId);
      db.query("INSERT INTO public_pages VALUES (?, ?, ?)").run(
        slug,
        username,
        bandId,
      );
    },
  );
  const storageUrl = (username: string, path: string) =>
    `${armadiettoUrl}/storage/storage/${encodeURIComponent(username)}/${path}`;
  async function loadBanner(slug: string) {
    const row = owner.get(slug);
    if (!row) return null;
    const response = await fetch(
      storageUrl(row.username, `public/${STORAGE_MODULE_SLUG}/${slug}/banner`),
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) return null;
    const body = await response.arrayBuffer();
    const type =
      response.headers.get("content-type")?.split(";")[0]?.trim() ??
      "image/jpeg";
    return { body, type };
  }
  async function loadPage(slug: string) {
    const row = owner.get(slug);
    if (!row) return null;
    const response = await fetch(
      storageUrl(row.username, `public/${STORAGE_MODULE_SLUG}/${slug}/page`),
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) return null;
    const metadata = await response.json();
    const listing = await fetch(`${internalUrl}/public-gigs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: row.username, slug }),
      signal: AbortSignal.timeout(10000),
    });
    if (!listing.ok) throw new Error("Public gig listing unavailable");
    const { gigs } = await listing.json();
    const page = cleanPage({ ...metadata, gigs });
    if (!page) return null;
    const identity = new Bun.CryptoHasher("sha256")
      .update(JSON.stringify([row.username, row.band_id]))
      .digest("hex");
    return { page, identity };
  }
  const headers = { "Cache-Control": "no-cache" };
  return {
    /** GET /b/<slug>[/gigs.json|/gigs.ics|/export.zip] */
    async serve(path: string) {
      const match =
        /^\/b\/([a-z0-9-]+)(?:\/(gigs\.json|gigs\.ics|export\.zip|banner))?$/.exec(
          path,
        );
      if (!match) return new Response("Not found", { status: 404 });
      const [, slug, file] = match;
      if (file === "banner" && slugRe.test(slug)) {
        const banner = await loadBanner(slug);
        if (!banner) return new Response("Not found", { status: 404 });
        return new Response(banner.body, {
          headers: { ...headers, "Content-Type": banner.type },
        });
      }
      const result = slugRe.test(slug) ? await loadPage(slug) : null;
      if (!result)
        return new Response("This band has no public page.", { status: 404 });
      const { page, identity } = result;
      const today = new Date().toISOString().slice(0, 10);
      if (file === "gigs.json")
        return new Response(renderJson(page), {
          headers: { ...headers, "Content-Type": "application/json" },
        });
      if (file === "gigs.ics")
        return new Response(renderIcs(page, identity), {
          headers: {
            ...headers,
            "Content-Type": "text/calendar; charset=utf-8",
          },
        });
      if (file === "export.zip") {
        const archive: Record<string, string | Uint8Array> = {
          "index.html": renderPage(page, "", today),
          "gigs.json": renderJson(page),
          "gigs.ics": renderIcs(page, identity),
        };
        if (page.banner) {
          const banner = await loadBanner(slug);
          if (banner) archive.banner = new Uint8Array(banner.body);
        }
        return new Response(zip(archive), {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${slug}-gigs.zip"`,
          },
        });
      }
      return new Response(renderPage(page, `/b/${slug}/`, today), {
        headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
      });
    },
    /** POST /public/pages {username, bandId, slug} with the account's storage token. */
    async claim(req: Request) {
      const noStore = { "Cache-Control": "no-store" };
      const fail = (error: string, status: number) =>
        Response.json({ error }, { status, headers: noStore });
      if (req.headers.get("origin") && req.headers.get("origin") !== appOrigin)
        return fail("Invalid request origin.", 403);
      let input: Record<string, unknown>;
      try {
        input = await req.json();
      } catch {
        return fail("Invalid request.", 400);
      }
      const { username, bandId, slug } = input ?? {};
      const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
      if (
        typeof username !== "string" ||
        !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(username) ||
        typeof bandId !== "string" ||
        !/^[A-Za-z0-9_-]+$/.test(bandId) ||
        !token
      )
        return fail("Invalid request.", 400);
      if (typeof slug !== "string" || !slugRe.test(slug) || slug.length > 60)
        return fail(
          "Use lowercase letters, numbers and single hyphens for the address.",
          400,
        );
      try {
        const check = await fetch(
          storageUrl(username, `${STORAGE_MODULE_SLUG}/bands/${bandId}/band`),
          {
            headers: armadiettoStorageHeaders(token, appOrigin),
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!check.ok)
          return fail(
            check.status === 403
              ? "Could not reach your band data. Please retry."
              : "Could not verify access to this band. Please retry.",
            check.status === 401 || check.status === 403 || check.status === 404
              ? 403
              : 503,
          );
      } catch {
        return fail("Storage service unavailable. Please retry.", 503);
      }
      const taken = owner.get(slug);
      if (taken && (taken.username !== username || taken.band_id !== bandId))
        return fail("This address is already taken. Try another.", 409);
      claim(username, bandId, slug);
      return Response.json({ slug }, { headers: noStore });
    },
  };
}
