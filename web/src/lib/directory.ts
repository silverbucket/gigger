import { countryOfLocale, type Venue } from "@showday/schemas";
import { api } from "./api";
import type { BandData } from "./data.svelte";
import { normalize } from "./format";

/** A venue from the list every band shares: only name, address, city, country and website. */
export type DirectoryVenue = Pick<
  Venue,
  "id" | "name" | "address" | "city" | "country" | "website"
>;

const sameVenue = (a: DirectoryVenue, b: Venue) =>
  normalize(a.name) === normalize(b.name) &&
  normalize(a.address) === normalize(b.address);

/** Venues other bands added that match the query, minus the ones this band already has. */
export async function findShared(
  bandId: string,
  query: string,
  own: Venue[],
): Promise<DirectoryVenue[]> {
  if (normalize(query).length < 2) return [];
  try {
    const found = await api<DirectoryVenue[]>("/api/venues", {
      query: { bandId, q: query },
    });
    return found.filter((venue) => !own.some((v) => sameVenue(venue, v)));
  } catch {
    // Offline, or an account on another host: the band's own venues still work.
    return [];
  }
}

/** What has already been sent from this browser, so a reload doesn't send it again. */
const sentKey = "showday:shared-venues";
function sent(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(sentKey) ?? "{}");
  } catch {
    return {};
  }
}
const fingerprint = (venue: Venue) =>
  JSON.stringify([
    venue.name,
    venue.address,
    venue.city,
    venue.country,
    venue.website,
  ]);

/** Adds the venue's public basics to the shared list. Never its email, phone, surveys or notes. Failures wait for the next load. */
export async function shareVenue(bandId: string, venue: Venue) {
  const key = `${bandId}/${venue.id}`;
  if (sent()[key] === fingerprint(venue)) return;
  try {
    await api("/api/venues", {
      method: "POST",
      body: {
        bandId,
        sourceId: venue.id,
        name: venue.name,
        address: venue.address,
        ...(venue.city ? { city: venue.city } : {}),
        ...(venue.country ? { country: venue.country } : {}),
        ...(venue.website ? { website: venue.website } : {}),
      },
    });
    try {
      localStorage.setItem(
        sentKey,
        JSON.stringify({ ...sent(), [key]: fingerprint(venue) }),
      );
    } catch {
      // Without localStorage the venue is simply sent again next time.
    }
  } catch {
    // Tried again on the next load.
  }
}

/** Shares every venue the bands have, including ones added before the shared list existed. */
export async function shareAll(all: BandData[]) {
  for (const { band, venues } of all)
    for (const venue of venues) await shareVenue(band.id, venue);
}

/** The country most of the band's venues are in, else the region of the band's public page locale. Otherwise left for the user to pick: a browser's "en-US" says little about where a band plays. */
export function usualCountry(data: BandData) {
  const counts = new Map<string, number>();
  for (const venue of data.venues)
    if (venue.country)
      counts.set(venue.country, (counts.get(venue.country) ?? 0) + 1);
  const [top] = [...counts].sort((a, b) => b[1] - a[1]);
  return top?.[0] ?? countryOfLocale(data.band.locale);
}
