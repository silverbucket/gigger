import { expect, test } from "bun:test";
import type { Venue } from "@gigger/schemas";
import { enquiryTitle, extractEnquiry } from "./lib/extract";

const venues: Venue[] = [
  { id: "muz", name: "Kabinet Múz", address: "Sukova 4", city: "Brno" },
  { id: "lese", name: "Café V lese", address: "Krymská 12", city: "Prague" },
];
const now = new Date(2026, 10, 4); // 4 Nov 2026

test("reads date, known venue, sets and times from an enquiry", () => {
  const found = extractEnquiry(
    "Any chance you could play Kabinet Múz on Sat 17 Jan? Two sets, doors at 20:00. Door deal like usual?",
    venues,
    "EUR",
    now,
  );
  expect(found).toEqual({
    date: "2027-01-17",
    venueId: "muz",
    sets: 2,
    doors: "20:00",
  });
  expect(enquiryTitle(found, venues, "Tomáš")).toBe("Kabinet Múz — Sun 17 Jan");
});

test("suggests a new venue and reads a budget with its currency", () => {
  const found = extractEnquiry(
    "Hey, we're doing a 40th birthday at Café Neustadt on 21 Feb, are you free? Budget around €500, one long set.",
    venues,
    "CZK",
    now,
  );
  expect(found.date).toBe("2027-02-21");
  expect(found.newVenue).toBe("Café Neustadt");
  expect(found.fee).toEqual({ amount: 500, currency: "EUR" });
  expect(found.sets).toBe(1);
});

test("understands numeric and Czech dates and koruna amounts", () => {
  expect(
    extractEnquiry("Hrajete 7.3.2027 v Bajkazylu? 5 000 Kč", [], "EUR", now),
  ).toMatchObject({
    date: "2027-03-07",
    fee: { amount: 5000, currency: "CZK" },
  });
  expect(extractEnquiry("Máte čas 14. listopadu?", [], "EUR", now).date).toBe(
    "2026-11-14",
  );
  expect(
    extractEnquiry("How about March 7th, start at 9pm", [], "EUR", now),
  ).toMatchObject({
    date: "2027-03-07",
    start: "21:00",
  });
});

test("finds nothing in a message without booking details", () => {
  expect(
    extractEnquiry("Loved the show last night!", venues, "EUR", now),
  ).toEqual({});
  expect(extractEnquiry("No 31 Feb here", [], "EUR", now).date).toBeUndefined();
});

test("with several known venues, picks the one asked about", () => {
  const found = extractEnquiry(
    "Ahoj! We loved your set at Café V lese. Any chance you could play Kabinet Múz on Sat 16 Jan?",
    venues,
    "EUR",
    now,
  );
  expect(found).toMatchObject({ venueId: "muz", date: "2027-01-16" });
});

test("a date or set count after a bare 'play' is never read as the start time", () => {
  const found = extractEnquiry(
    "Can you play 17 Jan at Kabinet Múz? Two sets, start at 9pm.",
    venues,
    "EUR",
    now,
  );
  expect(found).toMatchObject({ date: "2027-01-17", sets: 2, start: "21:00" });
});

test("'play' with an explicit time still counts as the start time", () => {
  expect(extractEnquiry("Playing at 9pm sharp.", [], "EUR", now).start).toBe(
    "21:00",
  );
  expect(extractEnquiry("Can you play 21:30?", [], "EUR", now).start).toBe(
    "21:30",
  );
});
