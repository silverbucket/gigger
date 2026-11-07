import { expect, test } from "bun:test";
import {
  isPublicPageLive,
  publicPageCouldNotPublish,
  publishUntilLive,
} from "./lib/public-page";

function mockFetch(handler: (path: string) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    handler(String(input))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("isPublicPageLive requires both the page and gigs.json", async () => {
  const restore = mockFetch((path) => {
    if (path.endsWith("/b/band-a/gigs.json")) {
      return new Response("{}", { status: 200 });
    }
    if (path.endsWith("/b/band-a")) {
      return new Response("<html>", { status: 200 });
    }
    return new Response("", { status: 404 });
  });
  try {
    expect(await isPublicPageLive("band-a")).toBeTrue();
    expect(await isPublicPageLive("band-b")).toBeFalse();
  } finally {
    restore();
  }
});

test("isPublicPageLive is false when only gigs.json responds", async () => {
  const restore = mockFetch((path) => {
    if (path.endsWith("/gigs.json")) return new Response("{}", { status: 200 });
    return new Response("", { status: 404 });
  });
  try {
    expect(await isPublicPageLive("half")).toBeFalse();
  } finally {
    restore();
  }
});

test("publishUntilLive retries the write until both public routes work", async () => {
  let writes = 0;
  const restore = mockFetch((path) => {
    if (!path.includes("/b/retry")) return new Response("", { status: 404 });
    if (writes < 2) return new Response("", { status: 404 });
    if (path.endsWith("/gigs.json")) return new Response("{}", { status: 200 });
    return new Response("<html>", { status: 200 });
  });
  try {
    await publishUntilLive(
      "retry",
      async () => {
        writes += 1;
      },
      { timeoutMs: 5000 },
    );
    expect(writes).toBeGreaterThanOrEqual(2);
  } finally {
    restore();
  }
});

test("publishUntilLive stops immediately when the write step throws", async () => {
  const restore = mockFetch(() => new Response("", { status: 404 }));
  const started = Date.now();
  try {
    await expect(
      publishUntilLive(
        "x",
        async () => {
          throw new Error(publicPageCouldNotPublish);
        },
        { timeoutMs: 10_000 },
      ),
    ).rejects.toThrow(publicPageCouldNotPublish);
    expect(Date.now() - started).toBeLessThan(500);
  } finally {
    restore();
  }
});

test("publishUntilLive fails with a plain message when the page never goes live", async () => {
  const restore = mockFetch(() => new Response("", { status: 404 }));
  try {
    await expect(
      publishUntilLive("x", async () => {}, { timeoutMs: 80 }),
    ).rejects.toThrow(publicPageCouldNotPublish);
  } finally {
    restore();
  }
});
