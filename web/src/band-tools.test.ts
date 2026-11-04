import { expect, test } from "bun:test";
import { Gigger, type GiggerStore } from "@gigger/schemas";
import RemoteStorage from "remotestoragejs";

test("availability, gig sheet records, set-aside messages and contact removal", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Gigger);
  storage.access.claim("gigger", "rw");
  storage.caching.enable("/gigger/");
  const store = (storage as RemoteStorage & { gigger: GiggerStore }).gigger;
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  try {
    await store.save("venue", "a", {
      id: "v",
      name: "Club",
      address: "Main St",
    });
    await store.save("contact", "a", { id: "c", name: "Promoter" });
    await store.save("contact", "a", { id: "spare", name: "Nobody" });
    await store.save("gig", "a", {
      id: "g",
      title: "Show",
      venueId: "v",
      contactIds: ["c"],
      date: "2030-06-20",
      status: "confirmed",
    });

    let gig = await store.setAvailability("a", "g", "m1", "yes");
    gig = await store.setAvailability("a", "g", "m2", "no");
    expect(gig.availability).toEqual({ m1: "yes", m2: "no" });
    gig = await store.setAvailability("a", "g", "m2", null);
    expect(gig.availability).toEqual({ m1: "yes" });
    gig = await store.setAvailability("a", "g", "m1", null);
    expect(gig.availability).toBeUndefined();
    await expect(
      store.setAvailability("a", "g", "../x", "yes"),
    ).rejects.toThrow();

    gig = await store.markSheetSent(
      "a",
      "g",
      ["m1", "m1", "m2"],
      "2030-06-01T10:00:00.000Z",
    );
    expect(gig).toMatchObject({
      sheetSentAt: "2030-06-01T10:00:00.000Z",
      sheetSentTo: ["m1", "m2"],
    });
    expect((await store.list("gig", "a"))[0].sheetSentTo).toEqual(["m1", "m2"]);

    await store.archiveConversation(
      "a",
      "email-a-am9",
      "2030-06-01T10:00:00.000Z",
    );
    expect(await store.list("triage", "a")).toMatchObject([
      { id: "email-a-am9", status: "archived", at: "2030-06-01T10:00:00.000Z" },
    ]);
    await store.unarchiveConversation("a", "email-a-am9");
    expect(await store.list("triage", "a")).toEqual([]);

    await expect(store.removeContact("a", "c")).rejects.toThrow("linked");
    await store.removeContact("a", "spare");
    expect((await store.list("contact", "a")).map((c) => c.id)).toEqual(["c"]);

    await store.markPlayed(
      "a",
      "g",
      {
        rating: 4,
        capacity: "50–100",
        setting: "indoor",
        pa: "mixed",
        playAgain: true,
        attendance: 85,
      },
      { dealType: "door", total: 100, takeHome: 100, currency: "EUR" },
    );
    expect((await store.list("survey", "a"))[0].attendance).toBe(85);
  } finally {
    storage.stopSync();
  }
});
