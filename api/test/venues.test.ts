import { afterAll, expect, test } from "bun:test";
import { openDatabase } from "../src/db";
import { handler } from "../src/server";
import { venueHandler } from "../src/venues";

const tokens: Record<string, string> = {
  alice: "alice-token",
  bob: "bob-token",
};
let reads = 0;
const storage = Bun.serve({
  port: 0,
  fetch(req) {
    reads++;
    const match =
      /^\/storage\/storage\/([^/]+)\/showday\/bands\/([^/]+)\/band$/.exec(
        new URL(req.url).pathname,
      );
    const user = match && decodeURIComponent(match[1]);
    if (!user || req.headers.get("authorization") !== `Bearer ${tokens[user]}`)
      return new Response("", { status: 401 });
    return Response.json({ id: match[2], name: "Band" });
  },
});
afterAll(() => storage.stop(true));
const db = openDatabase(":memory:");
const api = handler(
  db,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  venueHandler(db, `http://127.0.0.1:${storage.port}`, "http://localhost"),
);
const add = (user: string, body: object, token = tokens[user]) =>
  api(
    new Request("http://localhost/venues", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: user, bandId: "b1", ...body }),
    }),
  );
const find = async (user: string, q: string, token = tokens[user]) => {
  const response = await api(
    new Request(
      `http://localhost/venues?${new URLSearchParams({ username: user, bandId: "b1", q })}`,
      { headers: { Authorization: `Bearer ${token}` } },
    ),
  );
  return { status: response.status, body: await response.json() };
};

test("a venue one account adds is found by another, with only the public basics", async () => {
  const added = await add("alice", {
    sourceId: "v1",
    name: "Café V lese",
    address: "Krymská 2, Praha",
    city: "Praha",
    country: "CZ",
    website: "https://cafevlese.cz",
    email: "booking@cafevlese.cz",
    phone: "+420 123",
  });
  expect(added.status).toBe(200);
  const { id } = await added.json();
  const { status, body } = await find("bob", "cafe v");
  expect(status).toBe(200);
  expect(body).toEqual([
    {
      id,
      name: "Café V lese",
      address: "Krymská 2, Praha",
      city: "Praha",
      country: "CZ",
      website: "https://cafevlese.cz",
    },
  ]);
  // City and address match too; one letter is not a search.
  expect((await find("bob", "krymska")).body).toHaveLength(1);
  expect((await find("bob", "c")).body).toEqual([]);
});

test("the same venue from two accounts is listed once, and only its contributor's edits change it", async () => {
  const first = await (
    await add("alice", {
      sourceId: "v2",
      name: "Rock Café",
      address: "Národní 20",
    })
  ).json();
  const again = await (
    await add("bob", {
      sourceId: "x9",
      name: "ROCK  café",
      address: "národní 20",
    })
  ).json();
  expect(again.id).toBe(first.id);
  // Bob's own copy, renamed, adds his version instead of changing Alice's.
  await add("bob", {
    sourceId: "x9",
    name: "Rock Cafe Club",
    address: "Národní 20",
  });
  expect(
    (await find("alice", "rock")).body
      .map((v: { name: string }) => v.name)
      .sort(),
  ).toEqual(["Rock Cafe Club", "Rock Café"]);
  // Alice adding a city, country and website to the same name and address updates her entry.
  await add("alice", {
    sourceId: "v2",
    name: "Rock Café",
    address: "Národní 20",
    city: "Praha",
    country: "CZ",
    website: "https://rockcafe.cz",
  });
  expect(
    (await find("bob", "rock")).body.find(
      (v: { id: string }) => v.id === first.id,
    ),
  ).toMatchObject({
    city: "Praha",
    country: "CZ",
    website: "https://rockcafe.cz",
  });
  // Alice fixing her venue's address updates her entry.
  await add("alice", {
    sourceId: "v2",
    name: "Rock Café",
    address: "Národní 20, Praha 1",
  });
  const listed = (await find("bob", "rock")).body.map(
    (v: { name: string; address: string }) => `${v.name} / ${v.address}`,
  );
  expect(listed.sort()).toEqual([
    "Rock Cafe Club / Národní 20",
    "Rock Café / Národní 20, Praha 1",
  ]);
});

test("searching and adding need a token that can read the band", async () => {
  expect((await find("bob", "rock", "wrong")).status).toBe(403);
  expect(
    (await add("bob", { sourceId: "v3", name: "X", address: "Y" }, "wrong"))
      .status,
  ).toBe(403);
  expect((await add("bob", { sourceId: "v3", name: "X" })).status).toBe(400);
  expect(
    (await add("bob", { sourceId: "../x", name: "X", address: "Y" })).status,
  ).toBe(400);
  // A javascript: website is dropped, the venue still shared.
  await add("bob", {
    sourceId: "v4",
    name: "Lucerna",
    address: "Vodičkova 36",
    website: "javascript:alert(1)",
    country: "Bohemia",
  });
  const [lucerna] = (await find("bob", "lucerna")).body;
  expect(lucerna.website).toBeUndefined();
  expect(lucerna.country).toBeUndefined();
  // Punctuation alone, LIKE wildcards included, is not a search.
  expect((await find("bob", "%%")).body).toEqual([]);
});

test("a verified token is not checked against storage on every keystroke", async () => {
  await find("alice", "ro");
  const before = reads;
  await find("alice", "roc");
  await find("alice", "rock");
  expect(reads).toBe(before);
});
