/** A demo account with a band, members, venues, contacts and gigs for the dev storage. */

import { createAuthHandler } from "../armadietto/auth.cjs";
import { moduleContext } from "../schemas/src/index";
import { jsonBody, type MemoryStore } from "./storage";

export const demoAccount = {
  username: "demo",
  password: "demodemo",
  email: "demo@example.com",
  bandName: "The Demo Band",
  currency: "EUR",
};

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

/** Creates the demo account if missing. Returns whether anything was seeded. */
export async function seedDemo(store: MemoryStore, appOrigin: string) {
  if (await store.readAuth(demoAccount.username)) return false;
  const auth = createAuthHandler(store, appOrigin);
  const result = await auth("signup", { ...demoAccount });
  if (result.status !== 201)
    throw new Error(`Demo signup failed: ${JSON.stringify(result.body)}`);
  const bandId = Object.keys(
    store.listing(demoAccount.username, "/showday/bands/"),
  )[0]?.replace(/\/$/, "");
  if (!bandId) throw new Error("Demo band missing after signup");
  const put = (kind: string, path: string, record: Record<string, unknown>) =>
    store.write(
      demoAccount.username,
      `/showday/bands/${bandId}/${path}`,
      "application/json",
      jsonBody({ "@context": moduleContext(kind), ...record }),
    );
  for (const [id, name, email] of [
    ["m-ana", "Ana", "ana@example.com"],
    ["m-tomas", "Tomáš", "tomas@example.com"],
    ["m-jo", "Jo", "jo@example.com"],
  ])
    put("member", `members/${id}`, { id, name, email });
  put("venue", "venues/v-kasarna", {
    id: "v-kasarna",
    name: "Kasárna Karlín",
    address: "Prvního pluku 2",
    city: "Prague",
    country: "CZ",
  });
  put("venue", "venues/v-cross", {
    id: "v-cross",
    name: "Cross Club",
    address: "Plynární 1096/23",
    city: "Prague",
    country: "CZ",
  });
  put("contact", "contacts/c-petra", {
    id: "c-petra",
    name: "Petra Nováková",
    email: "petra@example.com",
    phone: "+420 777 000 111",
  });
  put("contact", "contacts/c-marek", {
    id: "c-marek",
    name: "Marek Dvořák",
    instagram: "marek.books",
  });
  put("gig", "gigs/g-confirmed", {
    id: "g-confirmed",
    title: "Summer night",
    date: day(12),
    status: "confirmed",
    venueId: "v-kasarna",
    contactIds: ["c-petra"],
    loadIn: "17:00",
    soundcheck: "18:00",
    setTimes: ["20:30"],
    setLength: 75,
    fee: { amount: "600", currency: "EUR", extras: ["dinner"] },
    availability: { "m-ana": "yes", "m-tomas": "yes", "m-jo": "maybe" },
    public: { description: "Open air, doors at 19:00." },
  });
  put("gig", "gigs/g-offered", {
    id: "g-offered",
    title: "Club night",
    date: day(30),
    status: "offered",
    venueId: "v-cross",
    contactIds: ["c-marek"],
    enquirySource: "instagram",
    contactDate: day(-2),
    enquiryText:
      "Hey, would you play on a Friday next month? We can do 400 plus the door.",
    fee: { amount: "400", currency: "EUR", extras: ["door split"] },
  });
  put("gig", "gigs/g-enquiry", {
    id: "g-enquiry",
    title: "Private party",
    date: day(45),
    status: "enquiry",
    venueId: "v-kasarna",
    contactIds: ["c-petra"],
    enquirySource: "email",
    contactDate: day(0),
    enquiryText:
      "Hi, we are looking for a band for a birthday on the 20th. Budget around 500 €.",
  });
  put("gig", "gigs/g-played", {
    id: "g-played",
    title: "Spring opener",
    date: day(-40),
    status: "played",
    venueId: "v-cross",
    contactIds: ["c-marek"],
    setTimes: ["21:00"],
    fee: { amount: "350", currency: "EUR", extras: [] },
  });
  return true;
}
