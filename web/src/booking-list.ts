import type { Band, Gig, Venue } from "@gigger/schemas";

export interface BookingSummary {
  band: Band;
  gigs: Gig[];
  venues: Venue[];
}

export function groupBookings(summaries: BookingSummary[], bandId: string) {
  const rows = summaries
    .filter((item) => !bandId || item.band.id === bandId)
    .flatMap((item) =>
      item.gigs.map((gig) => ({
        gig,
        band: item.band,
        venueName:
          item.venues.find((v) => v.id === gig.venueId)?.name ?? gig.venue,
      })),
    );
  return (["confirmed", "offered", "enquiry", "played", "cancelled"] as const)
    .map((status) => ({
      status,
      rows: rows
        .filter((row) => row.gig.status === status)
        .sort((a, b) => a.gig.date.localeCompare(b.gig.date)),
    }))
    .filter((group) => group.rows.length);
}

export function playedAtVenue(gigs: Gig[], venue: Venue) {
  return gigs
    .filter(
      (gig) =>
        gig.status === "played" &&
        (gig.venueId === venue.id ||
          (!gig.venueId &&
            gig.venue === venue.name &&
            gig.address === venue.address)),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function searchNamed<T extends { name: string }>(
  items: T[],
  query: string,
): T[] {
  const normalize = (value: string) =>
    value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const needle = normalize(query.trim());
  if (!needle) return [];
  const matches: T[] = [];
  for (const item of items) {
    if (normalize(item.name).includes(needle)) matches.push(item);
    if (matches.length === 20) break;
  }
  return matches;
}
