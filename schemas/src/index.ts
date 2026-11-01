export interface Band {
  id: string;
  name: string;
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
  fee?: string | { amount?: string; extras: string[] };
  notes?: string;
  status: GigStatus;
}
export interface Venue {
  id: string;
  name: string;
  address: string;
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
  contact: Contact;
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
export const schemas = {
  band: object({ name: text }, ["name"]),
  member: object({ name: text, phone: text, email, messenger: text }, ["name"]),
  gig: object(
    {
      title: text,
      venueId: id,
      contactIds: { type: "array", items: id, uniqueItems: true },
      contactDate: date,
      enquiryText: { type: "string" },
      enquirySource: { enum: [...enquirySources] },
      setLength: { type: "integer", minimum: 1 },
      public: {
        type: "object",
        properties: {
          ticketUrl: { type: "string", pattern: "^https?://[^\\s/]+[^\\s]*$" },
          description: { type: "string" },
        },
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
              amount: text,
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
  venue: object({ name: text, address: text }, ["name", "address"]),
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
  getObject(path: string): Promise<unknown>;
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
export function createGigger(client: Client) {
  for (const [kind, schema] of Object.entries(schemas))
    client.declareType(kind, schema);
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
  return {
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
        ]) {
          const related = await client.getObject(
            recordPath(relatedKind, bandId, relatedId),
          );
          read(relatedKind, related);
        }
      }
      await client.storeObject(kind, recordPath(kind, bandId, value.id), value);
    },
    async moveGigStatus(bandId: string, gigId: string, status: GigStatus) {
      const path = recordPath("gig", bandId, gigId);
      const current = read("gig", await client.getObject(path));
      if (!canMoveStatus(current.status, status))
        throw new Error(
          "This gig changed somewhere else, reload to see the latest",
        );
      const updated = { ...current, status };
      await client.storeObject("gig", path, updated);
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
    async list<K extends Exclude<Kind, "band">>(
      kind: K,
      bandId: string,
    ): Promise<Records[K][]> {
      const values = await client.getAll(`bands/${safeId(bandId)}/${kind}s/`);
      return Object.values(values ?? {}).map((value) => read(kind, value));
    },
  };
}
export const Gigger = {
  name: "gigger",
  builder: (client: Client) => ({ exports: createGigger(client) }),
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
