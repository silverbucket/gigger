export type {
  PublicPageTheme,
  PublicSocialLink,
  SocialPlatform,
  ThemePreset,
} from "./public-profile";
export {
  defaultNewPageTheme,
  legacyLivePageTheme,
  migrateLegacyInstagram,
  normalizePublicWebsite,
  normalizeSocialUrl,
  PAGE_THEME_PRESETS,
  socialPlatforms,
  themePresets,
} from "./public-profile";

import type { PublicPageTheme, PublicSocialLink } from "./public-profile";
import { normalizePublicWebsite, normalizeSocialUrl } from "./public-profile";

export interface PublicPageContact {
  email?: string;
  phone?: string;
  website?: string;
}
/** Public-facing band profile edited with the public page; stored on the band record. */
export interface BandPublicProfile {
  bio?: string;
  city?: string;
  /** Empty string removes the banner; undefined leaves the live banner unchanged on publish. */
  bannerDataUrl?: string;
  theme?: PublicPageTheme;
  contact?: PublicPageContact;
  socials?: PublicSocialLink[];
}
export interface Band {
  id: string;
  name: string;
  currency?: string;
  /** Public page address; set once the band publishes. */
  slug?: string;
  /** BCP 47 locale for public dates and times, e.g. "cs-CZ". */
  locale?: string;
  publicProfile?: BandPublicProfile;
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
  /** Who in the band can play, by member ID; a member without an entry was not asked. */
  availability?: Record<string, Availability>;
  /** When the gig sheet last went out, and to which members. */
  sheetSentAt?: string;
  sheetSentTo?: string[];
}
/** yes = available, no = can't make it, maybe = asked, no reply yet. */
export const availabilityValues = ["yes", "no", "maybe"] as const;
export type Availability = (typeof availabilityValues)[number];
/** A conversation the band marked as not a booking; it returns to sort when a newer message arrives. */
export interface Triage {
  id: string;
  status: "archived";
  at: string;
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
  city?: string;
  bio?: string;
  /** Storage object name under `/public/showday/<slug>/`; served as `/b/<slug>/banner`. */
  banner?: string;
  bannerType?: string;
  theme?: PublicPageTheme;
  contact?: PublicPageContact;
  socials?: PublicSocialLink[];
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
  /** People in the room on the night. */
  attendance?: number;
}
export type SurveyInput = Pick<
  VenueSurvey,
  | "rating"
  | "capacity"
  | "setting"
  | "pa"
  | "stageNotes"
  | "playAgain"
  | "attendance"
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
/** remoteStorage category folder (OAuth scope root) for Showday app data. */
export const STORAGE_MODULE_SLUG = "showday";
export function moduleContext(kind: string) {
  return `http://remotestorage.io/spec/modules/${STORAGE_MODULE_SLUG}/${kind}`;
}

export interface Attachment {
  type: string;
  /** Storage path under `/${STORAGE_MODULE_SLUG}/` once copied, or the original URL. */
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
  /** Meta message tag; HUMAN_AGENT lets a person reply up to 7 days after the contact's last message. */
  tag?: "HUMAN_AGENT";
  /** Email headers kept so replies thread in the contact's mail client. */
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
}
export interface Conversation {
  bandId: string;
  channel: Channel;
  /** The other party; contacts match on their messenger, instagram or email field. */
  peer: Party;
  /** Our side: the Page, Instagram account ID or email address the conversation runs through. */
  account?: string;
  lastIn?: string;
  lastOut?: string;
  preview: string;
  /** Email threading state from the contact's latest message: the next reply answers it. */
  subject?: string;
  messageId?: string;
  references?: string[];
}
export type ConversationIndex = Record<string, Conversation>;
export const conversationsPath = "conversations/index";
/** Scoped to the band so a Page moved between bands never merges their threads; Meta IDs are path-safe, email addresses are base64url-encoded. */
export function conversationId(
  channel: Channel,
  bandId: string,
  peerId: string,
) {
  const safe = /^[A-Za-z0-9_-]+$/.test(peerId)
    ? peerId
    : btoa(peerId).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${channel}-${safeId(bandId)}-${safe}`;
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
const day = 24 * 60 * 60 * 1000;
/** Meta only allows replies within 24 hours of the contact's last message, or 7 days with the HUMAN_AGENT tag; returns the reason when blocked. */
export function replyBlocked(
  conversation: Conversation,
  now = Date.now(),
  humanAgent = false,
) {
  if (conversation.channel === "email") return "";
  const since = now - Date.parse(conversation.lastIn ?? "");
  if (since >= 0 && since < (humanAgent ? 7 : 1) * day) return "";
  const name = conversation.channel === "messenger" ? "Messenger" : "Instagram";
  return `${name} only allows replies within ${humanAgent ? "7 days" : "24 hours"} of the contact's last message. Wait for them to write again.`;
}
/** More than 24 hours after the contact's last message a Meta reply must carry the HUMAN_AGENT tag. */
export function needsHumanAgentTag(
  conversation: Conversation,
  now = Date.now(),
) {
  return (
    conversation.channel !== "email" &&
    now - Date.parse(conversation.lastIn ?? "") >= day
  );
}
export function withMessage(
  index: ConversationIndex,
  message: Message,
): ConversationIndex {
  const previous = index[message.conversation];
  const key = message.direction === "in" ? "lastIn" : "lastOut";
  if (previous && (previous[key] ?? "") >= message.published) return index;
  const newest =
    message.published >= (previous?.lastIn ?? "") &&
    message.published >= (previous?.lastOut ?? "");
  return {
    ...index,
    [message.conversation]: {
      bandId: message.bandId,
      channel: message.channel,
      peer: { ...previous?.peer, ...messagePeer(message) },
      account: (message.direction === "in" ? message.target : message.actor).id,
      ...(previous?.lastIn ? { lastIn: previous.lastIn } : {}),
      ...(previous?.lastOut ? { lastOut: previous.lastOut } : {}),
      [key]: message.published,
      preview: newest
        ? message.object.content.slice(0, 120)
        : (previous?.preview ?? ""),
      ...emailThread(previous, message),
    },
  };
}
/** An incoming email with a Message-ID becomes what the next reply answers; anything else keeps the previous thread state. */
function emailThread(
  previous: Conversation | undefined,
  message: Message,
): Pick<Conversation, "subject" | "messageId" | "references"> {
  if (
    message.channel === "email" &&
    message.direction === "in" &&
    message.messageId &&
    (!previous?.lastIn || message.published >= previous.lastIn)
  )
    return {
      ...(message.subject !== undefined ? { subject: message.subject } : {}),
      messageId: message.messageId,
      references: [
        ...(message.references ?? []),
        ...(message.inReplyTo &&
        !message.references?.includes(message.inReplyTo)
          ? [message.inReplyTo]
          : []),
      ].slice(-49),
    };
  return {
    ...(previous?.subject !== undefined ? { subject: previous.subject } : {}),
    ...(previous?.messageId ? { messageId: previous.messageId } : {}),
    ...(previous?.references ? { references: previous.references } : {}),
  };
}
/** The subject and headers for a reply that threads under the contact's latest email. */
export function emailReplyHeaders(
  conversation: Conversation,
  fallback: string,
) {
  const subject = conversation.subject?.trim()
    ? /^re:/i.test(conversation.subject.trim())
      ? conversation.subject.trim()
      : `Re: ${conversation.subject.trim()}`
    : fallback;
  if (!conversation.messageId) return { subject };
  return {
    subject,
    inReplyTo: conversation.messageId,
    references: [
      ...(conversation.references ?? []).filter(
        (id) => id !== conversation.messageId,
      ),
      conversation.messageId,
    ].slice(-50),
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
  triage: Triage;
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
const hexColor = { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" };
const themePresetEnum = {
  enum: ["night", "paper", "gold", "red", "custom"],
};
const publicThemeSchema = {
  type: "object",
  properties: {
    preset: themePresetEnum,
    background: hexColor,
    text: hexColor,
    accent: hexColor,
  },
  required: ["background", "text", "accent"],
  additionalProperties: false,
};
const publicSocialSchema = {
  type: "object",
  properties: {
    platform: {
      enum: [
        "instagram",
        "facebook",
        "youtube",
        "spotify",
        "bandcamp",
        "tiktok",
        "soundcloud",
        "x",
      ],
    },
    url: ticketUrl,
  },
  required: ["platform", "url"],
  additionalProperties: false,
};
const publicProfileSchema = {
  type: "object",
  properties: {
    bio: { type: "string", maxLength: 5000 },
    city: { type: "string", maxLength: 200 },
    bannerDataUrl: { type: "string", maxLength: 7_500_000 },
    theme: publicThemeSchema,
    contact: {
      type: "object",
      properties: {
        email,
        phone: { type: "string", maxLength: 200 },
        website: { type: "string", maxLength: 500 },
      },
      additionalProperties: false,
    },
    socials: {
      type: "array",
      items: publicSocialSchema,
      maxItems: 8,
    },
  },
  additionalProperties: false,
};
const publicPageExtras = {
  city: { type: "string", maxLength: 200 },
  bio: { type: "string", maxLength: 5000 },
  banner: { const: "banner" },
  bannerType: { type: "string", pattern: "^image/" },
  theme: publicThemeSchema,
  contact: publicProfileSchema.properties.contact,
  socials: {
    type: "array",
    items: publicSocialSchema,
    maxItems: 8,
  },
  instagram: { type: "string" },
};
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
      ...publicPageExtras,
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
  attendance: { type: "integer", minimum: 0 },
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
/** An RFC 5322 Message-ID: one header line, which is all Sockethub's email platform accepts. */
const mailId = {
  type: "string",
  minLength: 1,
  maxLength: 998,
  pattern: "^[^\\r\\n]+$",
};
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
    tag: { enum: ["HUMAN_AGENT"] },
    subject: { type: "string" },
    messageId: mailId,
    inReplyTo: mailId,
    references: { type: "array", items: mailId, maxItems: 50 },
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
      account: text,
      lastIn: dateTime,
      lastOut: dateTime,
      preview: { type: "string" },
      subject: { type: "string" },
      messageId: mailId,
      references: { type: "array", items: mailId, maxItems: 50 },
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
      publicProfile: publicProfileSchema,
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
      availability: {
        type: "object",
        patternProperties: {
          "^[A-Za-z0-9_-]+$": { enum: [...availabilityValues] },
        },
        additionalProperties: false,
      },
      sheetSentAt: dateTime,
      sheetSentTo: { type: "array", items: id, uniqueItems: true },
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
  triage: object({ status: { enum: ["archived"] }, at: dateTime }, [
    "status",
    "at",
  ]),
};
export type Kind = keyof Records;
export interface Client {
  declareType(name: string, schema: object): unknown;
  storeObject(name: string, path: string, value: object): Promise<unknown>;
  storeFile?(
    contentType: string,
    path: string,
    body: string | ArrayBuffer | ArrayBufferView,
  ): Promise<unknown>;
  getObject(path: string, maxAge?: false | number): Promise<unknown>;
  getAll(path: string): Promise<unknown>;
  getListing(path: string, maxAge?: false | number): Promise<unknown>;
  validate(value: object): { valid?: boolean };
  remove(path: string): Promise<unknown>;
}
const bannerDataRe =
  /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i;
const maxBannerBytes = 5_000_000;
/** Writes an uploaded banner into the band's public folder; returns public page fields. */
export async function publishPublicBanner(
  publicClient: Client,
  slug: string,
  dataUrl: string,
) {
  if (!publicClient.storeFile) return undefined;
  const match = bannerDataRe.exec(dataUrl.trim());
  if (!match) return undefined;
  const body = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  if (body.byteLength > maxBannerBytes) return undefined;
  await publicClient.storeFile(match[1], `${slug}/banner`, body);
  return { banner: "banner" as const, bannerType: match[1] };
}
function publicPageFields(
  current: Band,
  banner?: Pick<PublicPage, "banner" | "bannerType">,
): PublicPage {
  const profile = current.publicProfile;
  const page: PublicPage = {
    name: current.name,
    gigs: {},
    ...(current.locale ? { locale: current.locale } : {}),
  };
  const city = profile?.city?.trim();
  if (city) page.city = city.slice(0, 200);
  const bio = profile?.bio?.trim();
  if (bio) page.bio = bio.slice(0, 5000);
  if (profile?.theme?.background && profile.theme.text && profile.theme.accent)
    page.theme = profile.theme;
  const contact = profile?.contact;
  if (contact) {
    const next = {
      ...(contact.email?.trim()
        ? { email: contact.email.trim().toLowerCase() }
        : {}),
      ...(contact.phone?.trim() ? { phone: contact.phone.trim() } : {}),
      ...(normalizePublicWebsite(contact.website ?? "")
        ? { website: normalizePublicWebsite(contact.website ?? "") }
        : {}),
    };
    if (Object.keys(next).length) page.contact = next;
  }
  const socials = (profile?.socials ?? [])
    .map((link) => {
      const url = normalizeSocialUrl(link.platform, link.url);
      return url ? { platform: link.platform, url } : null;
    })
    .filter((link): link is PublicSocialLink => link !== null);
  if (socials.length) page.socials = socials;
  if (banner?.banner) {
    page.banner = banner.banner;
    if (banner.bannerType) page.bannerType = banner.bannerType;
  }
  return page;
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
export function createShowday(client: Client, publicClient?: Client) {
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
        "@context": moduleContext(kind),
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
    const slug = current.slug;
    const existing = (await publicClient.getObject(`${slug}/page`)) as
      | PublicPage
      | undefined;
    const profile = current.publicProfile;
    let banner: Pick<PublicPage, "banner" | "bannerType"> | undefined;
    if (profile?.bannerDataUrl === "") {
      await publicClient.remove(`${slug}/banner`).catch(() => {});
    } else if (profile?.bannerDataUrl) {
      banner = await publishPublicBanner(
        publicClient,
        slug,
        profile.bannerDataUrl,
      );
    } else if (existing?.banner) {
      banner = { banner: existing.banner, bannerType: existing.bannerType };
    }
    await publicClient.storeObject(
      "publicPage",
      `${slug}/page`,
      publicPageFields(current, banner),
    );
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
    await publicClient.remove(`${slug}/banner`).catch(() => {});
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
    if (
      !client.validate({
        ...(value as object),
        "@context": moduleContext(kind),
      }).valid
    )
      throw new Error(`Invalid ${kind} record in storage`);
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
        ...(survey.attendance !== undefined
          ? { attendance: survey.attendance }
          : {}),
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
    /** Sets or clears one member's availability on the latest stored gig. */
    async setAvailability(
      bandId: string,
      gigId: string,
      memberId: string,
      value: Availability | null,
    ) {
      safeId(memberId);
      const path = recordPath("gig", bandId, gigId);
      const current = read("gig", await client.getObject(path));
      const availability = { ...current.availability };
      if (value) availability[memberId] = value;
      else delete availability[memberId];
      const updated: Gig = { ...current, availability };
      if (!Object.keys(availability).length) delete updated.availability;
      await client.storeObject("gig", path, updated);
      return updated;
    },
    /** Records that the gig sheet went out to these members. */
    async markSheetSent(
      bandId: string,
      gigId: string,
      memberIds: string[],
      at = new Date().toISOString(),
    ) {
      const path = recordPath("gig", bandId, gigId);
      const current = read("gig", await client.getObject(path));
      const updated: Gig = {
        ...current,
        sheetSentAt: at,
        sheetSentTo: [...new Set(memberIds.map(safeId))],
      };
      await client.storeObject("gig", path, updated);
      return updated;
    },
    /** Marks a conversation as not a booking. */
    async archiveConversation(
      bandId: string,
      conversationId: string,
      at = new Date().toISOString(),
    ) {
      await client.storeObject(
        "triage",
        recordPath("triage", bandId, conversationId),
        { id: conversationId, status: "archived", at },
      );
    },
    async unarchiveConversation(bandId: string, conversationId: string) {
      await client.remove(recordPath("triage", bandId, conversationId));
    },
    /** Removes a contact no gig or other band links to. */
    async removeContact(bandId: string, contactId: string) {
      const [gigs, others] = await Promise.all([
        list("gig", bandId),
        list("otherBand", bandId),
      ]);
      if (
        gigs.some((gig) => gig.contactIds?.includes(contactId)) ||
        others.some((band) => band.contactIds.includes(contactId))
      )
        throw new Error(
          "This contact is linked to gigs or bands. Remove those links first.",
        );
      await client.remove(recordPath("contact", bandId, contactId));
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
export const Showday = {
  name: STORAGE_MODULE_SLUG,
  builder: (client: Client, publicClient: Client) => ({
    exports: createShowday(client, publicClient),
  }),
};
export type ShowdayStore = ReturnType<typeof createShowday>;
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
