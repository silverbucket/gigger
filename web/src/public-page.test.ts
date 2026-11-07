import { expect, test } from "bun:test";
import { isPublicPageLive, waitForLivePage } from "./lib/public-page";

test("isPublicPageLive checks gigs.json on the public route", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/b/band-a/gigs.json")) {
      return new Response("{}", { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  try {
    expect(await isPublicPageLive("band-a")).toBeTrue();
    expect(await isPublicPageLive("missing")).toBeFalse();
  } finally {
    globalThis.fetch = original;
  }
});

test("waitForLivePage fails when the route never becomes available", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("", { status: 404 })) as unknown as typeof fetch;
  try {
    await expect(waitForLivePage("x", 50)).rejects.toThrow(/not live yet/i);
  } finally {
    globalThis.fetch = original;
  }
});
