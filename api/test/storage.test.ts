import { expect, test } from "bun:test";
import { DEFAULT_APP_ORIGIN } from "../src/app-origin";
import { armadiettoStorageHeaders, remoteStore } from "../src/storage";

test("armadietto storage requests send X-Forwarded-Proto when APP_ORIGIN is https", async () => {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      seen.push(req.headers.get("x-forwarded-proto") ?? "");
      if (req.headers.get("x-forwarded-proto") !== "https")
        return new Response("", { status: 403 });
      return Response.json({ id: "band1", name: "The Band" });
    },
  });
  const store = remoteStore(
    server.url.origin,
    "sam",
    "user-token",
    "https://showday.example",
  );
  try {
    const band = await store.get<{ id: string }>("bands/band1/band");
    expect(band.value?.id).toBe("band1");
    expect(seen).toEqual(["https"]);
    expect(armadiettoStorageHeaders("t", DEFAULT_APP_ORIGIN)).toEqual({
      Authorization: "Bearer t",
    });
    expect(armadiettoStorageHeaders("t", "https://showday.example")).toEqual({
      Authorization: "Bearer t",
      "X-Forwarded-Proto": "https",
    });
  } finally {
    server.stop(true);
  }
});

test("messages ticket verification can read the band through a forced-https armadietto", async () => {
  const calls: { proto: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      calls.push({ proto: req.headers.get("x-forwarded-proto") });
      if (req.headers.get("x-forwarded-proto") !== "https")
        return new Response("", { status: 403 });
      const path = new URL(req.url).pathname;
      if (path.endsWith("/bands/band1/band"))
        return Response.json({ id: "band1", name: "The Band" });
      return new Response("", { status: 404 });
    },
  });
  const { messageHandler } = await import("../src/messages");
  const { openDatabase } = await import("../src/db");
  const db = openDatabase(":memory:");
  const senders = {
    email: { send: async () => {} },
    messenger: { send: async () => {} },
    instagram: { send: async () => {} },
  };
  const messages = messageHandler(
    db,
    senders,
    server.url.origin,
    "https://app.test",
    { APP_ORIGIN: "https://app.test" } as NodeJS.ProcessEnv,
  );
  try {
    const response = await messages.ticket(
      new Request("http://app.test/messages/ticket", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer user-token",
          Origin: "https://app.test",
        },
        body: JSON.stringify({ username: "sam", bandId: "band1" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(calls.every((call) => call.proto === "https")).toBe(true);
  } finally {
    server.stop(true);
    db.close();
  }
});
