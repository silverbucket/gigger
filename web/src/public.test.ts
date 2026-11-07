import { expect, test } from "bun:test";
import {
  type Band,
  type Gig,
  PAGE_THEME_PRESETS,
  publicGig,
  publicPageCouldNotPublish,
  publicPageRemoteMatches,
  Showday,
  slugify,
} from "@showday/schemas";
import RemoteStorage from "remotestoragejs";

/** In-memory remoteStorage has no server; treat maxAge 0 like a successful server read. */
function mirrorCacheAsRemoteGet(client: {
  getObject: (path: string, maxAge?: false | number) => Promise<unknown>;
}) {
  const getObject = client.getObject.bind(client);
  client.getObject = async (path, maxAge?) => {
    if (maxAge === 0) return getObject(path);
    return getObject(path, maxAge);
  };
}

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
  "published",
];

test("confirmed gigs publish only public fields and unpublish when cancelled or private", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  storage.caching.enable("/public/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const publicClient = storage.scope("/public/showday/");
  mirrorCacheAsRemoteGet(publicClient);
  const { createShowday } = await import("@showday/schemas");
  const store = createShowday(privateClient, publicClient);
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
    expect(await publicClient.getObject("cesti-kluci/gigs/g")).toBeFalsy();
    await store.moveGigStatus("a", "g", "confirmed");
    const copy = await publicClient.getObject("cesti-kluci/gigs/g");
    expect(copy).toMatchObject({
      date: "2030-06-20",
      start: "20:00",
      venue: "Club",
      city: "Praha",
      ticketUrl: "https://tickets.example/g",
      description: "All ages",
    });
    const page = await publicClient.getObject("cesti-kluci/page");
    expect(page).toMatchObject({ name: "Čeští Kluci", locale: "cs-CZ" });
    expect(Object.keys((page as { gigs: object }).gigs)).toEqual([]);
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
    const played = JSON.stringify(
      await publicClient.getObject("cesti-kluci/gigs/g"),
    );
    expect(played).toContain("Club");
    expect(played).not.toMatch(/Low ceiling|takeHome|rating|5000/);
    await store.save("gig", "a", { ...gig, id: "h", status: "confirmed" });
    await store.moveGigStatus("a", "h", "cancelled");
    expect(await publicClient.getObject("cesti-kluci/gigs/h")).toBeFalsy();
    expect(
      Object.keys(
        ((await publicClient.getObject("cesti-kluci/page")) as { gigs: object })
          .gigs,
      ),
    ).toEqual([]);
    await store.save("band", "a", {
      id: "a",
      name: "Renamed",
      slug: "renamed",
    });
    await store.publishBand("a", "cesti-kluci");
    expect(await publicClient.getObject("cesti-kluci/page")).toBeFalsy();
    expect(await publicClient.getObject("cesti-kluci/gigs/g")).toBeFalsy();
    expect(await publicClient.getObject("renamed/gigs/g")).toMatchObject({
      venue: "Club",
    });
    expect(await publicClient.getObject("renamed/page")).toMatchObject({
      name: "Renamed",
    });
    await expect(
      store.save("band", "a", { id: "a", name: "Bad", slug: "Not A Slug" }),
    ).rejects.toBeDefined();
  } finally {
    storage.stopSync();
  }
});

test("unpublish clears the slug and public copy but keeps the private profile", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  storage.caching.enable("/public/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const publicClient = storage.scope("/public/showday/");
  mirrorCacheAsRemoteGet(publicClient);
  const { createShowday } = await import("@showday/schemas");
  const store = createShowday(privateClient, publicClient);
  try {
    const profile = {
      bio: "We play loud",
      city: "Prague",
      theme: { ...PAGE_THEME_PRESETS.night },
    };
    await store.save("band", "a", {
      id: "a",
      name: "Band",
      slug: "band",
      publicProfile: profile,
    });
    await store.publishBand("a");
    expect(await publicClient.getObject("band/page")).toBeTruthy();
    await store.unpublishBand("a");
    expect(await publicClient.getObject("band/page")).toBeFalsy();
    const band = await privateClient.getObject("bands/a/band");
    expect(band).toMatchObject({
      id: "a",
      name: "Band",
      publicProfile: profile,
    });
    expect(band).not.toHaveProperty("slug");
  } finally {
    storage.stopSync();
  }
});

test("publicPageRemoteMatches compares published metadata, not just the name", () => {
  const written = {
    name: "Band",
    gigs: {},
    bio: "New bio",
    publishedRevision: "rev-new",
  };
  expect(
    publicPageRemoteMatches(written, {
      name: "Band",
      gigs: {},
      bio: "Old bio",
      publishedRevision: "rev-old",
    }),
  ).toBeFalse();
  expect(
    publicPageRemoteMatches(written, {
      name: "Band",
      gigs: { g: { date: "2030-01-01", venue: "Club" } },
      bio: "New bio",
      publishedRevision: "rev-new",
    }),
  ).toBeTrue();
});

test("gig save still succeeds while the public page cannot be read from the server", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  storage.caching.enable("/public/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const publicClient = storage.scope("/public/showday/");
  mirrorCacheAsRemoteGet(publicClient);
  const { createShowday } = await import("@showday/schemas");
  const store = createShowday(privateClient, publicClient);
  const getObject = publicClient.getObject.bind(publicClient);
  let pageOffline = false;
  publicClient.getObject = async (path, maxAge) => {
    if (pageOffline && path === "band/page" && maxAge === 0)
      throw new Error("offline");
    return getObject(path, maxAge);
  };
  try {
    await store.save("band", "a", { id: "a", name: "Band", slug: "band" });
    await store.publishBand("a");
    pageOffline = true;
    await store.save("gig", "a", {
      id: "g",
      title: "Gig",
      venue: "Club",
      address: "Street",
      contacts: [],
      date: "2030-01-01",
      status: "offered",
    });
    await store.moveGigStatus("a", "g", "confirmed");
    expect(
      ((await privateClient.getObject("bands/a/gigs/g")) as Gig).status,
    ).toBe("confirmed");
  } finally {
    storage.stopSync();
  }
});

test("publishBand fails when the server still has an older page revision", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  storage.caching.enable("/public/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const publicClient = storage.scope("/public/showday/");
  mirrorCacheAsRemoteGet(publicClient);
  const { createShowday } = await import("@showday/schemas");
  const store = createShowday(privateClient, publicClient);
  const getObject = publicClient.getObject.bind(publicClient);
  publicClient.getObject = async (path, maxAge) => {
    if (path === "band/page" && maxAge === 0) {
      return {
        name: "Band",
        gigs: {},
        bio: "Old bio",
        publishedRevision: "stale-revision",
      };
    }
    return getObject(path, maxAge);
  };
  try {
    const next = {
      id: "a",
      name: "Band",
      slug: "band",
      publicProfile: { bio: "New bio" },
    };
    await expect(store.publishBand("a", undefined, next)).rejects.toThrow(
      publicPageCouldNotPublish,
    );
  } finally {
    storage.stopSync();
  }
});

test("publishBand fails when the app has no public storage client", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const { createShowday } = await import("@showday/schemas");
  const store = createShowday(privateClient);
  try {
    await store.save("band", "a", { id: "a", name: "Band", slug: "band" });
    await expect(store.publishBand("a")).rejects.toThrow(
      publicPageCouldNotPublish,
    );
  } finally {
    storage.stopSync();
  }
});

test("publishBand fails when the public page never appears on the server", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  storage.caching.enable("/public/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const publicClient = storage.scope("/public/showday/");
  mirrorCacheAsRemoteGet(publicClient);
  const { createShowday } = await import("@showday/schemas");
  const store = createShowday(privateClient, publicClient);
  const getObject = publicClient.getObject.bind(publicClient);
  publicClient.getObject = async (path, maxAge) => {
    if (path === "missing/page" && maxAge === 0) return undefined;
    return getObject(path, maxAge);
  };
  try {
    await store.save("band", "a", { id: "a", name: "Band", slug: "cached" });
    await store.publishBand("a");
    const next = { id: "a", name: "Band", slug: "missing" };
    await expect(store.publishBand("a", "cached", next)).rejects.toThrow(
      publicPageCouldNotPublish,
    );
    expect(await getObject("missing/page")).toBeTruthy();
  } finally {
    storage.stopSync();
  }
});

test("publishBand rejects a band name the public page cannot serve", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  storage.caching.enable("/public/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const publicClient = storage.scope("/public/showday/");
  mirrorCacheAsRemoteGet(publicClient);
  const { createShowday } = await import("@showday/schemas");
  const store = createShowday(privateClient, publicClient);
  try {
    const next = { id: "a", name: "   ", slug: "blank" } as Band;
    await expect(store.publishBand("a", undefined, next)).rejects.toThrow(
      publicPageCouldNotPublish,
    );
    expect(await publicClient.getObject("blank/page")).toBeFalsy();
  } finally {
    storage.stopSync();
  }
});

test("publishBand can publish from an unsaved band snapshot", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  storage.caching.enable("/public/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const publicClient = storage.scope("/public/showday/");
  mirrorCacheAsRemoteGet(publicClient);
  const { createShowday } = await import("@showday/schemas");
  const store = createShowday(privateClient, publicClient);
  try {
    await store.save("band", "a", { id: "a", name: "Band" });
    const next = { id: "a", name: "Band", slug: "live-band" };
    await store.publishBand("a", undefined, next);
    expect(await publicClient.getObject("live-band/page")).toMatchObject({
      name: "Band",
    });
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
  expect(slugify(`${"a".repeat(59)} b`)).toBe("a".repeat(59));
});

test("status publication can be retried after a public write fails", async () => {
  const storage = new RemoteStorage();
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  storage.caching.enable("/public/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const publicClient = storage.scope("/public/showday/");
  mirrorCacheAsRemoteGet(publicClient);
  const { createShowday } = await import("@showday/schemas");
  const store = createShowday(privateClient, publicClient);
  try {
    await store.save("band", "a", { id: "a", name: "Band", slug: "band" });
    await store.save("gig", "a", {
      id: "g",
      title: "Gig",
      venue: "Club",
      address: "Street",
      contacts: [],
      date: "2030-01-01",
      status: "confirmed",
    });
    const getPublic = publicClient.getObject.bind(publicClient);
    const lookups: string[] = [];
    publicClient.getObject = async (path, maxAge) => {
      lookups.push(path);
      return getPublic(path, maxAge);
    };
    const remove = publicClient.remove.bind(publicClient);
    const removed: string[] = [];
    publicClient.remove = async (path) => {
      removed.push(path);
      return remove(path);
    };
    await store.save("gig", "a", {
      id: "never",
      title: "Gig",
      venue: "Club",
      address: "Street",
      contacts: [],
      date: "2030-01-01",
      status: "offered",
    });
    expect(removed).not.toContain("band/gigs/never");
    expect(lookups).not.toContain("band/gigs/never");
    await privateClient.storeObject("gig", "bands/a/gigs/legacy", {
      id: "legacy",
      title: "Old",
      venue: "Club",
      address: "Street",
      contacts: [],
      date: "2030-01-01",
      status: "confirmed",
    });
    await publicClient.storeObject("publicGig", "band/gigs/legacy", {
      date: "2030-01-01",
      venue: "Club",
    });
    await store.moveGigStatus("a", "legacy", "cancelled");
    expect(await getPublic("band/gigs/legacy")).toBeFalsy();
    expect(
      ((await privateClient.getObject("bands/a/gigs/never")) as Gig).published,
    ).toBe(false);
    expect(
      ((await privateClient.getObject("bands/a/gigs/g")) as Gig).published,
    ).toBe(true);
    let fail = true;
    publicClient.remove = async (path) => {
      if (fail && path === "band/gigs/g") {
        fail = false;
        throw new Error("Public write failed");
      }
      return remove(path);
    };
    await expect(store.moveGigStatus("a", "g", "cancelled")).rejects.toThrow(
      "Public write failed",
    );
    await store.moveGigStatus("a", "g", "cancelled");
    expect(await publicClient.getObject("band/gigs/g")).toBeFalsy();
    expect(
      ((await publicClient.getObject("band/page")) as { gigs: object }).gigs,
    ).toEqual({});
  } finally {
    storage.stopSync();
  }
});

test("uncached offline removals are queued and retried without deleting a reconfirmed gig", async () => {
  const storage = new RemoteStorage();
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  storage.caching.enable("/public/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const publicClient = storage.scope("/public/showday/");
  mirrorCacheAsRemoteGet(publicClient);
  const { createShowday } = await import("@showday/schemas");
  const store = createShowday(privateClient, publicClient);
  const getPrivate = privateClient.getObject.bind(privateClient);
  privateClient.getObject = (path, _maxAge) => getPrivate(path);
  try {
    await store.save("band", "a", { id: "a", name: "Band", slug: "band" });
    const gig: Gig = {
      id: "g",
      title: "Gig",
      venue: "Club",
      address: "Street",
      contacts: [],
      date: "2030-01-01",
      status: "confirmed",
    };
    await store.save("gig", "a", gig);
    const getObject = publicClient.getObject.bind(publicClient);
    let offline = true;
    publicClient.getObject = async (path, maxAge) => {
      if (path === "band/gigs/g" && offline) {
        if (maxAge === 0) throw new Error("offline");
        return undefined;
      }
      return getObject(path);
    };
    await store.moveGigStatus("a", "g", "cancelled");
    expect(await store.pendingDeletes()).toHaveLength(1);
    expect(await getObject("band/gigs/g")).toBeTruthy();
    offline = false;
    await store.retryPublicDeletes();
    expect(await getObject("band/gigs/g")).toBeFalsy();
    await store.retryPublicDeletes();
    expect(await store.pendingDeletes()).toHaveLength(0);
    await store.save("gig", "a", { ...gig, id: "h" });
    const pendingPath = "pending-public-deletes/a/h";
    await privateClient.storeObject("pendingPublicDelete", pendingPath, {
      slug: "band",
      bandId: "a",
      gigId: "h",
    });
    await store.retryPublicDeletes();
    expect(await getObject("band/gigs/h")).toBeTruthy();
    expect(await store.pendingDeletes()).toHaveLength(0);
  } finally {
    storage.stopSync();
  }
});

test("old slug cleanup is queued before the band record switches slug", async () => {
  const storage = new RemoteStorage();
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  storage.caching.enable("/public/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const publicClient = storage.scope("/public/showday/");
  const { createShowday } = await import("@showday/schemas");
  const store = createShowday(privateClient, publicClient);
  try {
    await store.save("band", "a", { id: "a", name: "Band", slug: "old" });
    await store.queueOldSlugCleanup("a", "old");
    expect(await store.pendingDeletes()).toHaveLength(1);
    await store.save("band", "a", { id: "a", name: "Band", slug: "new" });
    expect(((await privateClient.getObject("bands/a/band")) as Band).slug).toBe(
      "new",
    );
    expect(await store.pendingDeletes()).toHaveLength(1);
  } finally {
    storage.stopSync();
  }
});

test("old address cleanup survives interruption and finds uncached public records", async () => {
  const storage = new RemoteStorage();
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  storage.caching.enable("/public/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  const privateClient = storage.scope("/showday/");
  const publicClient = storage.scope("/public/showday/");
  mirrorCacheAsRemoteGet(publicClient);
  const { createShowday } = await import("@showday/schemas");
  const store = createShowday(privateClient, publicClient);
  try {
    await store.save("band", "a", { id: "a", name: "Band", slug: "old" });
    await store.save("gig", "a", {
      id: "g",
      title: "Gig",
      venue: "Club",
      address: "Street",
      contacts: [],
      date: "2030-01-01",
      status: "confirmed",
    });
    await store.queueOldSlugCleanup("a", "old");
    await store.save("band", "a", { id: "a", name: "Band", slug: "new" });
    const getPrivate = privateClient.getObject.bind(privateClient);
    privateClient.getObject = (path, _maxAge) => getPrivate(path);
    const getPublic = publicClient.getObject.bind(publicClient);
    const getListing = publicClient.getListing.bind(publicClient);
    publicClient.getListing = async (path, maxAge) =>
      path === "old/gigs/" && maxAge === undefined ? {} : getListing(path);
    publicClient.getObject = async (path, maxAge) =>
      path === "old/gigs/g" && maxAge === undefined
        ? undefined
        : getPublic(path);
    const remove = publicClient.remove.bind(publicClient);
    let fail = true;
    publicClient.remove = async (path) => {
      if (path === "old/gigs/g" && fail) {
        fail = false;
        throw new Error("interrupted");
      }
      return remove(path);
    };
    await expect(store.retryPublicDeletes()).rejects.toThrow("interrupted");
    expect(await store.pendingDeletes()).toHaveLength(1);
    await store.retryPublicDeletes();
    expect(await getPublic("old/gigs/g")).toBeFalsy();
    await store.retryPublicDeletes();
    expect(await store.pendingDeletes()).toHaveLength(0);
  } finally {
    storage.stopSync();
  }
});
