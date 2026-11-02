import { expect, test } from "bun:test";
import {
  calculateTakeHome,
  createGigger,
  Gigger,
  type GiggerStore,
  type VenueSurvey,
  venueAverages,
} from "@gigger/schemas";
import RemoteStorage from "remotestoragejs";

const survey: VenueSurvey = {
  gigId: "g",
  date: "2030-01-01",
  rating: 4,
  capacity: "50–100",
  setting: "indoor",
  pa: "venue provided",
  stageNotes: "Small stage",
  playAgain: true,
};
test("take-home splits, zero values and currency rounding", () => {
  expect(calculateTakeHome(100)).toBe(100);
  expect(calculateTakeHome(100, 3)).toBe(33.33);
  expect(calculateTakeHome(100, undefined, 30)).toBe(70);
  expect(calculateTakeHome(100, undefined, 0)).toBe(100);
  expect(calculateTakeHome(0, 2)).toBe(0);
});
test("venue averages include ties and count only fully venue-provided PA", () => {
  expect(venueAverages([])).toBeNull();
  expect(
    venueAverages([
      survey,
      { ...survey, rating: 2, capacity: "500+", pa: "mixed" },
    ]),
  ).toEqual({
    rating: 3,
    capacities: ["50–100", "500+"],
    paProvided: 1,
    count: 2,
  });
});
test("survey validation and earnings isolation using real private/public storage clients", async () => {
  const rs = new RemoteStorage();
  rs.addModule(Gigger);
  rs.access.claim("gigger", "rw");
  const store = (rs as RemoteStorage & { gigger: GiggerStore }).gigger;
  await new Promise<void>((resolve) => rs.on("ready", () => resolve()));
  try {
    await store.save("band", "a", {
      id: "a",
      name: "Touring band",
      currency: "CZK",
    });
    await store.save("venue", "a", {
      id: "v",
      name: "Club",
      address: "Main St",
    });
    const venue = {
      id: "v",
      name: "Club",
      address: "Main St",
      surveys: [survey],
    };
    for (const patch of [
      { rating: 0 },
      { rating: 6 },
      { rating: 1.5 },
      { capacity: "100" },
      { setting: "both" },
      { pa: "yes" },
      { playAgain: "yes" },
      { earnings: { total: 500 } },
      { takeHome: 500 },
      { freeform: "unexpected" },
    ]) {
      await expect(
        store.save("venue", "a", {
          ...venue,
          surveys: [{ ...survey, ...patch }],
        } as typeof venue),
      ).rejects.toBeDefined();
    }
    const { rating: _, ...missing } = survey;
    await expect(
      store.save("venue", "a", { ...venue, surveys: [missing as VenueSurvey] }),
    ).rejects.toBeDefined();
    await store.save("gig", "a", {
      id: "g",
      title: "Show",
      date: survey.date,
      status: "confirmed",
      venueId: "v",
      contactIds: [],
    });
    const earnings = {
      dealType: "door" as const,
      door: 600,
      total: 600,
      numberOfBands: 2,
      takeHome: 300,
      currency: "CZK",
    };
    for (const patch of [
      { takeHome: -1 },
      { door: -1 },
      { total: -1 },
      { currency: "czk" },
      { numberOfBands: 0 },
      { numberOfBands: 1.5 },
      { handedOver: 1 },
      { dealType: "other" },
    ])
      await expect(
        store.markPlayed("a", "g", survey, {
          ...earnings,
          ...patch,
        } as typeof earnings),
      ).rejects.toBeDefined();
    const { numberOfBands: _bands, ...noSplit } = earnings;
    await expect(
      store.markPlayed("a", "g", survey, { ...noSplit, handedOver: 601 }),
    ).rejects.toThrow("cannot exceed");
    expect((await store.list("venue", "a"))[0]?.surveys).toBeUndefined();
    await store.markPlayed(
      "a",
      "g",
      { ...survey, earnings, total: 600 } as VenueSurvey,
      earnings,
    );
    expect((await store.list("gig", "a"))[0]?.earnings).toEqual(earnings);
    await store.save("gig", "a", {
      id: "germany",
      title: "Germany",
      date: "2030-01-02",
      status: "confirmed",
      venueId: "v",
      contactIds: [],
    });
    await store.markPlayed("a", "germany", survey, {
      ...earnings,
      currency: "EUR",
    });
    const tour = await store.list("gig", "a");
    expect(tour.find((gig) => gig.id === "g")?.earnings?.currency).toBe("CZK");
    expect(tour.find((gig) => gig.id === "germany")?.earnings?.currency).toBe(
      "EUR",
    );
    expect((await store.bands())[0]?.currency).toBe("CZK");
    const savedVenue = (await store.list("venue", "a"))[0];
    expect(savedVenue?.surveys).toEqual([
      survey,
      { ...survey, gigId: "germany", date: "2030-01-02" },
    ]);
    expect(JSON.stringify(savedVenue)).not.toContain("earnings");
    expect(JSON.stringify(savedVenue)).not.toContain("takeHome");
    expect(await store.list("gig", "b")).toEqual([]);
    expect(
      Object.keys((await rs.scope("/public/gigger/").getAll("bands/")) ?? {}),
    ).toEqual([]);
    await expect(store.markPlayed("a", "g", survey, earnings)).rejects.toThrow(
      "Reload",
    );
  } finally {
    await rs.disconnect();
  }
});

test("legacy venue creation and retry after gig write fails keep one survey", async () => {
  const rs = new RemoteStorage();
  rs.access.claim("gigger", "rw");
  await new Promise<void>((resolve) => rs.on("ready", () => resolve()));
  const client = rs.scope("/gigger/");
  const store = createGigger(client);
  try {
    await store.save("gig", "a", {
      id: "g",
      title: "Legacy",
      date: survey.date,
      status: "confirmed",
      venue: "Club",
      address: "Main St",
      contacts: [],
    });
    const original = client.storeObject.bind(client);
    let failGig = true;
    client.storeObject = async (kind, path, value) => {
      if (kind === "gig" && failGig) {
        failGig = false;
        throw new Error("Write failed");
      }
      return original(kind, path, value);
    };
    const earnings = {
      dealType: "fixed fee" as const,
      total: 100,
      takeHome: 80,
      currency: "EUR",
    };
    await expect(store.markPlayed("a", "g", survey, earnings)).rejects.toThrow(
      "Write failed",
    );
    expect((await store.list("gig", "a"))[0]?.status).toBe("confirmed");
    await store.markPlayed("a", "g", survey, earnings);
    expect((await store.list("venue", "a"))[0]?.surveys).toEqual([survey]);
    expect((await store.list("gig", "a"))[0]).toMatchObject({
      venueId: "gig-g",
      status: "played",
      earnings,
    });
  } finally {
    await rs.disconnect();
  }
});
