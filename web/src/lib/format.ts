import {
  type Earnings,
  feeAmount,
  formatFee,
  formatMoney,
  type Gig,
} from "@showday/schemas";

/** The interface is English, so dates read in English too; money keeps the browser's locale. */
const dateLocale = "en-GB";

/** Parses a stored local date (YYYY-MM-DD) without shifting it through UTC. */
export function localDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function today(now = new Date()) {
  return now.toLocaleDateString("en-CA");
}
const fmt = (value: string, options: Intl.DateTimeFormatOptions) =>
  value ? localDate(value).toLocaleDateString(dateLocale, options) : "";

/** "Saturday, 14 November 2026" */
export const longDate = (value: string) =>
  fmt(value, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
/** "Sat 17 Jan" */
export const shortDate = (value: string) =>
  fmt(value, { weekday: "short", day: "numeric", month: "short" });
/** "14 Nov 2026" */
export const mediumDate = (value: string) =>
  fmt(value, { day: "numeric", month: "short", year: "numeric" });
export const weekday = (value: string) => fmt(value, { weekday: "short" });
export const monthShort = (value: string) => fmt(value, { month: "short" });
/** "November 2026" */
export const monthLabel = (value: string) =>
  fmt(value, { month: "long", year: "numeric" });
export const dayNumber = (value: string) =>
  value ? String(localDate(value).getDate()) : "";

/** Whole days from today to the date; negative in the past. */
export function daysUntil(value: string, now = new Date()) {
  const start = localDate(today(now));
  return Math.round((localDate(value).getTime() - start.getTime()) / 86400000);
}
export function inDays(value: string, now = new Date()) {
  const days = daysUntil(value, now);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `In ${days} days`;
  return days === -1 ? "Yesterday" : `${-days} days ago`;
}

/** Inbox times: "12m", "2h", "Yesterday", "Mon", "30 Oct". */
export function messageTime(iso: string | undefined, now = new Date()) {
  if (!iso) return "";
  const at = new Date(iso);
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const gap = -daysUntil(today(at), now);
  if (gap === 0) return `${Math.floor(minutes / 60)}h`;
  if (gap === 1) return "Yesterday";
  if (gap < 7) return at.toLocaleDateString(dateLocale, { weekday: "short" });
  return at.toLocaleDateString(dateLocale, { day: "numeric", month: "short" });
}
/** "Today 14:12", "Mon 3 Nov 09:30" */
export function messageTimeLong(iso: string | undefined, now = new Date()) {
  if (!iso) return "";
  const at = new Date(iso);
  const time = at.toLocaleTimeString(dateLocale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (today(at) === today(now)) return `Today ${time}`;
  return `${at.toLocaleDateString(dateLocale, { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

/** Money in the browser's locale; whole amounts drop the decimals ("€400", not "€400.00"). */
export function money(amount: number, currency: string) {
  if (!Number.isInteger(amount))
    return formatMoney(amount, currency, navigator.language);
  try {
    return new Intl.NumberFormat(navigator.language, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return formatMoney(amount, currency, navigator.language);
  }
}
export function fee(gig: Gig, bandCurrency: string) {
  const amount = feeAmount(gig.fee);
  if (amount !== undefined && typeof gig.fee === "object")
    return money(amount, gig.fee.currency ?? bandCurrency);
  return formatFee(gig.fee, bandCurrency, navigator.language);
}
export const takeHome = (earnings: Earnings) =>
  money(earnings.takeHome, earnings.currency);

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    (words.length > 1
      ? `${words[0][0]}${words[words.length - 1][0]}`
      : (words[0] ?? "?").slice(0, 2)
    ).toLocaleUpperCase() || "?"
  );
}
export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
export const capitalize = (value: string) =>
  value.charAt(0).toLocaleUpperCase() + value.slice(1);

/** Accent- and case-insensitive text for search. */
export const normalize = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();

export const mapUrl = (address: string) =>
  `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;

/** Adds https:// to a bare domain such as "venue.cz"; empty stays empty. */
export const withScheme = (url: string) => {
  const value = url.trim();
  return !value || /^https?:\/\//i.test(value) ? value : `https://${value}`;
};

/** Website, email and phone of a venue as links, in that order. */
export const venueLinks = (venue?: {
  website?: string;
  email?: string;
  phone?: string;
}) => [
  ...(venue?.website
    ? [
        {
          label: venue.website
            .replace(/^https?:\/\/(www\.)?/i, "")
            .replace(/\/$/, ""),
          href: venue.website,
          external: true,
        },
      ]
    : []),
  ...(venue?.email
    ? [{ label: venue.email, href: `mailto:${venue.email}`, external: false }]
    : []),
  ...(venue?.phone
    ? [
        {
          label: venue.phone,
          href: `tel:${venue.phone.replace(/[^\d+]/g, "")}`,
          external: false,
        },
      ]
    : []),
];

/** Widely used currencies, offered after the band's own ones. */
const commonCurrencies = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "CZK",
  "PLN",
  "HUF",
  "SEK",
  "NOK",
  "DKK",
  "CAD",
  "AUD",
  "NZD",
  "JPY",
];

/** Currency suggestions: the given codes first (band currency, ones in use), then common ones. */
export function currencyChoices(first: (string | undefined)[]) {
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {}
  const codes = new Set<string>();
  for (const code of [...first, ...commonCurrencies]) {
    const upper = code?.trim().toUpperCase();
    if (upper && /^[A-Z]{3}$/.test(upper)) codes.add(upper);
  }
  return [...codes].map((code) => {
    const name = names?.of(code);
    return { code, name: name && name !== code ? name : undefined };
  });
}

/** Every currency the band has used on a fee or earnings, most used first. */
export function usedCurrencies(gigs: Gig[]) {
  const counts = new Map<string, number>();
  for (const gig of gigs) {
    for (const code of [
      typeof gig.fee === "object" ? gig.fee.currency : undefined,
      gig.earnings?.currency,
    ]) {
      const upper = code?.toUpperCase();
      if (upper) counts.set(upper, (counts.get(upper) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([code]) => code);
}
