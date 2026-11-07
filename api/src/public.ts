import type { Database } from "bun:sqlite";
import {
  legacyLivePageTheme,
  migrateLegacyInstagram,
  normalizePublicWebsite,
  type PublicGig,
  type PublicPage,
  type PublicSocialLink,
  type SocialPlatform,
  STORAGE_MODULE_SLUG,
  slugPattern,
  socialPlatforms,
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
  const raw = input as Record<string, unknown>;
  const { background, text, accent, preset } = raw;
  if (
    typeof background !== "string" ||
    !hexColorRe.test(background) ||
    typeof text !== "string" ||
    !hexColorRe.test(text) ||
    typeof accent !== "string" ||
    !hexColorRe.test(accent)
  )
    return undefined;
  return {
    ...(typeof preset === "string" &&
    ["night", "paper", "gold", "red", "custom"].includes(preset)
      ? { preset: preset as NonNullable<PublicPage["theme"]>["preset"] }
      : {}),
    background,
    text,
    accent,
  };
}
function cleanSocials(input: unknown): PublicSocialLink[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const links: PublicSocialLink[] = [];
  const seen = new Set<string>();
  for (const value of input) {
    if (!value || typeof value !== "object") continue;
    const { platform, url } = value as Record<string, unknown>;
    if (
      typeof platform !== "string" ||
      !(socialPlatforms as readonly string[]).includes(platform) ||
      typeof url !== "string" ||
      !/^https?:\/\/[^\s/]+[^\s]*$/.test(url.trim()) ||
      seen.has(platform)
    )
      continue;
    seen.add(platform);
    links.push({
      platform: platform as PublicSocialLink["platform"],
      url: url.trim(),
    });
  }
  return links.length ? links : undefined;
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
    ...(typeof raw.website === "string"
      ? (() => {
          const website = normalizePublicWebsite(raw.website);
          return website && /^https?:\/\/[^\s/]+[^\s]*$/.test(website)
            ? { website }
            : {};
        })()
      : {}),
  };
  return Object.keys(contact).length ? contact : undefined;
}

/** Rebuilds the page from scratch with only the allowed public fields, whatever the stored document carries. */
export function cleanPage(input: unknown): PublicPage | null {
  if (!input || typeof input !== "object") return null;
  const {
    name,
    locale,
    gigs,
    bio,
    city,
    banner,
    bannerType,
    theme,
    contact,
    socials,
    instagram,
  } = input as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) return null;
  const clean: PublicPage = { name: name.trim(), gigs: {} };
  if (typeof locale === "string") {
    try {
      clean.locale = Intl.getCanonicalLocales(locale)[0];
    } catch {}
  }
  if (typeof city === "string" && city.trim())
    clean.city = city.trim().slice(0, 200);
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
  let cleanedSocials = cleanSocials(socials);
  const legacy = migrateLegacyInstagram(instagram);
  if (legacy && !cleanedSocials?.some((s) => s.platform === "instagram"))
    cleanedSocials = [...(cleanedSocials ?? []), legacy];
  if (cleanedSocials) clean.socials = cleanedSocials;
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

function pageColors(page: PublicPage) {
  const theme = page.theme ?? legacyLivePageTheme;
  return {
    background: theme.background,
    text: theme.text,
    accent: theme.accent,
    muted: `color-mix(in srgb, ${theme.text} 65%, ${theme.background})`,
    rule: `color-mix(in srgb, ${theme.text} 40%, ${theme.background})`,
    ticketText: theme.background,
  };
}
function pageCss(page: PublicPage) {
  const c = pageColors(page);
  return `
:root{--page-bg:${c.background};--page-text:${c.text};--page-accent:${c.accent};--bg:${c.background};--text:${c.text};--accent:${c.accent};--muted:${c.muted};--rule:${c.rule};--ticket-text:${c.ticketText}}
body{margin:0;background:var(--page-bg);color:var(--page-text);font:1.0625rem/1.55 Archivo,system-ui,sans-serif}
header,main,footer{max-width:36rem;margin:0 auto;padding:0 1.5rem;box-sizing:border-box}
header{padding-top:3rem}
.banner{margin:0 -1.5rem 1.5rem;aspect-ratio:5/2;max-height:26.25rem;overflow:hidden;background:var(--page-accent)}
.banner img{display:block;width:100%;height:100%;object-fit:cover;object-position:center}
h1{font-size:clamp(2rem,12vw,3.5rem);line-height:.95;margin:0 0 .6rem;font-weight:800;letter-spacing:-.03em;overflow-wrap:anywhere}
.lede,.bio{margin:0;color:var(--muted)}
.bio{margin-top:.75rem;font-size:1.0625rem;white-space:pre-wrap;color:var(--page-text)}
h2{font-size:.75rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin:2.75rem 0 0;padding-bottom:.4rem;border-bottom:2px solid var(--rule)}
.contact-links{margin:.75rem 0 0;display:grid;gap:.35rem}
.contact-links a{text-decoration:underline}
.socials{display:flex;flex-wrap:wrap;gap:.25rem;margin-top:1rem}
.socials a{display:inline-flex;align-items:center;justify-content:center;width:2.75rem;height:2.75rem;color:var(--page-text);opacity:.9;text-decoration:none}
.socials a:hover,.socials a:focus-visible{color:var(--page-accent);opacity:1}
.socials svg{width:1.375rem;height:1.375rem}
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
:focus-visible{outline:2px solid var(--page-text);outline-offset:2px}
@media (min-width:40rem){.gigs li{grid-template-columns:6rem 1fr}.day{font-size:4rem}header{padding-top:3rem}}
`;
}
const socialLabels: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  spotify: "Spotify",
  bandcamp: "Bandcamp",
  tiktok: "TikTok",
  soundcloud: "SoundCloud",
  x: "X",
};
function socialIcon(platform: SocialPlatform) {
  const icons: Record<SocialPlatform, string> = {
    instagram:
      '<path d="M16 3H8a5 5 0 0 0-5 5v8a5 5 0 0 0 5 5h8a5 5 0 0 0 5-5V8a5 5 0 0 0-5-5zm-4 13a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm4.5-7.9a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2z"/>',
    facebook:
      '<path d="M14 8h2.5V4H14c-2.2 0-3.5 1.3-3.5 3.5V10H8v4h2.5v8H15v-8h2.7l.5-4H15V7.8C15 8 14.2 8 14 8z"/>',
    youtube:
      '<path d="M21 8.2s-.2-1.4-.8-2c-.8-.9-1.6-.9-2-1C15.4 5 12 5 12 5s-3.4 0-6.2.2c-.4 0-1.2.1-2 1-.6.6-.8 2-.8 2S3 9.5 3 10.9v1.2c0 1.4.2 2.7.2 2.7s.2 1.4.8 2c.8.9 1.8.9 2.3 1 1.7.2 6.7.2 6.7.2s3.4 0 6.2-.2c.4 0 1.2-.1 2-1 .6-.6.8-2 .8-2s.2-1.3.2-2.7v-1.2c0-1.4-.2-2.7-.2-2.7zM10 15.5V8.5l6 3.5-6 3.5z"/>',
    spotify:
      '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.4c-.2.3-.6.4-.9.2-2.4-1.5-5.5-1.8-9.1-1-.4.1-.7-.2-.8-.5s.2-.7.5-.8c4-.9 7.4-.5 10 1.2.3.2.4.6.3.9zm1.1-2.4c-.2.4-.7.5-1 .2-2.8-1.7-7-2.2-10.3-1.2-.4.1-.9-.2-1-.6s.2-.9.6-1c3.8-1.2 8.4-.6 11.6 1.4.4.2.5.7.1 1.2zm.1-2.5c-3.2-1.9-8.5-2.1-11.6-1.2-.5.2-1-.1-1.1-.6s.1-1 .6-1.2c3.6-1.1 9.4-.9 13 1.5.5.3.6 1 0 1.5s-1 .5-1.5.2z"/>',
    bandcamp: '<path d="M4 6h8l4 6-4 6H4l4-6-4-6zm11 0h5v12h-5V6z"/>',
    tiktok:
      '<path d="M16 4.5c1.2 1.1 2.7 1.8 4.3 1.8v3.3c-1.6 0-3.1-.5-4.3-1.3v6.7c0 3.6-3 6.5-6.7 6.5S2.6 17.5 2.6 14 5.5 7.5 9.2 7.5c.5 0 1 .1 1.5.2v3.5a3.2 3.2 0 0 0-1.5-.4c-1.8 0-3.2 1.4-3.2 3.2s1.4 3.2 3.2 3.2 3.1-1.4 3.1-3.2V2h3.1c.1 1 .5 1.9 1.1 2.5z"/>',
    soundcloud:
      '<path d="M4 13.5c0 .8.7 1.5 1.5 1.5h13c2.2 0 4-1.6 4-3.5S20.7 8 18.5 8H17c0-2.8-2.2-5-5-5-1.5 0-2.8.7-3.7 1.7C7.8 4.2 6.7 4 5.5 4 3.6 4 2 5.6 2 7.5S3.6 11 5.5 11H6v2.5z"/>',
    x: '<path d="M18.9 3H22l-7 7.9L22.7 21H16l-5.3-6.8L5 21H2l7.5-8.6L1.7 3H8.4l4.8 6.3L18.9 3zm-1.5 16h1.4L7.2 4.9H5.7L17.4 19z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${icons[platform]}</svg>`;
}
function contactSection(page: PublicPage, cs: boolean) {
  const contact = page.contact;
  const socials = page.socials ?? [];
  const rows: string[] = [];
  if (contact?.email)
    rows.push(
      `<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>`,
    );
  if (contact?.phone)
    rows.push(
      `<a href="tel:${esc(contact.phone.replace(/\s/g, ""))}">${esc(contact.phone)}</a>`,
    );
  if (contact?.website) {
    const href = normalizePublicWebsite(contact.website) ?? contact.website;
    rows.push(
      `<a href="${esc(href)}" rel="noopener noreferrer">${esc(contact.website.replace(/^https?:\/\//, ""))}</a>`,
    );
  }
  if (!rows.length && !socials.length) return "";
  const title = cs ? "Kontakt" : "Contact";
  const links = rows.length
    ? `<div class="contact-links">${rows.join("")}</div>`
    : "";
  const icons = socials.length
    ? `<nav class="socials" aria-label="${esc(title)}">${socials
        .map(
          (link) =>
            `<a href="${esc(link.url)}" aria-label="${esc(socialLabels[link.platform])}" target="_blank" rel="noopener">${socialIcon(link.platform)}</a>`,
        )
        .join("")}</nav>`
    : "";
  return `<section class="contact" aria-labelledby="contact">
<h2 id="contact">${title}</h2>
${links}
${icons}
</section>`;
}

/** `base` is the URL prefix for the JSON and ICS links: "/b/<slug>/" when served, "" inside the export. */
export function renderPage(page: PublicPage, base: string, today: string) {
  const { upcoming, past } = splitGigs(page, today);
  const fmt = formatter(page.locale);
  const lang = page.locale ?? "en";
  const cs = lang.toLowerCase().split("-")[0] === "cs";
  const metaDescription = page.bio?.trim()
    ? page.bio.trim().slice(0, 160)
    : cs
      ? `Kde bude ${page.name} hrát.`
      : `Where ${page.name} plays next.`;
  const labels = cs
    ? {
        title: "živě",
        description: metaDescription,
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
        description: metaDescription,
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
  const lede = [
    ...(page.city ? [page.city] : []),
    upcoming.length ? labels.count : labels.none,
  ].join(" · ");
  const ogImage = page.banner
    ? `<meta property="og:image" content="${esc(`${base}banner`)}">`
    : "";
  return `<!doctype html>
<html lang="${cs ? "cs" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.name)} ${labels.title}</title>
<meta name="description" content="${esc(labels.description)}">
${ogImage}
<style>${pageCss(page)}</style>
</head>
<body>
<header>
${page.banner ? `<figure class="banner"><img src="${esc(base)}banner" alt=""></figure>` : ""}
<h1>${esc(page.name)}</h1>
<p class="lede">${esc(lede)}</p>
${page.bio ? `<p class="bio">${esc(page.bio)}</p>` : ""}
</header>
<main>
<section aria-labelledby="upcoming">
<h2 id="upcoming">${labels.upcoming}</h2>
${upcoming.length ? `<ol class="gigs">\n${upcomingItems}\n</ol>` : `<p class="empty">${labels.empty}</p>`}
</section>
${past.length ? `<section aria-labelledby="past">\n<h2 id="past">${labels.past}</h2>\n<ul class="past">\n${pastItems}\n</ul>\n</section>` : ""}
${contactSection(page, cs)}
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
      ...(page.city ? { city: page.city } : {}),
      ...(page.bio ? { bio: page.bio } : {}),
      ...(page.banner
        ? { banner: page.banner, bannerType: page.bannerType }
        : {}),
      ...(page.theme ? { theme: page.theme } : {}),
      ...(page.contact ? { contact: page.contact } : {}),
      ...(page.socials?.length ? { socials: page.socials } : {}),
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
