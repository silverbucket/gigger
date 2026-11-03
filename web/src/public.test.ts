import { expect, test } from "bun:test";
import {
  type Gig,
  Gigger,
  type GiggerStore,
  publicGig,
  slugify,
} from "@gigger/schemas";
import RemoteStorage from "remotestoragejs";

const privateValues = [
  "5000",
  "Dinner",
  "Side entrance",
  "Promoter",
  "p@example.com",
  "Can you play?",
  "takeHome",
  "rating",
  "stageNotes",
];

test("confirmed gigs publish only public fields and unpublish when cancelled or private", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Gigger);
  storage.access.claim("gigger", "rw");
  storage.caching.enable("/gigger/");
  storage.caching.enable("/public/gigger/");
  const store = (storage as RemoteStorage & { gigger: GiggerStore }).gigger;
  const pub = storage.scope("/public/gigger/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  try {
    await store.save("band", "a", {
      id: "a",
      name: "Čeští Kluci",
      slug: "cesti-kluci",
      locale: "cs-CZ",
    });
    await store.save("venue", "a", {
      id: "v",
      name: "Club",
      address: "Main St 5",
      city: "Praha",
    });
    await store.save("contact", "a", {
      id: "c",
      name: "Promoter",
      email: "p@example.com",
    });
    const gig: Gig = {
      id: "g",
      title: "Show",
      venueId: "v",
      contactIds: ["c"],
      date: "2030-06-20",
      setTimes: ["20:00", "21:30"],
      fee: { amount: 5000, currency: "CZK", extras: ["Dinner"] },
      notes: "Side entrance",
      enquiryText: "Can you play?",
      enquirySource: "email",
      public: {
        ticketUrl: "https://tickets.example/g",
        description: "All ages",
      },
      status: "offered",
    };
    await store.save("gig", "a", gig);
    expect(await pub.getObject("cesti-kluci/gigs/g")).toBeFalsy();
    await store.moveGigStatus("a", "g", "confirmed");
    const copy = await pub.getObject("cesti-kluci/gigs/g");
    expect(copy).toMatchObject({
      date: "2030-06-20",
      start: "20:00",
      venue: "Club",
      city: "Praha",
      ticketUrl: "https://tickets.example/g",
      description: "All ages",
    });
    const page = await pub.getObject("cesti-kluci/page");
    expect(page).toMatchObject({ name: "Čeští Kluci", locale: "cs-CZ" });
    expect(Object.keys((page as { gigs: object }).gigs)).toEqual(["g"]);
    for (const text of [JSON.stringify(copy), JSON.stringify(page)]) {
      for (const value of privateValues) expect(text).not.toContain(value);
      expect(text).not.toMatch(/fee|notes|contact|earnings|survey|enquiry/);
    }
    await store.markPlayed(
      "a",
      "g",
      {
        rating: 4,
        capacity: "50–100",
        setting: "indoor",
        pa: "venue provided",
        stageNotes: "Low ceiling",
        playAgain: true,
      },
      { dealType: "fixed fee", total: 5000, takeHome: 5000, currency: "CZK" },
    );
    const played = JSON.stringify(await pub.getObject("cesti-kluci/page"));
    expect(played).toContain("Club");
    expect(played).not.toMatch(/Low ceiling|takeHome|rating|5000/);
    await store.save("gig", "a", { ...gig, id: "h", status: "confirmed" });
    await store.moveGigStatus("a", "h", "cancelled");
    expect(await pub.getObject("cesti-kluci/gigs/h")).toBeFalsy();
    expect(
      Object.keys(
        ((await pub.getObject("cesti-kluci/page")) as { gigs: object }).gigs,
      ),
    ).toEqual(["g"]);
    await store.save("band", "a", {
      id: "a",
      name: "Renamed",
      slug: "renamed",
    });
    await store.publishBand("a", "cesti-kluci");
    expect(await pub.getObject("cesti-kluci/page")).toBeFalsy();
    expect(await pub.getObject("cesti-kluci/gigs/g")).toBeFalsy();
    expect(await pub.getObject("renamed/gigs/g")).toMatchObject({
      venue: "Club",
    });
    expect(await pub.getObject("renamed/page")).toMatchObject({
      name: "Renamed",
    });
    await expect(
      store.save("band", "a", { id: "a", name: "Bad", slug: "Not A Slug" }),
    ).rejects.toBeDefined();
  } finally {
    storage.stopSync();
  }
});

test("public copy omits unset fields and slugs are URL safe", () => {
  expect(
    publicGig({
      id: "g",
      title: "Show",
      venue: "Legacy Hall",
      address: "Old St",
      contacts: ["Jo"],
      date: "2030-01-01",
      fee: "5000 CZK",
      notes: "Private",
      status: "confirmed",
    }),
  ).toEqual({ date: "2030-01-01", venue: "Legacy Hall" });
  expect(slugify("  Čeští Kluci & The Band! ")).toBe("cesti-kluci-the-band");
  expect(slugify("---")).toBe("");
});
