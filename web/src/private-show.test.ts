import { expect, test } from "bun:test";
import { createShowday, type Gig, Showday } from "@showday/schemas";
import RemoteStorage from "remotestoragejs";

async function setup() {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  storage.caching.enable("/public/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const publicClient = storage.scope("/public/showday/");
  // In-memory storage has no server; a maxAge 0 read is answered from the cache.
  const getObject = publicClient.getObject.bind(publicClient);
  publicClient.getObject = async (path: string, maxAge?: false | number) =>
    getObject(path, maxAge === 0 ? undefined : maxAge);
  const store = createShowday(privateClient, publicClient);
  await store.save("band", "a", { id: "a", name: "Band", slug: "band" });
  await store.save("contact", "a", { id: "c", name: "Host" });
  return { storage, store, publicClient };
}

const party: Gig = {
  id: "p",
  title: "Birthday",
  privateShow: true,
  address: "Na Kampě 7, Praha 1\nRing twice, second floor",
  contactIds: ["c"],
  date: "2030-06-20",
  setTimes: ["21:00"],
  status: "confirmed",
};

test("a private show needs an address, has no venue and never reaches the public page", async () => {
  const { storage, store, publicClient } = await setup();
  try {
    const { address: _, ...noAddress } = party;
    await expect(store.save("gig", "a", noAddress)).rejects.toBeDefined();
    await store.save("gig", "a", party);
    expect(await publicClient.getObject("band/gigs/p")).toBeFalsy();
    // Turning a public gig into a private show takes it off the page.
    await store.save("venue", "a", {
      id: "v",
      name: "Club",
      address: "Main St 5",
      country: "DE",
    });
    await store.save("gig", "a", {
      id: "g",
      title: "Show",
      venueId: "v",
      contactIds: ["c"],
      date: "2030-06-21",
      status: "confirmed",
    });
    expect(await publicClient.getObject("band/gigs/g")).toMatchObject({
      venue: "Club",
      country: "DE",
    });
    const { venueId: __, ...rest } = (await store.list("gig", "a")).find(
      (g) => g.id === "g",
    ) as Gig;
    await store.save("gig", "a", {
      ...rest,
      privateShow: true,
      address: "Garden",
    });
    expect(await publicClient.getObject("band/gigs/g")).toBeFalsy();
  } finally {
    storage.stopSync();
  }
});

test("a private show is marked played without a venue survey", async () => {
  const { storage, store, publicClient } = await setup();
  try {
    await store.save("gig", "a", party);
    const played = await store.markPlayed("a", "p", undefined, {
      dealType: "pass the hat",
      hat: 3000,
      total: 3000,
      takeHome: 3000,
      currency: "CZK",
    });
    expect(played.status).toBe("played");
    expect(played.venueId).toBeUndefined();
    expect(await store.list("venue", "a")).toEqual([]);
    expect(await store.list("survey", "a")).toEqual([]);
    expect(await publicClient.getObject("band/gigs/p")).toBeFalsy();
  } finally {
    storage.stopSync();
  }
});

test("venue countries are ISO codes", async () => {
  const { storage, store } = await setup();
  try {
    await expect(
      store.save("venue", "a", {
        id: "x",
        name: "Club",
        address: "Main St",
        country: "Germany",
      }),
    ).rejects.toBeDefined();
  } finally {
    storage.stopSync();
  }
});
