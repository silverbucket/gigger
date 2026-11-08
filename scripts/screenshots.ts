/**
 * Seeds a realistic account and captures the main screens on desktop and phone.
 * Run against a Compose stack: `bun scripts/screenshots.ts [outDir]`.
 * Uses SCREENSHOT_URL (default http://localhost:8080).
 */

import { chromium, devices, webkit } from "@playwright/test";
import { conversationId, messagePath } from "../schemas/src/index.ts";

const base = process.env.SCREENSHOT_URL ?? "http://localhost:8080";
const out = process.argv[2] ?? "screenshots";
const username = `demo-${crypto.randomUUID().slice(0, 8)}`;
const password = crypto.randomUUID();

async function json(response: Response) {
  if (!response.ok)
    throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}
const signup = await json(
  await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      email: `${username}@example.com`,
      bandName: "The Night Shifts",
      currency: "EUR",
    }),
  }),
);
const headers = {
  Authorization: `Bearer ${signup.token}`,
  "Content-Type": "application/json",
};
const root = `${base}/storage/storage/${username}/showday/`;
const listing = await json(await fetch(`${root}bands/`, { headers }));
const bandId = Object.keys(listing.items)[0].replace(/\/$/, "");
const band = `${root}bands/${bandId}/`;

async function put(kind: string, location: string, value: object) {
  const response = await fetch(`${band}${location}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      "@context": `http://remotestorage.io/spec/modules/showday/${kind}`,
      ...value,
    }),
  });
  if (!response.ok)
    throw new Error(`${location}: ${response.status} ${await response.text()}`);
}
const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString("en-CA");
};
const ago = (hours: number) =>
  new Date(Date.now() - hours * 3600_000).toISOString();

const members = [
  { id: "m-ana", name: "Ana Novak", phone: "+420 777 100 200" },
  { id: "m-tom", name: "Tomás Reyes", email: "tomas@example.com" },
  { id: "m-lea", name: "Lea Fischer" },
  { id: "m-sam", name: "Sam Okafor", messenger: "sam.okafor" },
];
for (const member of members)
  await put("member", `members/${member.id}`, member);

const venues = [
  {
    id: "v-lucerna",
    name: "Lucerna Music Bar",
    address: "Vodičkova 36",
    city: "Prague",
  },
  { id: "v-kabinet", name: "Kabinet Múz", address: "Sukova 4", city: "Brno" },
  {
    id: "v-cafe",
    name: "Café v Lese",
    address: "Krymská 12",
    city: "Prague",
  },
  {
    id: "v-fluc",
    name: "Fluc",
    address: "Praterstern 5",
    city: "Vienna",
  },
];
for (const venue of venues) await put("venue", `venues/${venue.id}`, venue);

const contacts = [
  {
    id: "c-petra",
    name: "Petra Svobodová",
    email: "petra@lucerna.example",
    phone: "+420 602 111 222",
    notes: "Books the Thursday slots. Prefers email.",
  },
  {
    id: "c-marek",
    name: "Marek Dvořák",
    instagram: "marek.books",
    notes: "Pays on the night, cash.",
  },
  { id: "c-julia", name: "Julia Weber", email: "julia@fluc.example" },
  { id: "c-ondra", name: "Ondřej Král", messenger: "ondra.kral" },
  { id: "c-eva", name: "Eva Horáková", phone: "+420 731 555 010" },
];
for (const contact of contacts)
  await put("contact", `contacts/${contact.id}`, contact);

await put("otherBand", "otherBands/b-paper", {
  id: "b-paper",
  name: "Paper Lanterns",
  contactIds: ["c-ondra"],
  notes: "Shared a bill twice, good crowd overlap.",
});
await put("otherBand", "otherBands/b-velvet", {
  id: "b-velvet",
  name: "Velvet Static",
  contactIds: ["c-eva"],
});

// A long-running booking conversation, linked to an offered gig.
const petraConv = conversationId("email", bandId, "petra@lucerna.example");
const marekConv = conversationId("instagram", bandId, "marek.books");
const avail = (yes: string[], no: string[] = [], maybe: string[] = []) =>
  Object.fromEntries([
    ...yes.map((id) => [id, "yes"]),
    ...no.map((id) => [id, "no"]),
    ...maybe.map((id) => [id, "maybe"]),
  ]);
const gigs = [
  {
    id: "g-lucerna",
    title: "Thursday headline",
    date: day(12),
    status: "offered",
    venueId: "v-lucerna",
    contactIds: ["c-petra"],
    fee: { amount: 650, currency: "EUR", extras: ["Dinner for 4", "Drinks"] },
    loadIn: "17:30",
    soundcheck: "18:30",
    setTimes: ["21:00"],
    setLength: 75,
    contactDate: day(-6),
    enquirySource: "email",
    enquiryText:
      "Hi! We have a free Thursday next month and would love to have you headline.",
    conversationId: petraConv,
    availability: avail(["m-ana", "m-tom", "m-lea"], [], ["m-sam"]),
    notes: "Ask about the merch table.",
  },
  {
    id: "g-kabinet",
    title: "Album release show",
    date: day(4),
    status: "confirmed",
    venueId: "v-kabinet",
    contactIds: ["c-marek"],
    otherBandIds: ["b-paper"],
    fee: { amount: 800, currency: "EUR", extras: [] },
    loadIn: "16:00",
    soundcheck: "17:00",
    setTimes: ["20:30"],
    setLength: 60,
    conversationId: marekConv,
    enquirySource: "instagram",
    availability: avail(["m-ana", "m-tom", "m-lea", "m-sam"]),
    public: {
      ticketUrl: "https://tickets.example/night-shifts",
      description: "Release night for our second record, with Paper Lanterns.",
    },
  },
  {
    id: "g-fluc",
    title: "Vienna weekender",
    date: day(26),
    status: "confirmed",
    venueId: "v-fluc",
    contactIds: ["c-julia"],
    fee: { amount: 500, currency: "EUR", extras: ["Hotel"] },
    setTimes: ["22:00"],
    availability: avail(["m-ana", "m-tom", "m-sam"], ["m-lea"]),
  },
  {
    id: "g-cafe",
    title: "Acoustic Sunday",
    date: day(40),
    status: "enquiry",
    venueId: "v-cafe",
    contactIds: ["c-eva"],
    fee: { extras: [] },
    contactDate: day(-1),
    enquirySource: "other",
  },
  {
    id: "g-past1",
    title: "Club night",
    date: day(-18),
    status: "played",
    venueId: "v-lucerna",
    contactIds: ["c-petra"],
    fee: { amount: 400, currency: "EUR", extras: [] },
    earnings: {
      dealType: "fixed fee",
      total: 400,
      takeHome: 400,
      currency: "EUR",
    },
  },
  {
    id: "g-past2",
    title: "Festival warm-up",
    date: day(-35),
    status: "played",
    venueId: "v-cafe",
    contactIds: ["c-eva"],
    fee: { amount: 250, currency: "EUR", extras: [] },
  },
  {
    id: "g-cancel",
    title: "Rooftop party",
    date: day(18),
    status: "cancelled",
    venueId: "v-cafe",
    contactIds: ["c-ondra"],
    fee: { extras: [] },
  },
];
for (const gig of gigs) await put("gig", `gigs/${gig.id}`, gig);

await put("survey", "surveys/s-1", {
  id: "s-1",
  venueId: "v-lucerna",
  date: day(-18),
  rating: 4,
  capacity: "100–250",
  setting: "indoor",
  pa: "venue provided",
  playAgain: true,
  attendance: 180,
});

// Conversations live outside the band folder.
type Msg = {
  conv: string;
  channel: "email" | "instagram" | "messenger";
  direction: "in" | "out";
  peer: { id: string; name?: string };
  content: string;
  hours: number;
  subject?: string;
};
const thread: Msg[] = [
  {
    conv: petraConv,
    channel: "email",
    direction: "in",
    peer: { id: "petra@lucerna.example", name: "Petra Svobodová" },
    content:
      "Hi! We have a free Thursday next month and would love to have you headline. Doors at 20:00, one set of about 75 minutes. Would 650 EUR plus dinner work for you?",
    hours: 140,
    subject: "Thursday headline at Lucerna",
  },
  {
    conv: petraConv,
    channel: "email",
    direction: "out",
    peer: { id: "petra@lucerna.example", name: "Petra Svobodová" },
    content:
      "Hi Petra, thanks for thinking of us. That date works for three of us, checking with our drummer now. 650 plus dinner sounds fair.",
    hours: 120,
  },
  {
    conv: petraConv,
    channel: "email",
    direction: "in",
    peer: { id: "petra@lucerna.example", name: "Petra Svobodová" },
    content:
      "Great. Load-in from 17:30, soundcheck at 18:30. Can you confirm by Friday so we can announce it?",
    hours: 20,
    subject: "Re: Thursday headline at Lucerna",
  },
  {
    conv: marekConv,
    channel: "instagram",
    direction: "in",
    peer: { id: "marek.books", name: "Marek Dvořák" },
    content: "Release show is locked. Posters go up Monday 🔥",
    hours: 70,
  },
  {
    conv: conversationId("email", bandId, "booking@saltyard.example"),
    channel: "email",
    direction: "in",
    peer: { id: "booking@saltyard.example", name: "Salt Yard Booking" },
    content:
      "Hello, we're putting together our spring series and would love to have you on 14 March at Salt Yard. 300 EUR guarantee, doors 19:30.",
    hours: 3,
    subject: "Spring series — 14 March?",
  },
  {
    conv: conversationId("instagram", bandId, "kasia.live"),
    channel: "instagram",
    direction: "in",
    peer: { id: "kasia.live", name: "Kasia" },
    content:
      "hey! saw you at Fluc last year. any chance you'd play our house show in Kraków?",
    hours: 9,
  },
  {
    conv: conversationId("messenger", bandId, "1234567890"),
    channel: "messenger",
    direction: "in",
    peer: { id: "1234567890", name: "Ondřej Král" },
    content: "Are you guys free on the 2nd? We need a support act.",
    hours: 30,
  },
];
const index: Record<string, object> = {};
for (const [n, m] of thread.entries()) {
  const published = ago(m.hours);
  const message = {
    "@context": "http://remotestorage.io/spec/modules/showday/message",
    id: `msg-${n}`,
    channel: m.channel,
    direction: m.direction,
    conversation: m.conv,
    bandId,
    actor: m.direction === "in" ? m.peer : { id: `${username}@example.com` },
    target: m.direction === "in" ? { id: `${username}@example.com` } : m.peer,
    object: { type: "Note", content: m.content },
    published,
    ...(m.subject ? { subject: m.subject } : {}),
  };
  const saved = await fetch(`${root}${messagePath(message)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(message),
  });
  if (!saved.ok) throw new Error(`message: ${saved.status}`);
  const prev = (index[m.conv] ?? {}) as Record<string, string>;
  index[m.conv] = {
    ...prev,
    bandId,
    channel: m.channel,
    peer: m.peer,
    preview: m.content.slice(0, 80),
    ...(m.direction === "in" ? { lastIn: published } : { lastOut: published }),
    ...(m.subject ? { subject: m.subject } : {}),
  };
}
const indexed = await fetch(`${root}conversations/index`, {
  method: "PUT",
  headers,
  body: JSON.stringify({
    "@context": "http://remotestorage.io/spec/modules/showday/conversations",
    ...index,
  }),
});
if (!indexed.ok) throw new Error(`index: ${indexed.status}`);

const shots: [string, string][] = [
  ["bookings", "#/bookings"],
  ["gig", "#/bookings/gig/:band/g-lucerna"],
  ["inbox", "#/inbox"],
  ["conversation", `#/inbox/${petraConv}`],
  [
    "to-sort",
    `#/inbox/${conversationId("email", bandId, "booking@saltyard.example")}`,
  ],
  ["gig-form", "#/bookings/gig/:band/g-lucerna/edit"],
  ["contacts", "#/contacts/c-petra"],
  ["venues", "#/venues/v-lucerna"],
  ["band", "#/band"],
];
async function capture(
  name: string,
  launcher: typeof chromium,
  options: Parameters<
    Awaited<ReturnType<typeof chromium.launch>>["newContext"]
  >[0],
) {
  const browser = await launcher.launch();
  const context = await browser.newContext({ ...options, locale: "en-US" });
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForSelector("main", { timeout: 20000 });
  await page.waitForTimeout(2500);
  for (const [shot, hash] of shots) {
    await page.goto(`${base}/${hash.replace(":band", bandId)}`);
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `${out}/${name}-${shot}.png`,
    });
  }
  await browser.close();
}
const only = process.env.SHOTS?.split(",");
const want = (name: string) => !only || only.includes(name);
if (want("desktop"))
  await capture("desktop", chromium, {
    viewport: { width: 1440, height: 900 },
  });
if (want("phone")) await capture("phone", webkit, devices["iPhone 13"]);
if (want("narrow"))
  await capture("narrow", chromium, { viewport: { width: 1024, height: 768 } });
if (want("dark"))
  await capture("dark", chromium, {
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
if (want("phone-dark"))
  await capture("phone-dark", webkit, {
    ...devices["iPhone 13"],
    colorScheme: "dark",
  });
console.log(`Saved to ${out} (account ${username})`);
