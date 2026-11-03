import { expect, test } from "bun:test";
import type { Gig, Venue } from "@gigger/schemas";
import { groupBookings, playedAtVenue, searchNamed } from "./booking-list";

const venue: Venue = { id: "v", name: "Club", address: "Main St" };
const gig: Gig = {
  id: "g",
  title: "Show",
  date: "2030-06-20",
  status: "enquiry",
  venueId: "v",
  contactIds: [],
};

test("booking groups keep band and venue context across bands with duplicate gig IDs", () => {
  const summaries = [
    {
      band: { id: "a", name: "First" },
      venues: [venue],
      gigs: [
        gig,
        {
          ...gig,
          id: "later",
          date: "2030-07-01",
          status: "confirmed" as const,
        },
      ],
    },
    {
      band: { id: "b", name: "Second" },
      venues: [{ ...venue, name: "Other club" }],
      gigs: [{ ...gig, status: "confirmed" as const }],
    },
  ];
  const groups = groupBookings(summaries, "");
  expect(groups.map((group) => group.status)).toEqual(["confirmed", "enquiry"]);
  expect(
    groups[0]?.rows.map((row) => [row.gig.id, row.band.name, row.venueName]),
  ).toEqual([
    ["g", "Second", "Other club"],
    ["later", "First", "Club"],
  ]);
  expect(
    groupBookings(summaries, "a")
      .flatMap((group) => group.rows)
      .every((row) => row.band.id === "a"),
  ).toBe(true);
  expect(groupBookings(summaries, "missing")).toEqual([]);
  expect(summaries[0]?.gigs[0]?.id).toBe("g");
});

test("venue history includes only played gigs at that venue, including exact legacy matches", () => {
  const { venueId: _, ...legacy } = gig;
  const gigs: Gig[] = [
    { ...gig, id: "played", status: "played" },
    { ...gig, id: "future", status: "confirmed" },
    { ...gig, id: "other", status: "played", venueId: "other" },
    {
      ...legacy,
      id: "legacy",
      status: "played",
      date: "2029-01-01",
      venue: venue.name,
      address: venue.address,
      contacts: [],
    },
    {
      ...legacy,
      id: "same-name",
      status: "played",
      venue: venue.name,
      address: "Different St",
      contacts: [],
    },
  ];
  expect(playedAtVenue(gigs, venue).map((gig) => gig.id)).toEqual([
    "played",
    "legacy",
  ]);
  expect(gigs[0]?.id).toBe("played");
  expect(playedAtVenue([], venue)).toEqual([]);
});

test("name search ignores case and accents and limits suggestions", () => {
  const items = [{ name: "Čáslav" }, { name: "CASA" }, { name: "Other" }];
  expect(searchNamed(items, "cAs").map((item) => item.name)).toEqual([
    "Čáslav",
    "CASA",
  ]);
  expect(searchNamed(items, "ČÁS").map((item) => item.name)).toEqual([
    "Čáslav",
    "CASA",
  ]);
  expect(searchNamed(items, "")).toEqual([]);
  expect(
    searchNamed(
      Array.from({ length: 100 }, (_, i) => ({ name: `Club ${i}` })),
      "club",
    ),
  ).toHaveLength(20);
});
