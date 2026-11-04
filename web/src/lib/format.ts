import {
  type Earnings,
  feeAmount,
  formatFee,
  formatMoney,
  type Gig,
} from "@gigger/schemas";

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
