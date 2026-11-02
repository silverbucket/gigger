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
