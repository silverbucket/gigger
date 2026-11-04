import type { Venue } from "@gigger/schemas";
import { normalize, shortDate, today } from "./format";

/** What an enquiry message seems to ask for. Everything is a suggestion to check before saving. */
export interface Extracted {
  /** YYYY-MM-DD */
  date?: string;
  venueId?: string;
  /** A venue name that is not in the band's venues yet. */
  newVenue?: string;
  fee?: { amount: number; currency: string };
  sets?: number;
  /** HH:mm the band would start playing. */
  start?: string;
  /** HH:mm the doors open. */
  doors?: string;
}

const months: [RegExp, number][] = [
  [/^(jan(uary)?|ledna|leden)$/, 1],
  [/^(feb(ruary)?|unora|unor)$/, 2],
  [/^(mar(ch)?|brezna|brezen)$/, 3],
  [/^(apr(il)?|dubna|duben)$/, 4],
  [/^(may|kvetna|kveten)$/, 5],
  [/^(jun(e)?|cervna|cerven)$/, 6],
  [/^(jul(y)?|cervence|cervenec)$/, 7],
  [/^(aug(ust)?|srpna|srpen)$/, 8],
  [/^(sep(t(ember)?)?|zari)$/, 9],
  [/^(oct(ober)?|rijna|rijen)$/, 10],
  [/^(nov(ember)?|listopadu|listopad)$/, 11],
  [/^(dec(ember)?|prosince|prosinec)$/, 12],
];
const monthNumber = (word: string) =>
  months.find(([pattern]) => pattern.test(word.replace(/\.$/, "")))?.[1];
const pad = (n: number) => String(n).padStart(2, "0");
const words: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  a: 1,
  single: 1,
  jeden: 1,
  dva: 2,
  dve: 2,
  tri: 3,
};

/** The next date on or after today when no year is given. */
function resolve(
  day: number,
  month: number,
  year: number | undefined,
  now: Date,
) {
  if (day < 1 || day > 31 || month < 1 || month > 12) return undefined;
  let y = year ?? now.getFullYear();
  if (y < 100) y += 2000;
  let value = `${y}-${pad(month)}-${pad(day)}`;
  if (!year && value < today(now)) value = `${y + 1}-${pad(month)}-${pad(day)}`;
  const check = new Date(Number(value.slice(0, 4)), month - 1, day);
  return check.getDate() === day ? value : undefined;
}

/** The date found earliest in the text, regardless of which format matched it. */
function findDate(text: string, now: Date) {
  const plain = normalize(text);
  const at = (index: number, value: string | undefined) =>
    value ? { value, index } : undefined;
  const year = (value?: string) => (value ? Number(value) : undefined);
  const candidates: { value: string; index: number }[] = [];

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(plain);
  const isoFound =
    iso &&
    at(iso.index, resolve(Number(iso[3]), Number(iso[2]), Number(iso[1]), now));
  if (isoFound) candidates.push(isoFound);
  // 17 Jan 2027, 17th of January, 17. ledna
  const dayFirst =
    /\b(\d{1,2})(?:st|nd|rd|th)?\.?\s+(?:of\s+)?([a-z]{3,9}\.?)(?:,?\s+(\d{4}))?/g;
  for (const match of plain.matchAll(dayFirst)) {
    const month = monthNumber(match[2]);
    const found =
      month &&
      at(match.index, resolve(Number(match[1]), month, year(match[3]), now));
    if (found) {
      candidates.push(found);
      break;
    }
  }
  // January 17, Jan 17th 2027
  const monthFirst =
    /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/g;
  for (const match of plain.matchAll(monthFirst)) {
    const month = monthNumber(match[1]);
    const found =
      month &&
      at(match.index, resolve(Number(match[2]), month, year(match[3]), now));
    if (found) {
      candidates.push(found);
      break;
    }
  }
  // 17.1.2027, 17/1, 17.1.
  const numeric = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/.exec(plain);
  const numericFound =
    numeric &&
    at(
      numeric.index,
      resolve(Number(numeric[1]), Number(numeric[2]), year(numeric[3]), now),
    );
  if (numericFound) candidates.push(numericFound);

  return candidates.sort((a, b) => a.index - b.index)[0];
}

const currencies: [RegExp, string][] = [
  [/€|eur(os?)?\b/, "EUR"],
  [/kc\b|czk\b|korun/, "CZK"],
  [/\$|usd\b/, "USD"],
  [/£|gbp\b/, "GBP"],
  [/zl\b|pln\b/, "PLN"],
  [/chf\b/, "CHF"],
];
function findFee(text: string, fallbackCurrency: string) {
  const plain = normalize(text);
  const amount = String.raw`(\d{1,3}(?:[  .,]\d{3})+|\d+)(?:[.,](\d{1,2}))?`;
  const symbol = String.raw`(€|\$|£|eur|czk|kc|usd|gbp|pln|zl|chf|euros?|korun)`;
  const after = new RegExp(`${amount}\\s?${symbol}`).exec(plain);
  const before = new RegExp(`${symbol}\\s?${amount}`).exec(plain);
  const match = after
    ? { value: after[1], cents: after[2], symbol: after[3] }
    : before
      ? { value: before[2], cents: before[3], symbol: before[1] }
      : undefined;
  if (match) {
    const currency =
      currencies.find(([pattern]) => pattern.test(match.symbol))?.[1] ??
      fallbackCurrency;
    const whole = Number(match.value.replace(/[  .,]/g, ""));
    return {
      amount: match.cents ? Number(`${whole}.${match.cents}`) : whole,
      currency,
    };
  }
  const budget =
    /\b(?:budget|fee|pay|paying|honorar)\D{0,20}(\d[\d ]{1,8})/.exec(plain);
  return budget
    ? {
        amount: Number(budget[1].replace(/\s/g, "")),
        currency: fallbackCurrency,
      }
    : undefined;
}

function findSets(text: string) {
  const match =
    /\b(\d|one|two|three|four|five|a|single|jeden|dva|dve|tri)\s+(?:long\s+|short\s+|\d+[- ]?min(?:ute)?s?\s+)?(sets?|bloky|bloku|blok)\b/.exec(
      normalize(text),
    );
  if (!match) return undefined;
  const value = Number(match[1]) || words[match[1]];
  return value > 0 ? value : undefined;
}

/**
 * A time after one of `words`. Bare hours ("doors 8") count on their own, but
 * after `looseWords` (generic enough to precede a date or a set count, e.g.
 * "could you play 17 Jan") a minute suffix or am/pm/h marker is required, so
 * the day number or set count is never read as the hour.
 */
function findTime(text: string, words: string, looseWords?: string) {
  const gap = String.raw`[^\d\n]{0,12}`;
  const hour = String.raw`(\d{1,2})`;
  const marker = "am|pm|h";
  const anyTime = `${hour}(?:[:.](\\d{2}))?\\s*(${marker})?`;
  // Require a minute or a meridiem marker (a bare hour after a loose word is
  // too ambiguous), but still capture both when "9:30pm" has both.
  const strictTime = `${hour}(?=[:.]\\d{2}|\\s*(?:${marker}))(?:[:.](\\d{2}))?\\s*(${marker})?`;
  const pattern = looseWords
    ? `\\b(?:${words})\\b${gap}${anyTime}|\\b(?:${looseWords})\\b${gap}${strictTime}`
    : `\\b(?:${words})\\b${gap}${anyTime}`;
  const match = new RegExp(pattern).exec(normalize(text));
  if (!match) return undefined;
  const hourText = match[1] ?? match[4];
  const minute = match[2] ?? match[5];
  const ampm = match[3] ?? match[6];
  let value = Number(hourText);
  if (ampm === "pm" && value < 12) value += 12;
  else if (ampm === "am" && value === 12) value = 0;
  if (value > 23) return undefined;
  return `${pad(value)}:${minute ?? "00"}`;
}

/** A known venue named in the text; with several, the one nearest the date (the others are usually past shows). */
function findVenue(text: string, venues: Venue[], dateAt?: number) {
  const plain = normalize(text);
  const known = venues
    .map((venue) => {
      const name = normalize(venue.name);
      return { venue, at: name.length > 2 ? plain.lastIndexOf(name) : -1 };
    })
    .filter((found) => found.at >= 0)
    .sort((a, b) =>
      dateAt === undefined
        ? b.at - a.at
        : Math.abs(a.at - dateAt) - Math.abs(b.at - dateAt),
    )[0]?.venue;
  if (known) return { venueId: known.id };
  // "at Café Neustadt on 21 Feb": capitalised words after "at", "in" or Czech "v"/"ve".
  const match =
    /\b(?:at|v|ve)\s+((?:the\s+)?[\p{Lu}][\p{L}'’&-]*(?:\s+(?:[\p{Lu}][\p{L}'’&-]*|&|de|du|na|u)){0,4})/u.exec(
      text,
    );
  const name = match?.[1]?.replace(/\s+(on|in|at)$/i, "").trim();
  if (
    !name ||
    monthNumber(normalize(name)) ||
    /^(the\s+)?\p{Lu}[a-z]{0,2}$/u.test(name)
  )
    return {};
  return { newVenue: name };
}

export function extractEnquiry(
  text: string,
  venues: Venue[],
  currency: string,
  now = new Date(),
): Extracted {
  const date = findDate(text, now);
  const result: Extracted = {
    date: date?.value,
    ...findVenue(text, venues, date?.index),
    fee: findFee(text, currency),
    sets: findSets(text),
    start: findTime(text, "start|starting|set at|on stage", "play|playing"),
    doors: findTime(text, "doors|door opens|doors open"),
  };
  for (const key of Object.keys(result) as (keyof Extracted)[])
    if (result[key] === undefined) delete result[key];
  return result;
}

/** "Kabinet Múz — Sat 17 Jan", or a fallback from the sender. */
export function enquiryTitle(
  extracted: Extracted,
  venues: Venue[],
  sender: string,
) {
  const venue =
    venues.find((v) => v.id === extracted.venueId)?.name ?? extracted.newVenue;
  const date = extracted.date ? shortDate(extracted.date) : "";
  if (venue && date) return `${venue} — ${date}`;
  if (venue) return venue;
  return `Enquiry from ${sender}${date ? ` — ${date}` : ""}`;
}
