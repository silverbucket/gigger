import { expect, test } from "bun:test";
import { openDatabase } from "../src/db";
import { cleanPage, publicHandler, renderIcs, renderPage } from "../src/public";
import { handler } from "../src/server";

const leaked = {
  fee: { amount: 5000, currency: "CZK", extras: ["Dinner"] },
  earnings: { takeHome: 4000 },
  contacts: ["Promoter +420123"],
  contactIds: ["contact-7f3a"],
  notes: "Use the side entrance",
  enquiryText: "Can you play?",
  survey: { rating: 4, stageNotes: "Low ceiling" },
  title: "Private title",
};
const privateText =
  /5000|Dinner|4000|Promoter|contact-7f3a|side entrance|Can you play|rating|Low ceiling|Private title|fee|earnings|contact|notes|survey/i;

test("public page, JSON, ICS and export carry only public fields and the claim is verified", async () => {
  const bandToken = "secret-token";
  const storage = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/public-gigs")
        return Response.json({
          gigs: {
            future: {
              date: "2999-06-20",
              start: "20:00",
              venue: "Café V lese",
              city: "Praha",
              ticketUrl: "https://tickets.example/x",
              description: "All ages, doors 19:00",
              ...leaked,
            },
            past: { date: "2001-05-03", venue: "Rock Café", ...leaked },
            bad: { date: "tomorrow", venue: "Nowhere" },
            evil: { date: "2999-01-01", venue: "X", ticketUrl: "javascript:1" },
          },
        });
      if (
        [
          "/storage/storage/sam/public/gigger/the-band/page",
          "/storage/storage/sam/public/gigger/renamed/page",
        ].includes(path)
      )
        return Response.json({
          name: "The Band <script>",
          locale: "cs-CZ",
          ...leaked,
          gigs: {
            future: {
              date: "2999-06-20",
              start: "20:00",
              venue: "Café V lese",
              city: "Praha",
              ticketUrl: "https://tickets.example/x",
              description: "All ages, doors 19:00",
              ...leaked,
            },
            past: { date: "2001-05-03", venue: "Rock Café", ...leaked },
            bad: { date: "tomorrow", venue: "Nowhere" },
            evil: { date: "2999-01-01", venue: "X", ticketUrl: "javascript:1" },
          },
        });
      if (path === "/storage/storage/sam/gigger/bands/band1/band")
        return req.headers.get("authorization") === `Bearer ${bandToken}`
          ? Response.json({ id: "band1", name: "The Band" })
          : new Response("", { status: 401 });
      return new Response("", { status: 404 });
    },
  });
  const db = openDatabase(":memory:");
  const request = handler(
    db,
    undefined,
    publicHandler(
      db,
      storage.url.origin,
      "http://localhost:8080",
      storage.url.origin,
    ),
  );
  const claim = (body: unknown, token = bandToken) =>
    request(
      new Request("http://localhost:8080/public/pages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }),
    );
  const get = (path: string) =>
    request(new Request(`http://localhost:8080${path}`));
  try {
    expect((await get("/b/the-band")).status).toBe(404);
    const good = { username: "sam", bandId: "band1", slug: "the-band" };
    expect((await claim(good, "wrong")).status).toBe(401);
    expect((await claim({ ...good, slug: "The Band" })).status).toBe(400);
    expect((await claim({ ...good, username: "../x" })).status).toBe(400);
    expect((await claim(good)).status).toBe(200);
    expect((await claim(good)).status).toBe(200);
    expect(
      (await claim({ ...good, username: "other", bandId: "band1" }, "x"))
        .status,
    ).toBe(401);
    db.query("INSERT INTO public_pages VALUES ('taken', 'other', 'b2')").run();
    expect((await claim({ ...good, slug: "taken" })).status).toBe(409);
    expect((await claim(good)).status).toBe(200);
    expect(
      db.query("SELECT slug FROM public_pages WHERE username = 'sam'").all(),
    ).toEqual([{ slug: "the-band" }]);

    const html = await (await get("/b/the-band")).text();
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<html lang="cs">');
    expect(html).toContain('lang="cs-CZ"');
    expect(html).toContain("Café V lese, Praha");
    expect(html).toMatch(
      /<span class="day">20\.<\/span><span class="month">čvn/,
    );
    expect(html).toContain("čtvrtek, 20:00");
    expect(html).toContain("20:00");
    expect(html).toContain('href="https://tickets.example/x"');
    expect(html).toContain("Rock Café");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Nowhere");
    expect(html.indexOf("Café V lese")).toBeLessThan(html.indexOf("Rock Café"));
    expect(html).toContain('href="/b/the-band/gigs.ics"');
    expect(html).not.toMatch(privateText);

    const json = await (await get("/b/the-band/gigs.json")).json();
    expect(json.gigs.map((gig: { id: string }) => gig.id)).toEqual([
      "past",
      "evil",
      "future",
    ]);
    expect(Object.keys(json.gigs[2]).sort()).toEqual([
      "city",
      "date",
      "description",
      "id",
      "start",
      "ticketUrl",
      "venue",
    ]);
    expect(JSON.stringify(json)).not.toMatch(privateText);

    const ics = await (await get("/b/the-band/gigs.ics")).text();
    expect(ics).toContain("DTSTART;TZID=Europe/Prague:29990620T200000\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20010503\r\n");
    expect(ics).toContain("LOCATION:Café V lese\\, Praha");
    expect(ics).toContain("DESCRIPTION:All ages\\, doors 19:00");
    const uid = ics.match(/UID:future@[^\r]+/)?.[0];
    if (!uid) throw new Error("Missing event UID");

    expect(ics).not.toMatch(privateText);

    const zipped = await get("/b/the-band/export.zip");
    expect(zipped.headers.get("content-type")).toBe("application/zip");
    const bytes = new Uint8Array(await zipped.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(bytes);
    for (const name of ["index.html", "gigs.json", "gigs.ics"])
      expect(text).toContain(name);
    expect(text).toContain('href="gigs.ics"');
    expect(text).toContain(uid);
    db.query(
      "UPDATE public_pages SET slug = 'renamed' WHERE slug = 'the-band'",
    ).run();
    expect(await (await get("/b/renamed/gigs.ics")).text()).toContain(uid);
    db.query(
      "UPDATE public_pages SET slug = 'the-band' WHERE slug = 'renamed'",
    ).run();
    expect(text).not.toMatch(privateText);

    expect((await get("/b/the-band/other.txt")).status).toBe(404);
    expect((await get("/b/../etc")).status).toBe(404);
  } finally {
    storage.stop(true);
    db.close();
  }
});

test("cleanPage drops anything that is not an allowed public field", () => {
  expect(
    cleanPage({ name: "B", gigs: { g: { date: "2030-01-01", fee: 1 } } }),
  ).toEqual({ name: "B", gigs: { g: { date: "2030-01-01", venue: "" } } });
  expect(cleanPage({ gigs: {} })).toBeNull();
  expect(
    cleanPage({
      name: "B",
      gigs: {
        invalid: { date: "2030-02-31" },
        valid: {
          date: "2032-02-29",
          ticketUrl: "https://example.com/\r\nBEGIN:VALARM",
        },
      },
    })?.gigs,
  ).toEqual({ valid: { date: "2032-02-29", venue: "" } });
  expect(
    cleanPage({ name: "B", locale: "nope_nope", gigs: {} })?.locale,
  ).toBeUndefined();
  expect(renderIcs({ name: "A;B", gigs: {} }, "s")).toContain(
    String.raw`X-WR-CALNAME:A\;B`,
  );
});

test("public page translates labels and shows years on upcoming cards when needed", () => {
  const gigs = {
    current: {
      date: "2030-06-01",
      venue: "Club",
      ticketUrl: "https://example.com",
    },
    next: { date: "2031-01-01", venue: "Hall" },
    past: { date: "2029-01-01", venue: "Old" },
  };
  const czech = renderPage(
    { name: "Kapela", locale: "cs-CZ", gigs },
    "",
    "2030-01-01",
  );
  for (const label of [
    "Nadcházející koncerty",
    "Minulé koncerty",
    "Vstupenky",
    "Přidat koncerty do kalendáře",
    "Data koncertů ve formátu JSON",
  ])
    expect(czech).toContain(label);
  expect(czech).toContain('<span class="year">2031</span>');
  expect(czech).not.toContain('<span class="year">2030</span>');
  const english = renderPage(
    { name: "Band", locale: "de-DE", gigs: {} },
    "",
    "2030-01-01",
  );
  expect(english).toContain('<html lang="en">');
  expect(english).toContain("Upcoming gigs");
  const germanDates = renderPage(
    { name: "Band", locale: "de-DE", gigs },
    "",
    "2030-01-01",
  );
  expect(germanDates).toContain('<html lang="en">');
  expect(germanDates).toContain('lang="de-DE"');
  expect(english).toContain("No gigs announced yet.");
});

test("calendar uses Prague timezone for timed events and dates for all-day events", () => {
  const ics = renderIcs(
    {
      name: "Band",
      gigs: {
        summer: { date: "2030-07-01", start: "20:00", venue: "Club" },
        winter: { date: "2030-01-01", start: "20:00", venue: "Club" },
        allDay: { date: "2030-01-02", venue: "Club" },
      },
    },
    "band",
  );
  expect(ics).toContain("TZID:Europe/Prague\r\n");
  expect(ics).toContain("DTSTART;TZID=Europe/Prague:20300701T200000\r\n");
  expect(ics).toContain("DTSTART;TZID=Europe/Prague:20300101T200000\r\n");
  expect(ics).toContain("DTSTART;VALUE=DATE:20300102\r\n");
  expect(ics).toContain("TZOFFSETTO:+0200\r\n");
  expect(ics).toContain("TZOFFSETTO:+0100\r\n");
});
