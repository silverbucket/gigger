import { expect, test } from "bun:test";
import { libreTranslate, translateHandler } from "../src/translate";

test("libreTranslate returns translated text from a compatible server", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json();
      expect(body).toMatchObject({
        q: "Ahoj",
        source: "cs",
        target: "en",
        format: "text",
      });
      return Response.json({ translatedText: "Hello" });
    },
  });
  try {
    expect(
      await libreTranslate("Ahoj", "cs", "en", server.url.origin, "secret"),
    ).toBe("Hello");
  } finally {
    server.stop(true);
  }
});

test("translate route returns 503 when LibreTranslate is not configured", async () => {
  const handle = translateHandler(
    "http://armadietto:8000",
    "http://localhost:8080",
    {},
  );
  const response = await handle(
    new Request("http://localhost/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body: JSON.stringify({
        username: "alice",
        body: "Ahoj",
        target: "en",
      }),
    }),
  );
  expect(response.status).toBe(503);
  expect((await response.json()).error).toBe(
    "Translation is not available right now.",
  );
});

test("translate route returns 503 when LIBRETRANSLATE_URL is empty", async () => {
  const handle = translateHandler(
    "http://armadietto:8000",
    "http://localhost:8080",
    { LIBRETRANSLATE_URL: "   " },
  );
  const response = await handle(
    new Request("http://localhost/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body: JSON.stringify({
        username: "alice",
        body: "Ahoj",
        target: "en",
      }),
    }),
  );
  expect(response.status).toBe(503);
  expect((await response.json()).error).toBe(
    "Translation is not available right now.",
  );
});

test("translate route validates input and proxies both subject and body", async () => {
  let calls = 0;
  const lt = Bun.serve({
    port: 0,
    async fetch() {
      calls++;
      return Response.json({
        translatedText: calls === 1 ? "English subject" : "English body",
      });
    },
  });
  const armadietto = Bun.serve({
    port: 0,
    fetch: () => new Response("{}", { status: 200 }),
  });
  const handle = translateHandler(
    armadietto.url.origin,
    "http://localhost:8080",
    { LIBRETRANSLATE_URL: lt.url.origin },
  );
  try {
    const bad = await handle(
      new Request("http://localhost/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "bad", body: "Hi", target: "en" }),
      }),
    );
    expect(bad.status).toBe(400);
    const armadiettoDenied = Bun.serve({
      port: 0,
      fetch: () => new Response("no", { status: 403 }),
    });
    const deniedHandle = translateHandler(
      armadiettoDenied.url.origin,
      "http://localhost:8080",
      { LIBRETRANSLATE_URL: lt.url.origin },
    );
    const forbidden = await deniedHandle(
      new Request("http://localhost/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
          Origin: "http://localhost:8080",
        },
        body: JSON.stringify({
          username: "alice",
          body: "Dobrý den",
          target: "en",
        }),
      }),
    );
    expect(forbidden.status).toBe(403);
    armadiettoDenied.stop(true);
    const ok = await handle(
      new Request("http://localhost/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
          Origin: "http://localhost:8080",
        },
        body: JSON.stringify({
          username: "alice",
          body: "Dobrý den",
          target: "en",
          subject: "Koncert",
        }),
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      subject: "English body",
      body: "English subject",
    });
    expect(calls).toBe(2);
  } finally {
    lt.stop(true);
    armadietto.stop(true);
  }
});
