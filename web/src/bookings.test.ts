import { expect, test } from "bun:test";
import {
  type Contact,
  canMoveStatus,
  type Gig,
  Gigger,
  type GiggerStore,
  gigStatuses,
  recordPath,
} from "@gigger/schemas";
import RemoteStorage from "remotestoragejs";

test("status moves cover every pair and keep terminal statuses closed", () => {
  const allowed = new Set([
    "enquiry:offered",
    "enquiry:cancelled",
    "offered:confirmed",
    "offered:cancelled",
    "confirmed:played",
    "confirmed:cancelled",
  ]);
  for (const from of gigStatuses)
    for (const to of gigStatuses)
      expect(canMoveStatus(from, to)).toBe(allowed.has(`${from}:${to}`));
});

test("linked booking schemas, band isolation and status enforcement", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Gigger);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  const store = (storage as RemoteStorage & { showday: GiggerStore }).showday;
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  try {
    await store.save("venue", "a", {
      id: "v",
      name: "Club",
      address: "Main St",
    });
    await store.save("contact", "a", {
      id: "c",
      name: "Promoter",
      email: "p@example.com",
      instagram: "@p",
    });
    expect(await store.list("venue", "a")).toHaveLength(1);
    expect(await store.list("contact", "a")).toHaveLength(1);
    expect(await store.list("contact", "b")).toEqual([]);
    expect(recordPath("contact", "a", "c")).toBe("bands/a/contacts/c");
    const gig: Gig = {
      id: "g",
      title: "Show",
      venueId: "v",
      contactIds: ["c"],
      date: "2030-06-20",
      contactDate: "2030-01-15",
      status: "enquiry",
      enquiryText: "Can you play?",
      enquirySource: "messenger",
      setLength: 45,
      fee: { amount: "500 EUR", extras: ["Travel", "Dinner"] },
      public: {
        ticketUrl: "https://example.com/tickets",
        description: "Live music",
      },
    };
    await store.save("gig", "a", gig);
    expect((await store.list("gig", "a"))[0]).toMatchObject(gig);
    for (const patch of [
      { enquirySource: "sms" },
      { enquirySource: "" },
      { venueId: "" },
      { contactIds: ["../escape"] },
      { public: { ticketUrl: "https://example.com", unexpected: true } },
      { setLength: 0 },
      { setLength: 2.5 },
      { fee: { extras: [4] } },
      { fee: { amount: -1, extras: [] } },
      { fee: { amount: 500, currency: "eur", extras: [] } },
      { public: { ticketUrl: "javascript:alert(1)" } },
      { contactIds: ["c", "c"] },
      { venueId: "missing" },
      { contactIds: ["missing"] },
      { date: "tomorrow" },
      { contactDate: "yesterday" },
      { status: "played" },
    ])
      await expect(
        store.save("gig", "a", { ...gig, ...patch } as Gig),
      ).rejects.toBeDefined();
    await expect(store.save("gig", "b", gig)).rejects.toBeDefined();
    await store.save("gig", "a", { ...gig, contactDate: "2030-01-16" });
    expect((await store.list("gig", "a"))[0]).toMatchObject({
      contactDate: "2030-01-16",
      date: "2030-06-20",
    });
    const { contactDate: _, ...withoutContactDate } = gig;
    await store.save("gig", "a", withoutContactDate);
    expect((await store.list("gig", "a"))[0]?.contactDate).toBeUndefined();
    for (const source of ["instagram", "email", "other"] as const)
      await store.save("gig", "a", { ...gig, enquirySource: source });
    for (const status of ["offered", "confirmed", "played"] as const)
      await store.save("gig", "a", { ...gig, status });
    await expect(store.save("gig", "a", gig)).rejects.toThrow(
      "This gig changed somewhere else, reload to see the latest",
    );
    const stale = { ...gig, id: "synced" };
    await store.save("gig", "a", stale);
    const latest = {
      ...stale,
      date: "2031-07-01",
      notes: "Synced notes",
      fee: { amount: "900 EUR", extras: ["Hotel"] },
    };
    await store.save("gig", "a", latest);
    const moved = await store.moveGigStatus("a", stale.id, "offered");
    expect(moved).toMatchObject({ ...latest, status: "offered" });
    expect(
      (await store.list("gig", "a")).find((g) => g.id === stale.id),
    ).toMatchObject({ ...latest, status: "offered" });
    await store.moveGigStatus("a", stale.id, "cancelled");
    await expect(
      store.moveGigStatus("a", stale.id, "confirmed"),
    ).rejects.toThrow(
      "This gig changed somewhere else, reload to see the latest",
    );
    await expect(
      store.moveGigStatus("a", "missing", "offered"),
    ).rejects.toThrow("Invalid gig record");
    await expect(store.moveGigStatus("b", stale.id, "offered")).rejects.toThrow(
      "Invalid gig record",
    );
    const cancelled = { ...gig, id: "cancel" };
    await store.save("gig", "a", cancelled);
    await store.save("gig", "a", { ...cancelled, status: "cancelled" });
    await expect(store.save("gig", "a", cancelled)).rejects.toThrow();
    for (const invalid of [
      { id: "bad", name: " " },
      { id: "bad", name: "P", email: "invalid" },
    ])
      await expect(
        store.save("contact", "a", invalid as Contact),
      ).rejects.toBeDefined();
    await expect(
      store.save("venue", "a", { id: "bad", name: "Club", address: "" }),
    ).rejects.toBeDefined();
  } finally {
    storage.stopSync();
  }
});

test("other bands are reusable records with contact links and band-scoped gig references", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Gigger);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  const store = (storage as RemoteStorage & { showday: GiggerStore }).showday;
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  try {
    await store.save("band", "a", { id: "a", name: "Our band" });
    await store.save("contact", "a", {
      id: "c",
      name: "Their singer",
      email: "singer@example.com",
    });
    await store.save("venue", "a", {
      id: "v",
      name: "Club",
      address: "Main St",
    });
    await store.save("otherBand", "a", {
      id: "support",
      name: "Another band",
      contactIds: ["c"],
      notes: "Shared backline",
    });
    await store.save("otherBand", "a", {
      id: "no-contacts",
      name: "New friends",
      contactIds: [],
    });
    expect(recordPath("otherBand", "a", "support")).toBe(
      "bands/a/otherBands/support",
    );
    const gig: Gig = {
      id: "one",
      title: "Show",
      date: "2030-06-20",
      status: "enquiry",
      venueId: "v",
      contactIds: [],
      otherBandIds: ["support"],
    };
    await store.save("gig", "a", gig);
    await store.save("gig", "a", { ...gig, id: "two", date: "2030-08-01" });
    await store.save("otherBand", "a", {
      id: "support",
      name: "Renamed band",
      contactIds: ["c"],
    });
    expect(
      (await store.list("otherBand", "a")).find((b) => b.id === "support"),
    ).toMatchObject({ name: "Renamed band", contactIds: ["c"] });
    expect((await store.list("gig", "a")).map((g) => g.otherBandIds)).toEqual([
      ["support"],
      ["support"],
    ]);
    expect(await store.bands()).toHaveLength(1);
    expect(await store.list("otherBand", "b")).toEqual([]);
    for (const patch of [
      { otherBandIds: ["missing"] },
      { otherBandIds: ["support", "support"] },
      { otherBandIds: ["../escape"] },
    ])
      await expect(
        store.save("gig", "a", { ...gig, ...patch }),
      ).rejects.toBeDefined();
    for (const patch of [
      { name: "  ", contactIds: [] },
      { name: "Invalid contact", contactIds: ["missing"] },
      { name: "Duplicate contact", contactIds: ["c", "c"] },
    ])
      await expect(
        store.save("otherBand", "a", { id: "bad", ...patch }),
      ).rejects.toBeDefined();
    await expect(
      store.save("otherBand", "b", {
        id: "support",
        name: "Wrong band",
        contactIds: ["c"],
      }),
    ).rejects.toBeDefined();
    await store.save("otherBand", "b", {
      id: "foreign",
      name: "Foreign",
      contactIds: [],
    });
    await expect(
      store.save("gig", "a", { ...gig, otherBandIds: ["foreign"] }),
    ).rejects.toBeDefined();
    expect(
      (await store.moveGigStatus("a", "one", "offered")).otherBandIds,
    ).toEqual(["support"]);
  } finally {
    storage.stopSync();
  }
});
