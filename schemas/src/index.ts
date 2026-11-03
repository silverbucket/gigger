export interface Band {
  id: string;
  name: string;
  currency?: string;
  /** Public page address; set once the band publishes. */
  slug?: string;
  /** BCP 47 locale for public dates and times, e.g. "cs-CZ". */
  locale?: string;
}
export interface Member {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  messenger?: string;
}
export const gigStatuses = [
  "enquiry",
  "offered",
  "confirmed",
  "played",
  "cancelled",
] as const;
export type GigStatus = (typeof gigStatuses)[number];
export interface Gig {
  id: string;
  title: string;
  venueId?: string;
  contactIds?: string[];
  otherBandIds?: string[];
  /** Legacy records remain readable. New forms use linked records. */
  venue?: string;
  address?: string;
  contacts?: string[];
  contactDate?: string;
  enquiryText?: string;
  enquirySource?: EnquirySource;
  setLength?: number;
  public?: { ticketUrl?: string; description?: string };
  date: string;
  loadIn?: string;
  soundcheck?: string;
  setTimes?: string[];
  /** Legacy fees are free text or a text amount; new fees are a number plus currency. */
  fee?:
    | string
    | { amount?: string | number; currency?: string; extras: string[] };
  notes?: string;
  earnings?: Earnings;
  status: GigStatus;
}
export interface Venue {
  id: string;
  name: string;
  address: string;
  city?: string;
}
/** The only gig fields that ever leave private storage. */
export interface PublicGig {
  date: string;
  start?: string;
  venue: string;
  city?: string;
  ticketUrl?: string;
  description?: string;
}
export interface PublicPage {
  name: string;
  locale?: string;
  gigs: Record<string, PublicGig>;
}
export const publicStatuses: readonly GigStatus[] = ["confirmed", "played"];
export function publicGig(gig: Gig, venue?: Venue): PublicGig {
  return {
    date: gig.date,
    ...(gig.setTimes?.[0] ? { start: gig.setTimes[0] } : {}),
    venue: venue?.name ?? gig.venue ?? "",
    ...(venue?.city ? { city: venue.city } : {}),
    ...(gig.public?.ticketUrl ? { ticketUrl: gig.public.ticketUrl } : {}),
    ...(gig.public?.description?.trim()
      ? { description: gig.public.description.trim() }
      : {}),
  };
}
export const slugPattern = "^[a-z0-9]+(-[a-z0-9]+)*$";
export function slugify(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}
export const capacities = [
  "under 50",
  "50–100",
  "100–250",
  "250–500",
  "500+",
] as const;
export const paOptions = [
  "venue provided",
  "we brought our own",
  "mixed",
] as const;
export const dealTypes = [
  "fixed fee",
  "door",
  "pass the hat",
  "bar percentage",
  "mixed",
] as const;
/** One record per played gig, keyed by the gig ID, so concurrent saves never overwrite each other. */
export interface VenueSurvey {
  id: string;
  venueId: string;
  date: string;
  rating: number;
  capacity: (typeof capacities)[number];
  setting: "indoor" | "outdoor";
  pa: (typeof paOptions)[number];
  stageNotes?: string;
  playAgain: boolean;
}
export type SurveyInput = Pick<
  VenueSurvey,
  "rating" | "capacity" | "setting" | "pa" | "stageNotes" | "playAgain"
>;
export interface Earnings {
  dealType: (typeof dealTypes)[number];
  door?: number;
  hat?: number;
  bar?: number;
  total: number;
  numberOfBands?: number;
  handedOver?: number;
  takeHome: number;
  currency: string;
}
export function calculateTakeHome(
  total: number,
  numberOfBands?: number,
  handedOver?: number,
) {
  return (
    Math.round(
      (handedOver !== undefined
        ? total - handedOver
        : total / (numberOfBands ?? 1)) * 100,
    ) / 100
  );
}
const zeroDecimalCurrencies = new Set(["CZK"]);
/** Formats money in the browser's locale, e.g. "14 000 Kč" for cs-CZ. */
export function formatMoney(amount: number, currency: string, locale?: string) {
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      ...(zeroDecimalCurrencies.has(code) ? { maximumFractionDigits: 0 } : {}),
    }).format(amount);
  } catch {
    return `${amount} ${code}`;
  }
}
/** Numeric fee amount, or undefined for legacy text fees. */
export function feeAmount(fee: Gig["fee"]) {
  return typeof fee === "object" && typeof fee.amount === "number"
    ? fee.amount
    : undefined;
}
export function formatFee(
  fee: Gig["fee"],
  bandCurrency: string,
  locale?: string,
) {
  if (typeof fee === "string") return fee.trim() || undefined;
  if (typeof fee?.amount === "number")
    return formatMoney(fee.amount, fee.currency ?? bandCurrency, locale);
  return fee?.amount?.trim() || undefined;
}
const regionCurrencies: Record<string, string> = {
  CZ: "CZK",
  PL: "PLN",
  HU: "HUF",
  CH: "CHF",
  GB: "GBP",
  US: "USD",
  CA: "CAD",
  AU: "AUD",
  NZ: "NZD",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  IS: "ISK",
  RO: "RON",
  JP: "JPY",
  BR: "BRL",
  MX: "MXN",
};
/** Currency for a browser locale, e.g. "cs" or "cs-CZ" gives CZK; euro countries and unknown regions get EUR. */
export function currencyForLocale(locale?: string) {
  try {
    const region = new Intl.Locale(locale ?? "").maximize().region;
    return (region && regionCurrencies[region]) || "EUR";
  } catch {
    return "EUR";
  }
}
export function venueAverages(surveys: VenueSurvey[]) {
  if (!surveys.length) return null;
  const counts = capacities.map(
    (capacity) => surveys.filter((s) => s.capacity === capacity).length,
  );
  const most = Math.max(...counts);
  return {
    rating: surveys.reduce((sum, s) => sum + s.rating, 0) / surveys.length,
    capacities: capacities.filter((_, i) => counts[i] === most),
    paProvided: surveys.filter((s) => s.pa === "venue provided").length,
    count: surveys.length,
  };
}
export interface OtherBand {
  id: string;
  name: string;
  contactIds: string[];
  notes?: string;
}
export interface Contact {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  messenger?: string;
  instagram?: string;
  notes?: string;
}
export const enquirySources = [
  "messenger",
  "instagram",
  "email",
  "other",
] as const;
export type EnquirySource = (typeof enquirySources)[number];
export const statusMoves: Record<GigStatus, readonly GigStatus[]> = {
  enquiry: ["offered", "cancelled"],
  offered: ["confirmed", "cancelled"],
  confirmed: ["played", "cancelled"],
  played: [],
  cancelled: [],
};
export function canMoveStatus(from: GigStatus, to: GigStatus) {
  return statusMoves[from]?.includes(to) ?? false;
}
export interface Records {
  band: Band;
  member: Member;
  gig: Gig;
  venue: Venue;
  survey: VenueSurvey;
  contact: Contact;
  otherBand: OtherBand;
}
const text = { type: "string", minLength: 1, pattern: "\\S" };
const email = {
  type: "string",
  format: "email",
  pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
};
const id = { type: "string", pattern: "^[A-Za-z0-9_-]+$" };
const date = {
  type: "string",
  format: "date",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
};
const time = { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" };
function object(
  properties: Record<string, unknown>,
  required: string[],
  extra = {},
) {
  return {
    type: "object",
    properties: { "@context": { type: "string" }, id, ...properties },
    required: ["id", ...required],
    additionalProperties: false,
    ...extra,
  };
}
const money = { type: "number", minimum: 0 };
const currency = { type: "string", pattern: "^[A-Z]{3}$" };
const ticketUrl = { type: "string", pattern: "^https?://[^\\s/]+[^\\s]*$" };
const publicGigSchema = {
  type: "object",
  properties: {
    "@context": { type: "string" },
    date,
    start: time,
    venue: { type: "string" },
    city: text,
    ticketUrl,
    description: { type: "string" },
  },
  required: ["date", "venue"],
  additionalProperties: false,
};
export const publicSchemas = {
  publicGig: publicGigSchema,
  publicPage: {
    type: "object",
    properties: {
      "@context": { type: "string" },
      name: text,
      locale: { type: "string", pattern: "^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$" },
      gigs: { type: "object", additionalProperties: publicGigSchema },
    },
    required: ["name", "gigs"],
    additionalProperties: false,
  },
};
const surveyFields = {
  venueId: id,
  date,
  rating: { type: "integer", minimum: 1, maximum: 5 },
  capacity: { enum: [...capacities] },
  setting: { enum: ["indoor", "outdoor"] },
  pa: { enum: [...paOptions] },
  stageNotes: { type: "string" },
  playAgain: { type: "boolean" },
};
export const surveySchema = object(surveyFields, [
  "venueId",
  "date",
  "rating",
  "capacity",
  "setting",
  "pa",
  "playAgain",
]);
const earningsSchema = {
  type: "object",
  properties: {
    dealType: { enum: [...dealTypes] },
    door: money,
    hat: money,
    bar: money,
    total: money,
    numberOfBands: { type: "integer", minimum: 1 },
    handedOver: money,
    takeHome: money,
    currency,
  },
  required: ["dealType", "total", "takeHome", "currency"],
  additionalProperties: false,
  not: { required: ["numberOfBands", "handedOver"] },
};
export const schemas = {
  band: object(
    {
      name: text,
      currency,
      slug: { type: "string", pattern: slugPattern },
      locale: publicSchemas.publicPage.properties.locale,
    },
    ["name"],
  ),
  member: object({ name: text, phone: text, email, messenger: text }, ["name"]),
  gig: object(
    {
      earnings: earningsSchema,
      title: text,
      venueId: id,
      contactIds: { type: "array", items: id, uniqueItems: true },
      otherBandIds: { type: "array", items: id, uniqueItems: true },
      contactDate: date,
      enquiryText: { type: "string" },
      enquirySource: { enum: [...enquirySources] },
      setLength: { type: "integer", minimum: 1 },
      public: {
        type: "object",
        properties: { ticketUrl, description: { type: "string" } },
        additionalProperties: false,
      },
      venue: text,
      address: text,
      contacts: { type: "array", items: text },
      date,
      loadIn: time,
      soundcheck: time,
      setTimes: { type: "array", items: time },
      fee: {
        anyOf: [
          { type: "string" },
          {
            type: "object",
            properties: {
              amount: { anyOf: [text, money] },
              currency,
              extras: { type: "array", items: text },
            },
            required: ["extras"],
            additionalProperties: false,
          },
        ],
      },
      notes: { type: "string" },
      status: { enum: [...gigStatuses] },
    },
    ["title", "date", "status"],
    {
      anyOf: [
        { required: ["venueId", "contactIds"] },
        { required: ["venue", "address", "contacts"] },
      ],
    },
  ),
  venue: object({ name: text, address: text, city: text }, ["name", "address"]),
  survey: surveySchema,
  otherBand: object(
    {
      name: text,
      contactIds: { type: "array", items: id, uniqueItems: true },
      notes: { type: "string" },
    },
    ["name", "contactIds"],
  ),
  contact: object(
    {
      name: text,
      phone: text,
      email,
      messenger: text,
      instagram: text,
      notes: { type: "string" },
    },
    ["name"],
  ),
};
export type Kind = keyof Records;
export interface Client {
  declareType(name: string, schema: object): unknown;
  storeObject(name: string, path: string, value: object): Promise<unknown>;
  getObject(path: string, maxAge?: false | number): Promise<unknown>;
  getAll(path: string): Promise<unknown>;
  getListing(path: string): Promise<unknown>;
  validate(value: object): { valid?: boolean };
  remove(path: string): Promise<unknown>;
}
function safeId(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid ID");
  return value;
}
export function recordPath(kind: Kind, bandId: string, recordId = bandId) {
  const base = `bands/${safeId(bandId)}/`;
  return kind === "band"
    ? `${base}band`
    : `${base}${kind}s/${safeId(recordId)}`;
}
export function createGigger(client: Client, publicClient?: Client) {
  for (const [kind, schema] of Object.entries(schemas))
    client.declareType(kind, schema);
  for (const [kind, schema] of Object.entries(publicSchemas))
    publicClient?.declareType(kind, schema);
  function read<K extends Kind>(kind: K, value: unknown): Records[K] {
    if (
      !value ||
      typeof value !== "object" ||
      !client.validate({
        ...value,
        "@context": `http://remotestorage.io/spec/modules/gigger/${kind}`,
      }).valid
    ) {
      throw new Error(`Invalid ${kind} record in storage`);
    }
    return value as Records[K];
  }
  /** Undefined when the band record is missing; a band with no slug has no public page. */
  async function publicBand(bandId: string) {
    const stored = await client.getObject(recordPath("band", bandId));
    const current = stored ? read("band", stored) : undefined;
    return publicClient && current?.slug ? current : undefined;
  }
  /** Writes or removes the public copy of one gig; the page index is rebuilt separately. */
  async function publishGig(slug: string, bandId: string, gig: Gig) {
    if (!publicClient) return;
    const path = `${slug}/gigs/${safeId(gig.id)}`;
    if (!publicStatuses.includes(gig.status)) {
      const existing =
        (await publicClient.getObject(path)) ??
        (await publicClient.getObject(path, 0).catch((error: unknown) => {
          if (String(error).includes("remote is not connected"))
            return undefined;
          throw error;
        }));
      if (existing) await publicClient.remove(path);
      return;
    }
    const venue = gig.venueId
      ? read(
          "venue",
          await client.getObject(recordPath("venue", bandId, gig.venueId)),
        )
      : undefined;
    await publicClient.storeObject("publicGig", path, publicGig(gig, venue));
  }
  /** Public folder listings need auth, so the page is one public document the API can read. */
  async function publishPage(current: Band) {
    if (!publicClient || !current.slug) return;
    const docs = (await publicClient.getAll(`${current.slug}/gigs/`)) ?? {};
    const gigs: Record<string, PublicGig> = {};
    for (const [id, doc] of Object.entries(docs as Record<string, unknown>)) {
      if (!doc || typeof doc !== "object") continue;
      const { date, start, venue, city, ticketUrl, description } =
        doc as PublicGig;
      gigs[id] = { date, start, venue, city, ticketUrl, description };
      for (const key of Object.keys(gigs[id]) as (keyof PublicGig)[])
        if (gigs[id][key] === undefined) delete gigs[id][key];
    }
    await publicClient.storeObject("publicPage", `${current.slug}/page`, {
      name: current.name,
      ...(current.locale ? { locale: current.locale } : {}),
      gigs,
    });
  }
  const publications = new Map<string, Promise<void>>();
  async function queuePublication(bandId: string, work: () => Promise<void>) {
    const previous = publications.get(bandId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    publications.set(bandId, next);
    try {
      await next;
    } finally {
      if (publications.get(bandId) === next) publications.delete(bandId);
    }
  }
  async function publish(bandId: string, gig: Gig) {
    await queuePublication(bandId, async () => {
      const current = await publicBand(bandId);
      if (!current?.slug) return;
      await publishGig(current.slug, bandId, gig);
      await publishPage(current);
    });
  }
  async function removePublic(slug: string) {
    if (!publicClient) return;
    const listing = (await publicClient.getListing(`${slug}/gigs/`)) ?? {};
    for (const id of Object.keys(listing))
      await publicClient.remove(`${slug}/gigs/${id}`);
    await publicClient.remove(`${slug}/page`);
  }
  async function list<K extends Exclude<Kind, "band">>(
    kind: K,
    bandId: string,
  ): Promise<Records[K][]> {
    const listing = await client.getListing(
      `bands/${safeId(bandId)}/${kind}s/`,
    );
    return Promise.all(
      Object.keys(listing ?? {}).map(async (recordId) => {
        const path = recordPath(kind, bandId, recordId);
        const cached = await client.getObject(path);
        // A fresh folder listing can arrive before its children are cached.
        return read(kind, cached ?? (await client.getObject(path, 0)));
      }),
    );
  }
  return {
    /** Rewrites every public copy for the band; call after changing its slug. */
    async publishBand(bandId: string, previousSlug?: string) {
      await queuePublication(bandId, async () => {
        const current = await publicBand(bandId);
        if (!current?.slug) return;
        if (previousSlug && previousSlug !== current.slug)
          await removePublic(previousSlug);
        for (const gig of await list("gig", bandId))
          await publishGig(current.slug, bandId, gig);
        await publishPage(current);
      });
    },
    async save<K extends Kind>(kind: K, bandId: string, value: Records[K]) {
      if (kind === "band" && value.id !== bandId)
        throw new Error("Band ID must match its path");
      if (kind === "gig") {
        const gig = value as Gig;
        const previous = await client.getObject(
          recordPath("gig", bandId, gig.id),
        );
        if (previous) {
          const old = read("gig", previous);
          if (
            old.status !== gig.status &&
            !canMoveStatus(old.status, gig.status)
          )
            throw new Error(
              "This gig changed somewhere else, reload to see the latest",
            );
        }
        for (const [relatedKind, relatedId] of [
          ...(gig.venueId ? [["venue", gig.venueId] as const] : []),
          ...(gig.contactIds ?? []).map((id) => ["contact", id] as const),
          ...(gig.otherBandIds ?? []).map((id) => ["otherBand", id] as const),
        ]) {
          const related = await client.getObject(
            recordPath(relatedKind, bandId, relatedId),
          );
          read(relatedKind, related);
        }
      }
      if (kind === "otherBand") {
        for (const contactId of (value as OtherBand).contactIds) {
          read(
            "contact",
            await client.getObject(recordPath("contact", bandId, contactId)),
          );
        }
      }
      await client.storeObject(kind, recordPath(kind, bandId, value.id), value);
      if (kind === "gig") await publish(bandId, value as Gig);
    },
    async markPlayed(
      bandId: string,
      gigId: string,
      survey: SurveyInput,
      earnings: Earnings,
    ) {
      const path = recordPath("gig", bandId, gigId);
      const current = read("gig", await client.getObject(path));
      if (current.status === "played") {
        await publish(bandId, current);
        return current;
      }
      if (current.status !== "confirmed")
        throw new Error("Reload this gig before marking it played.");
      const venueId = current.venueId ?? `gig-${current.id}`;
      const existing = await client.getObject(
        recordPath("venue", bandId, venueId),
      );
      const venue = existing
        ? read("venue", existing)
        : read("venue", {
            id: venueId,
            name: current.venue,
            address: current.address,
          });
      // Explicitly select survey fields: private earnings must never enter survey data.
      const cleanSurvey = read("survey", {
        id: current.id,
        venueId,
        date: current.date,
        rating: survey.rating,
        capacity: survey.capacity,
        setting: survey.setting,
        pa: survey.pa,
        ...(survey.stageNotes?.trim()
          ? { stageNotes: survey.stageNotes.trim() }
          : {}),
        playAgain: survey.playAgain,
      });
      const updated = read("gig", {
        ...current,
        venueId,
        status: "played",
        earnings,
      });
      if (
        earnings.handedOver !== undefined &&
        earnings.handedOver > earnings.total
      )
        throw new Error("Amount handed over cannot exceed total takings.");
      if (!existing)
        await client.storeObject(
          "venue",
          recordPath("venue", bandId, venueId),
          venue,
        );
      // Each survey is its own record keyed by gig; a retry simply rewrites it.
      await client.storeObject(
        "survey",
        recordPath("survey", bandId, current.id),
        cleanSurvey,
      );
      await client.storeObject("gig", path, updated);
      await publish(bandId, updated);
      return updated;
    },
    async moveGigStatus(bandId: string, gigId: string, status: GigStatus) {
      const path = recordPath("gig", bandId, gigId);
      const current = read("gig", await client.getObject(path));
      if (current.status === status) {
        await publish(bandId, current);
        return current;
      }
      if (!canMoveStatus(current.status, status))
        throw new Error(
          "This gig changed somewhere else, reload to see the latest",
        );
      const updated = { ...current, status };
      await client.storeObject("gig", path, updated);
      await publish(bandId, updated);
      return updated;
    },
    async removeMember(bandId: string, memberId: string) {
      await client.remove(recordPath("member", bandId, memberId));
    },
    async bands(): Promise<Band[]> {
      const folders = await client.getListing("bands/");
      const bands = await Promise.all(
        Object.keys(folders ?? {})
          .filter((key) => key.endsWith("/"))
          .map((key) => client.getObject(recordPath("band", key.slice(0, -1)))),
      );
      return bands.filter(Boolean).map((band) => read("band", band));
    },
    list,
  };
}
export const Gigger = {
  name: "gigger",
  builder: (client: Client, publicClient: Client) => ({
    exports: createGigger(client, publicClient),
  }),
};
export type GiggerStore = ReturnType<typeof createGigger>;
export function groupGigs(
  gigs: Gig[],
  today = new Date().toLocaleDateString("en-CA"),
) {
  return (["confirmed", "offered", "enquiry", "played", "cancelled"] as const)
    .map((status) => ({
      status,
      gigs: gigs
        .filter((gig) => gig.status === status)
        .sort((a, b) => {
          if (status === "confirmed" && a.date >= today !== b.date >= today)
            return a.date >= today ? -1 : 1;
          return a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
        }),
    }))
    .filter((group) => group.gigs.length > 0);
}
