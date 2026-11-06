import type {
  Band,
  Contact,
  ConversationIndex,
  Gig,
  Member,
  OtherBand,
  Triage,
  Venue,
  VenueSurvey,
} from "@gigger/schemas";
import { bands, storage } from "../storage";

export interface BandData {
  band: Band;
  members: Member[];
  gigs: Gig[];
  venues: Venue[];
  contacts: Contact[];
  otherBands: OtherBand[];
  surveys: VenueSurvey[];
  triage: Triage[];
}

const byName = <T extends { name: string }>(items: T[]) =>
  items.sort((a, b) => a.name.localeCompare(b.name));

/** Everything the screens show, read from the account's storage. */
class Data {
  all = $state<BandData[]>([]);
  conversations = $state<ConversationIndex>({});
  pendingPublicDeletes = $state(false);
  loaded = $state(false);
  /** The chosen band ID, or "" for all bands. */
  bandId = $state("");
  current = $derived(this.all.find((item) => item.band.id === this.bandId));
  /** The bands in view: the chosen one, or all of them. */
  inView = $derived(this.current ? [this.current] : this.all);

  async load() {
    const token = storage.remote.token;
    const loaded = await Promise.all(
      (await bands.bands()).map(async (band) => {
        const [members, gigs, venues, contacts, otherBands, surveys, triage] =
          await Promise.all([
            bands.list("member", band.id),
            bands.list("gig", band.id),
            bands.list("venue", band.id),
            bands.list("contact", band.id),
            bands.list("otherBand", band.id),
            bands.list("survey", band.id),
            bands.list("triage", band.id),
          ]);
        return {
          band,
          members: byName(members),
          gigs,
          venues: byName(venues),
          contacts: byName(contacts),
          otherBands: byName(otherBands),
          surveys,
          triage,
        };
      }),
    );
    const [conversations, pending] = await Promise.all([
      bands.conversations().catch(() => ({})),
      bands.pendingDeletes(),
    ]);
    // A slower load from a previous session must not land in this one.
    if (token !== storage.remote.token) return;
    this.all = byBandName(loaded);
    this.conversations = conversations;
    this.pendingPublicDeletes = pending.length > 0;
    if (this.bandId && !this.all.some((b) => b.band.id === this.bandId))
      this.bandId = "";
    if (!this.loaded) {
      // No stored value (first-ever load) is distinct from an explicitly
      // remembered "All bands" (stored as ""), which must stay that way.
      const stored =
        localStorage.getItem("showday:band") ??
        localStorage.getItem("gigger:band");
      this.bandId =
        stored === null
          ? this.all.length === 1
            ? this.all[0].band.id
            : (this.all[0]?.band.id ?? "")
          : stored === "" || this.all.some((b) => b.band.id === stored)
            ? stored
            : (this.all[0]?.band.id ?? "");
    }
    this.loaded = true;
  }
  choose(bandId: string) {
    this.bandId = bandId;
    localStorage.removeItem("gigger:band");
    localStorage.setItem("showday:band", bandId);
  }
  band(bandId: string) {
    return this.all.find((item) => item.band.id === bandId);
  }
  reset() {
    this.all = [];
    this.conversations = {};
    this.loaded = false;
    this.bandId = "";
    this.pendingPublicDeletes = false;
  }
}
function byBandName(items: BandData[]) {
  return items.sort((a, b) => a.band.name.localeCompare(b.band.name));
}
export const data = new Data();
