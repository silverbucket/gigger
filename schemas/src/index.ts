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
  /** Whether a public copy may have been written; absent on legacy gigs. */
  published?: boolean;
  /** Inbox conversation this gig was created from. */
  conversationId?: string;
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
export const channels = ["email", "messenger", "instagram"] as const;
export type Channel = (typeof channels)[number];
export interface Attachment {
  type: string;
  /** Storage path under /gigger/ once copied, or the original URL. */
  url: string;
  mediaType?: string;
  name?: string;
}
export interface Party {
  id: string;
  name?: string;
}
/** ActivityStreams-shaped message: actor sent object to target over a channel. */
export interface Message {
  id: string;
  channel: Channel;
  direction: "in" | "out";
  conversation: string;
  bandId: string;
  actor: Party;
  target: Party;
  object: { type: "Note"; content: string; attachment?: Attachment[] };
  published: string;
  received?: string;
  /** Set when a reply could not be delivered. */
  error?: string;
}
export interface Conversation {
  bandId: string;
  channel: Channel;
  /** The other party; contacts match on their messenger, instagram or email field. */
  peer: Party;
  lastIn?: string;
  lastOut?: string;
  preview: string;
}
export type ConversationIndex = Record<string, Conversation>;
export const conversationsPath = "conversations/index";
/** Meta IDs are already path-safe; other peers (email addresses) are base64url-encoded. */
export function conversationId(channel: Channel, peerId: string) {
  const safe = /^[A-Za-z0-9_-]+$/.test(peerId)
    ? peerId
    : btoa(peerId).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${channel}-${safe}`;
}
export function messagePath(
  message: Pick<Message, "conversation" | "published" | "id">,
) {
  return `conversations/${safeId(message.conversation)}/${message.published.slice(0, 7)}/${safeId(message.id)}`;
}
/** Copied attachments live in a sibling folder so message listings hold only JSON documents. */
export function attachmentPath(
  message: Pick<Message, "conversation" | "published" | "id">,
  n: number,
) {
  const path = messagePath(message);
  return `${path.slice(0, path.lastIndexOf("/"))}/files/${safeId(message.id)}-${n}`;
}
export function messagePeer(message: Message) {
  return message.direction === "in" ? message.actor : message.target;
}
/** Meta only allows replies within 24 hours of the contact's last message; returns the reason when blocked. */
export function replyBlocked(conversation: Conversation, now = Date.now()) {
  if (conversation.channel === "email") return "";
  const since = now - Date.parse(conversation.lastIn ?? "");
  if (since >= 0 && since < 24 * 60 * 60 * 1000) return "";
  const name = conversation.channel === "messenger" ? "Messenger" : "Instagram";
  return `${name} only allows replies within 24 hours of the contact's last message. Wait for them to write again.`;
}
export function withMessage(
  index: ConversationIndex,
  message: Message,
): ConversationIndex {
  const previous = index[message.conversation];
  const key = message.direction === "in" ? "lastIn" : "lastOut";
  if (previous && (previous[key] ?? "") > message.published) return index;
  return {
    ...index,
    [message.conversation]: {
      bandId: message.bandId,
      channel: message.channel,
      peer: { ...previous?.peer, ...messagePeer(message) },
      ...(previous?.lastIn ? { lastIn: previous.lastIn } : {}),
      ...(previous?.lastOut ? { lastOut: previous.lastOut } : {}),
      [key]: message.published,
      preview: message.object.content.slice(0, 120),
    },
  };
}
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
const party = {
  type: "object",
  properties: { id: text, name: { type: "string" } },
  required: ["id"],
  additionalProperties: false,
};
const dateTime = { type: "string", format: "date-time" };
export const messageSchema = object(
  {
    channel: { enum: [...channels] },
    direction: { enum: ["in", "out"] },
    conversation: id,
    bandId: id,
    actor: party,
    target: party,
    object: {
      type: "object",
      properties: {
        type: { const: "Note" },
        content: { type: "string" },
        attachment: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: text,
              url: text,
              mediaType: { type: "string" },
              name: { type: "string" },
            },
            required: ["type", "url"],
            additionalProperties: false,
          },
        },
      },
      required: ["type", "content"],
      additionalProperties: false,
    },
    published: dateTime,
    received: dateTime,
    error: { type: "string" },
  },
  [
    "channel",
    "direction",
    "conversation",
    "bandId",
    "actor",
    "target",
    "object",
    "published",
  ],
);
export const conversationsSchema = {
  type: "object",
  properties: { "@context": { type: "string" } },
  additionalProperties: {
    type: "object",
    properties: {
      bandId: id,
      channel: { enum: [...channels] },
      peer: party,
      lastIn: dateTime,
      lastOut: dateTime,
      preview: { type: "string" },
    },
    required: ["bandId", "channel", "peer", "preview"],
    additionalProperties: false,
  },
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
      published: { type: "boolean" },
      conversationId: id,
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
  getListing(path: string, maxAge?: false | number): Promise<unknown>;
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
  client.declareType("pendingPublicDelete", {
    type: "object",
    properties: {
      "@context": { type: "string" },
      slug: { type: "string", pattern: slugPattern },
      bandId: id,
      gigId: id,
    },
    required: ["slug", "bandId", "gigId"],
    additionalProperties: false,
  });
  client.declareType("pendingPublicSlug", {
    type: "object",
    properties: {
      "@context": { type: "string" },
      slug: { type: "string", pattern: slugPattern },
      bandId: id,
    },
    required: ["slug", "bandId"],
    additionalProperties: false,
  });
  client.declareType("message", messageSchema);
  client.declareType("conversations", conversationsSchema);
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
  /** Writes or removes the public copy of one gig. */
  async function publishGig(slug: string, bandId: string, gig: Gig) {
    if (!publicClient) return;
    const path = `${slug}/gigs/${safeId(gig.id)}`;
    if (!publicStatuses.includes(gig.status)) {
      if (gig.published === false) return;
      const pendingPath = `pending-public-deletes/${safeId(bandId)}/${safeId(gig.id)}`;
      let existing = await publicClient.getObject(path);
      if (!existing) {
        try {
          existing = await publicClient.getObject(path, 0);
        } catch {
          await client.storeObject("pendingPublicDelete", pendingPath, {
            slug,
            bandId,
            gigId: gig.id,
          });
          return;
        }
      }
      if (existing) {
        await client.storeObject("pendingPublicDelete", pendingPath, {
          slug,
          bandId,
          gigId: gig.id,
        });
        await publicClient.remove(path);
      }
      return;
    }
    const venue = gig.venueId
      ? read(
          "venue",
          await client.getObject(recordPath("venue", bandId, gig.venueId)),
        )
      : undefined;
    if (gig.published !== true) {
      gig = { ...gig, published: true };
      await client.storeObject("gig", recordPath("gig", bandId, gig.id), gig);
    }
    await publicClient.storeObject("publicGig", path, publicGig(gig, venue));
    const pendingPath = `pending-public-deletes/${safeId(bandId)}/${safeId(gig.id)}`;
    if (await client.getObject(pendingPath)) await client.remove(pendingPath);
  }
  /** Store band metadata separately from the individual public gig records. */
  async function publishPage(current: Band) {
    if (!publicClient || !current.slug) return;
    await publicClient.storeObject("publicPage", `${current.slug}/page`, {
      name: current.name,
      ...(current.locale ? { locale: current.locale } : {}),
      gigs: {},
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
    if (!publicClient) return false;
    let fresh = true;
    let listing: unknown;
    try {
      listing = await publicClient.getListing(`${slug}/gigs/`, 0);
    } catch {
      fresh = false;
      listing = await publicClient.getListing(`${slug}/gigs/`);
    }
    const ids = Object.keys(listing ?? {}).filter((id) =>
      /^[A-Za-z0-9_-]+$/.test(id),
    );
    for (const id of ids) {
      const path = `${slug}/gigs/${id}`;
      const copy =
        (await publicClient.getObject(path)) ??
        (fresh ? await publicClient.getObject(path, 0) : undefined);
      if (copy) await publicClient.remove(path);
    }
    const pagePath = `${slug}/page`;
    const page =
      (await publicClient.getObject(pagePath)) ??
      (fresh ? await publicClient.getObject(pagePath, 0) : undefined);
    if (page) await publicClient.remove(pagePath);
    return fresh && ids.length === 0 && !page;
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
  async function pendingPaths(root: string) {
    const folders = (await client.getListing(`${root}/`)) ?? {};
    const paths: string[] = [];
    for (const folder of Object.keys(folders)) {
      if (!/^[A-Za-z0-9_-]+\/$/.test(folder)) continue;
      const items = (await client.getListing(`${root}/${folder}`)) ?? {};
      for (const gigId of Object.keys(items))
        if (/^[A-Za-z0-9_-]+$/.test(gigId))
          paths.push(`${root}/${folder}${gigId}`);
    }
    return paths;
  }
  function valid<T>(kind: string, value: unknown): T {
    const checked = client.validate({
      ...(value as object),
      "@context": `http://remotestorage.io/spec/modules/gigger/${kind}`,
    });
    if (!checked.valid) throw new Error(`Invalid ${kind} record in storage`);
    return value as T;
  }
  return {
    /** The server writes messages; the app only reads them. */
    async conversations(): Promise<ConversationIndex> {
      const stored = await client.getObject(conversationsPath);
      if (!stored) return {};
      const { "@context": _, ...index } = stored as Record<string, unknown>;
      return valid<ConversationIndex>("conversations", index);
    },
    async messages(conversation: string): Promise<Message[]> {
      const root = `conversations/${safeId(conversation)}/`;
      const months = Object.keys((await client.getListing(root)) ?? {}).filter(
        (key) => /^\d{4}-\d{2}\/$/.test(key),
      );
      const messages: Message[] = [];
      for (const month of months) {
        const items = (await client.getListing(root + month)) ?? {};
        for (const name of Object.keys(items)) {
          if (!/^[A-Za-z0-9_-]+$/.test(name)) continue;
          const path = root + month + name;
          const value =
            (await client.getObject(path)) ?? (await client.getObject(path, 0));
          messages.push(valid<Message>("message", value));
        }
      }
      return messages.sort((a, b) => a.published.localeCompare(b.published));
    },
    async pendingDeletes() {
      return [
        ...(await pendingPaths("pending-public-deletes")),
        ...(await pendingPaths("pending-public-slugs")),
      ];
    },
    async queueOldSlugCleanup(bandId: string, slug: string) {
      if (!new RegExp(slugPattern).test(slug)) throw new Error("Invalid slug");
      await client.storeObject(
        "pendingPublicSlug",
        `pending-public-slugs/${safeId(bandId)}/${slug}`,
        { bandId, slug },
      );
    },
    async retryPublicDeletes() {
      if (!publicClient) return;
      for (const path of await pendingPaths("pending-public-slugs")) {
        const pending = (await client.getObject(path)) as
          | { bandId: string; slug: string }
          | undefined;
        if (!pending || !new RegExp(slugPattern).test(pending.slug)) continue;
        const band = await client.getObject(
          recordPath("band", pending.bandId),
          0,
        );
        if (!band || read("band", band).slug === pending.slug) continue;
        if (await removePublic(pending.slug)) await client.remove(path);
      }
      for (const path of await pendingPaths("pending-public-deletes")) {
        const pending = (await client.getObject(path)) as
          | { slug: string; bandId: string; gigId: string }
          | undefined;
        if (!pending || !new RegExp(slugPattern).test(pending.slug)) continue;
        const gig = await client.getObject(
          recordPath("gig", pending.bandId, pending.gigId),
          0,
        );
        if (gig && publicStatuses.includes(read("gig", gig).status)) {
          await client.remove(path);
          continue;
        }
        const publicPath = `${pending.slug}/gigs/${safeId(pending.gigId)}`;
        const remote = await publicClient.getObject(publicPath, 0);
        if (remote) await publicClient.remove(publicPath);
        else await client.remove(path);
      }
    },
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
          value = { ...gig, published: old.published ?? true } as Records[K];
          if (
            old.status !== gig.status &&
            !canMoveStatus(old.status, gig.status)
          )
            throw new Error(
              "This gig changed somewhere else, reload to see the latest",
            );
        } else value = { ...gig, published: false } as Records[K];
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
