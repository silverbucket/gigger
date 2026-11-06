import { expect, test } from "bun:test";
import {
  createShowday,
  type Gig,
  groupGigs,
  recordPath,
  Showday,
  type ShowdayStore,
} from "@showday/schemas";
import RemoteStorage from "remotestoragejs";

test("real remoteStorage module validates and stores bands and related records", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  const store = (storage as RemoteStorage & { showday: ShowdayStore }).showday;
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  try {
    await store.save("band", "a", { id: "a", name: "First" });
    await store.save("band", "b", { id: "b", name: "Second" });
    await store.save("member", "a", {
      id: "m",
      name: "Sam",
      messenger: "@sam",
    });
    await store.save("member", "b", {
      id: "n",
      name: "Jo",
      phone: "+420123456789",
    });
    expect((await store.bands()).map((b) => b.name).sort()).toEqual([
      "First",
      "Second",
    ]);
    expect((await store.list("member", "a")).map((m) => m.name)).toEqual([
      "Sam",
    ]);
    await store.save("member", "a", {
      id: "m",
      name: "Samuel",
      phone: "+420111222333",
    });
    const edited = await store.list("member", "a");
    expect(edited).toHaveLength(1);
    expect(edited[0]?.name).toBe("Samuel");
    expect(edited[0]?.messenger).toBeUndefined();
    await store.save("member", "a", {
      id: "m",
      name: "Samuel",
      email: "sam@example.com",
    });
    expect((await store.list("member", "a"))[0]?.email).toBe("sam@example.com");
    expect((await store.list("member", "a"))[0]?.phone).toBeUndefined();
    await store.save("member", "a", { id: "m", name: "Samuel" });
    const nameOnly = (await store.list("member", "a"))[0];
    expect(nameOnly?.name).toBe("Samuel");
    expect(nameOnly?.email).toBeUndefined();
    await expect(
      store.save("member", "a", {
        id: "bad",
        name: "Invalid email",
        email: "invalid",
      }),
    ).rejects.toBeDefined();
    await store.removeMember("a", "m");
    expect(await store.list("member", "a")).toEqual([]);
    expect((await store.list("member", "b"))[0]?.name).toBe("Jo");
    await expect(store.removeMember("a", "../escape")).rejects.toThrow(
      "Invalid ID",
    );
    await expect(
      store.save("member", "a", { id: "bad", name: "   " }),
    ).rejects.toBeDefined();
    await expect(
      store.save("band", "a", { id: "a", name: "   " }),
    ).rejects.toBeDefined();
    const gig: Gig = {
      id: "g",
      title: "Show",
      venue: "Club",
      address: "Main St",
      contacts: ["Jo +420123456789"],
      date: "2030-01-01",
      loadIn: "15:00",
      soundcheck: "17:00",
      setTimes: ["20:00", "21:30"],
      fee: "5000 CZK",
      notes: "Backline provided",
      status: "confirmed",
    };
    await store.save("gig", "a", gig);
    await expect(
      store.save("gig", "a", { ...gig, loadIn: "25:00" }),
    ).rejects.toBeDefined();
    await expect(
      store.save("gig", "a", { ...gig, date: "tomorrow" }),
    ).rejects.toBeDefined();
    await expect(
      store.save("gig", "a", { ...gig, status: "unknown" as Gig["status"] }),
    ).rejects.toBeDefined();
    await store.save("venue", "a", {
      id: "v",
      name: "Club",
      address: "Main St",
    });
    expect((await store.list("gig", "a"))[0]?.title).toBe("Show");
    await expect(
      store.save("band", "other", { id: "a", name: "Wrong path" }),
    ).rejects.toThrow("Band ID must match");
    await storage
      .scope("/showday/")
      .storeFile(
        "application/json",
        "bands/a/members/bad",
        JSON.stringify({ id: "bad", name: "" }),
      );
    await expect(store.list("member", "a")).rejects.toThrow(
      "Invalid member record",
    );
    expect(recordPath("member", "a", "m")).toBe("bands/a/members/m");
    expect(() => recordPath("band", "../escape")).toThrow("Invalid ID");
  } finally {
    storage.stopSync();
  }
});

test("overview groups every status with upcoming confirmed gigs first", () => {
  const gig: Gig = {
    id: "base",
    title: "Show",
    venue: "Club",
    address: "Main St",
    contacts: [],
    date: "2030-01-01",
    status: "confirmed",
  };
  const gigs: Gig[] = [
    { ...gig, id: "past", date: "2020-01-01" },
    { ...gig, id: "later", date: "2030-02-01" },
    { ...gig, id: "first" },
    { ...gig, id: "today", date: "2029-01-01" },
    { ...gig, id: "offered", status: "offered" },
    { ...gig, id: "enquiry", status: "enquiry" },
    { ...gig, id: "played", status: "played" },
    { ...gig, id: "cancelled", status: "cancelled" },
  ];
  const groups = groupGigs(gigs, "2029-01-01");
  expect(groups.map((group) => group.status)).toEqual([
    "confirmed",
    "offered",
    "enquiry",
    "played",
    "cancelled",
  ]);
  expect(groups[0]?.gigs.map((gig) => gig.id)).toEqual([
    "today",
    "first",
    "later",
    "past",
  ]);
  expect(groups.flatMap((group) => group.gigs)).toHaveLength(gigs.length);
  expect(groupGigs([])).toEqual([]);
  expect(gigs[0]?.id).toBe("past");
});

test("listing fetches an uncached child even when its parent listing is fresh", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const client = storage.scope("/showday/");
  const store = createShowday(client);
  try {
    await store.save("venue", "a", {
      id: "v",
      name: "Club",
      address: "Main Street",
    });
    const original = client.getObject.bind(client);
    const ages: (number | false | undefined)[] = [];
    client.getObject = async (path, maxAge) => {
      ages.push(maxAge);
      return maxAge === undefined ? undefined : original(path);
    };
    expect(await store.list("venue", "a")).toMatchObject([
      { id: "v", name: "Club" },
    ]);
    expect(ages).toEqual([undefined, 0]);
  } finally {
    await storage.disconnect();
  }
});
