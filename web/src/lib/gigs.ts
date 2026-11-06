import {
  type Contact,
  formatFee,
  type Gig,
  type Venue,
} from "@showday/schemas";
import type { BandData } from "./data.svelte";
import { fee, longDate, money, today } from "./format";

export const venueOf = (gig: Gig, venues: Venue[]) =>
  venues.find((v) => v.id === gig.venueId);
export const venueName = (gig: Gig, venues: Venue[]) =>
  venueOf(gig, venues)?.name ?? gig.venue ?? "";
export const venueAddress = (gig: Gig, venues: Venue[]) =>
  (venueOf(gig, venues)?.address ?? gig.address ?? "").trim();
/** "Café V lese · Prague" */
export function venueLine(gig: Gig, venues: Venue[]) {
  const venue = venueOf(gig, venues);
  return [venue?.name ?? gig.venue, venue?.city].filter(Boolean).join(" · ");
}
export const contactsOf = (gig: Gig, contacts: Contact[]) =>
  (gig.contactIds ?? [])
    .map((id) => contacts.find((c) => c.id === id))
    .filter((c): c is Contact => !!c);

/** Took home for played gigs, otherwise the agreed fee. */
export function amountText(gig: Gig, currency: string) {
  if (gig.status === "played" && gig.earnings)
    return money(gig.earnings.takeHome, gig.earnings.currency);
  return fee(gig, currency) ?? "";
}
export const isUpcoming = (gig: Gig, now = today()) =>
  gig.date >= now && gig.status !== "played" && gig.status !== "cancelled";

/** The next confirmed gig from today on, across the bands in view. */
export function nextGig(bands: BandData[], now = today()) {
  return bands
    .flatMap((data) =>
      data.gigs
        .filter((gig) => gig.status === "confirmed" && gig.date >= now)
        .map((gig) => ({ gig, data })),
    )
    .sort((a, b) => a.gig.date.localeCompare(b.gig.date))[0];
}

export const nextMove = {
  enquiry: "offered",
  offered: "confirmed",
  confirmed: "played",
} as const;
export const moveLabel = (status: string) => `Mark ${status}`;

/** Every scheduled time as a stat cell; StatCells wraps onto another row past four. */
export function timeCells(gig: Gig) {
  return [
    ...(gig.loadIn ? [{ label: "Load-in", value: gig.loadIn }] : []),
    ...(gig.soundcheck ? [{ label: "Soundcheck", value: gig.soundcheck }] : []),
    ...(gig.setTimes ?? []).map((value, i, all) => ({
      label: all.length > 1 ? `Set ${i + 1}` : "Set",
      value,
      ...(gig.setLength ? { note: `${gig.setLength} minutes` } : {}),
    })),
    ...(gig.setLength && !gig.setTimes?.length
      ? [{ label: "Set length", value: `${gig.setLength} min` }]
      : []),
  ];
}

/** The gig sheet as plain text, for email and the phone's share sheet. */
export function sheetText(gig: Gig, data: BandData) {
  const venue = venueOf(gig, data.venues);
  const address = venueAddress(gig, data.venues);
  const fee = formatFee(
    gig.fee,
    data.band.currency ?? "EUR",
    navigator.language,
  );
  const lines = [
    `${data.band.name}: ${gig.title}`,
    longDate(gig.date),
    "",
    venue?.name || gig.venue ? `Venue: ${venue?.name ?? gig.venue}` : "",
    address ? `Address: ${address}` : "",
    address
      ? `Map: https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`
      : "",
    gig.loadIn ? `Load-in: ${gig.loadIn}` : "",
    gig.soundcheck ? `Soundcheck: ${gig.soundcheck}` : "",
    gig.setTimes?.length ? `Sets: ${gig.setTimes.join(", ")}` : "",
    gig.setLength ? `Set length: ${gig.setLength} minutes` : "",
    // Matches GigSheet.svelte: linked contacts with every channel, plus any
    // legacy free-text contacts on gigs saved before contacts were linked.
    ...contactsOf(gig, data.contacts).map(
      (c) =>
        `Contact: ${[c.name, c.phone, c.email, c.messenger, c.instagram].filter(Boolean).join(" · ")}`,
    ),
    ...(gig.contacts ?? []).filter((c) => c.trim()).map((c) => `Contact: ${c}`),
    fee ? `Fee: ${fee}` : "",
    typeof gig.fee === "object" && gig.fee.extras.length
      ? `Extras: ${gig.fee.extras.join(", ")}`
      : "",
    gig.notes?.trim() ? `\nNotes:\n${gig.notes.trim()}` : "",
  ];
  return lines
    .filter((line, i) => line || lines[i - 1])
    .join("\n")
    .trim();
}
