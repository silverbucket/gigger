export interface Band {
  id: string;
  name: string;
}
export interface Member {
  id: string;
  name: string;
  phone?: string;
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
  venue: string;
  address: string;
  contacts: string[];
  date: string;
  loadIn?: string;
  soundcheck?: string;
  setTimes?: string[];
  fee?: string;
  notes?: string;
  status: GigStatus;
}
export interface Venue {
  id: string;
  name: string;
  address: string;
}
export interface Records {
  band: Band;
  member: Member;
  gig: Gig;
  venue: Venue;
}
const text = { type: "string", minLength: 1, pattern: "\\S" };
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
  member: object({ name: text, phone: text, messenger: text }, ["name"], {
    anyOf: [{ required: ["phone"] }, { required: ["messenger"] }],
  }),
  gig: object(
    {
      title: text,
      venue: text,
      address: text,
      contacts: { type: "array", items: text },
      date,
      loadIn: time,
      soundcheck: time,
      setTimes: { type: "array", items: time },
      fee: { type: "string" },
      notes: { type: "string" },
      status: { enum: [...gigStatuses] },
    },
    ["title", "venue", "address", "contacts", "date", "status"],
  ),
  venue: object({ name: text, address: text }, ["name", "address"]),
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
      await client.storeObject(kind, recordPath(kind, bandId, value.id), value);
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
