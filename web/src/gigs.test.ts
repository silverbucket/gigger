import { expect, test } from "bun:test";
import type { Gig } from "@showday/schemas";
import type { BandData } from "./lib/data.svelte";
import { sheetText, timeCells } from "./lib/gigs";

const band: BandData["band"] = {
  id: "b",
  name: "The Low Hums",
  currency: "EUR",
};

test("every scheduled time becomes a cell, even past four", () => {
  const gig: Gig = {
    id: "g",
    title: "Show",
    date: "2030-06-20",
    status: "confirmed",
    loadIn: "16:00",
    soundcheck: "17:00",
    setTimes: ["20:00", "21:30", "23:00"],
    setLength: 45,
  };
  const cells = timeCells(gig);
  expect(cells.map((c) => c.label)).toEqual([
    "Load-in",
    "Soundcheck",
    "Set 1",
    "Set 2",
    "Set 3",
  ]);
  expect(cells.at(-1)).toMatchObject({ value: "23:00", note: "45 minutes" });
});

test("the shared gig sheet includes every linked contact's channels, and legacy free-text contacts", () => {
  const gig: Gig = {
    id: "g",
    title: "Kabinet Múz",
    date: "2030-06-20",
    status: "confirmed",
    venueId: "v",
    contactIds: ["c"],
    contacts: ["Legacy promoter · 555-0100"],
  };
  const data: BandData = {
    band,
    members: [],
    gigs: [gig],
    venues: [{ id: "v", name: "Kabinet Múz", address: "Sukova 4" }],
    contacts: [
      {
        id: "c",
        name: "Tomáš Kříž",
        messenger: "tomas.kriz",
        instagram: "kabinetmuz",
      },
    ],
    otherBands: [],
    surveys: [],
    triage: [],
  };
  const text = sheetText(gig, data);
  expect(text).toContain("Contact: Tomáš Kříž · tomas.kriz · kabinetmuz");
  expect(text).toContain("Contact: Legacy promoter · 555-0100");
});
