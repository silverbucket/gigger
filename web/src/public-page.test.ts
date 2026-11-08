import { expect, test } from "bun:test";
import {
  isPublicPageLive,
  publicPageActionRows,
  publicPageControls,
  publicPageCouldNotPublish,
  publishUntilLive,
  trackPublicPageLive,
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

function apiError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

test("publishUntilLive retries a transient write failure until the page is live", async () => {
  let writes = 0;
  const restore = mockFetch((path) => {
    if (writes < 2) return new Response("", { status: 404 });
    if (path.endsWith("/gigs.json")) return new Response("{}", { status: 200 });
    return new Response("<html>", { status: 200 });
  });
  try {
    await publishUntilLive(
      "flaky",
      async () => {
        writes += 1;
        if (writes === 1)
          throw apiError(
            "Could not verify access to this band. Please retry.",
            403,
          );
      },
      { timeoutMs: 10_000 },
    );
    expect(writes).toBe(2);
  } finally {
    restore();
  }
});

test("publishUntilLive gives up after repeated write failures with only the plain message", async () => {
  const restore = mockFetch(() => new Response("", { status: 404 }));
  let writes = 0;
  try {
    await expect(
      publishUntilLive(
        "x",
        async () => {
          writes += 1;
          throw apiError(
            "Could not verify access to this band. Please retry.",
            403,
          );
        },
        { timeoutMs: 10_000, writeAttempts: 3 },
      ),
    ).rejects.toThrow(publicPageCouldNotPublish);
    expect(writes).toBe(3);
  } finally {
    restore();
  }
});

test("publishUntilLive shows an address problem at once", async () => {
  const restore = mockFetch(() => new Response("", { status: 404 }));
  let writes = 0;
  try {
    await expect(
      publishUntilLive(
        "taken",
        async () => {
          writes += 1;
          throw apiError("This address is already taken. Try another.", 409);
        },
        { timeoutMs: 10_000 },
      ),
    ).rejects.toThrow("This address is already taken. Try another.");
    expect(writes).toBe(1);
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

const idle = { unsaved: false, action: "idle" as const, listed: 2 };

test("a page that is not live shows only Publish", () => {
  const controls = publicPageControls({ ...idle, live: false });
  expect(controls.status).toBe("Not published");
  expect(controls.primary).toBe("Publish");
  expect(controls.listedTag).toBeFalse();
  expect(controls.unpublish).toBeFalse();
  expect(controls.openAndExport).toBeFalse();
  expect(controls.cancel).toBeFalse();
});

test("a live page shows Save, Unpublish, Open page and Export", () => {
  const controls = publicPageControls({ ...idle, live: true });
  expect(controls.status).toBe("Published");
  expect(controls.primary).toBe("Save");
  expect(controls.listedTag).toBeTrue();
  expect(controls.unpublish).toBeTrue();
  expect(controls.openAndExport).toBeTrue();
  expect(
    publicPageControls({ ...idle, live: true, listed: 0 }).listedTag,
  ).toBeFalse();
});

test("Save starts the same live write as Publish, with its own busy label", () => {
  const publish = publicPageControls({ ...idle, live: false });
  const save = publicPageControls({ ...idle, live: true });
  expect(publish.primaryAction).toBe("publishing");
  expect(save.primaryAction).toBe("saving");
  expect(
    publicPageControls({ ...idle, live: false, action: "publishing" }),
  ).toMatchObject({ primary: "Publishing…", busy: true });
  expect(
    publicPageControls({ ...idle, live: true, action: "saving" }),
  ).toMatchObject({ primary: "Saving…", busy: true });
});

test("Cancel shows only with unsaved edits", () => {
  expect(publicPageControls({ ...idle, live: true }).cancel).toBeFalse();
  expect(
    publicPageControls({ ...idle, live: true, unsaved: true }).cancel,
  ).toBeTrue();
  expect(
    publicPageControls({ ...idle, live: false, unsaved: true }).cancel,
  ).toBeTrue();
});

test("Unpublish sits on the secondary row with Open page and Export, not with Publish or Save", () => {
  expect(publicPageActionRows({ ...idle, live: false })).toEqual({
    primaryRow: ["Publish"],
    secondaryRow: [],
    unpublishTrailing: false,
  });
  const live = publicPageActionRows({ ...idle, live: true });
  expect(live.primaryRow).toEqual(["Save"]);
  expect(live.secondaryRow).toEqual([
    "Open page",
    "Export static page (.zip)",
    "Unpublish",
  ]);
  expect(live.unpublishTrailing).toBeTrue();
  const draft = publicPageActionRows({ ...idle, live: true, unsaved: true });
  expect(draft.primaryRow).toEqual(["Save", "Cancel"]);
  expect(draft.secondaryRow.at(-1)).toBe("Unpublish");
});

function deferred() {
  let resolve!: (live: boolean) => void;
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("a stored slug whose public URL still 404s is not live", async () => {
  const seen = { live: "unset" as string | null };
  const tracker = trackPublicPageLive(
    (slug) => {
      seen.live = slug;
    },
    async () => false,
  );
  await tracker.probe("stored");
  expect(seen.live).toBeNull();
});

test("a finished publish stays live when an older check reports 404 later", async () => {
  const seen = { live: null as string | null };
  const pending = deferred();
  let checks = 0;
  const tracker = trackPublicPageLive(
    (slug) => {
      seen.live = slug;
    },
    () => {
      checks += 1;
      return pending.promise;
    },
  );
  const stale = tracker.probe("band");
  tracker.confirmed("band");
  pending.resolve(false);
  await stale;
  expect(seen.live).toBe("band");
  // The band reloads after publishing; that must not recheck and reset it.
  await tracker.probe("band");
  expect(seen.live).toBe("band");
  expect(checks).toBe(1);
});

test("unpublish returns the page to not live, and a later check can see it again", async () => {
  const seen = { live: null as string | null };
  let serving = true;
  const tracker = trackPublicPageLive(
    (slug) => {
      seen.live = slug;
    },
    async () => serving,
  );
  tracker.confirmed("band");
  serving = false;
  tracker.takenDown();
  expect(seen.live).toBeNull();
  await tracker.probe("band");
  expect(seen.live).toBeNull();
  serving = true;
  await tracker.probe("band");
  expect(seen.live).toBe("band");
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a later recheck sees the page live after a first 404, without a slug change", async () => {
  const seen = { live: null as string | null };
  const answers = [false, false, true];
  let checks = 0;
  const tracker = trackPublicPageLive(
    (slug) => {
      seen.live = slug;
    },
    async () => answers[Math.min(checks++, answers.length - 1)],
  );
  const stop = tracker.watch("band", [5]);
  try {
    for (let i = 0; i < 50 && seen.live !== "band"; i++) await wait(5);
    expect(seen.live).toBe("band");
    const settled = checks;
    await wait(30);
    expect(checks).toBe(settled);
  } finally {
    stop();
  }
});

test("a later recheck sees the page live after the first check fails", async () => {
  const seen = { live: null as string | null };
  let checks = 0;
  const tracker = trackPublicPageLive(
    (slug) => {
      seen.live = slug;
    },
    async () => {
      checks += 1;
      if (checks === 1) throw new Error("offline");
      return true;
    },
  );
  const stop = tracker.watch("band", [5]);
  try {
    for (let i = 0; i < 50 && seen.live !== "band"; i++) await wait(5);
    expect(seen.live).toBe("band");
    expect(checks).toBe(2);
  } finally {
    stop();
  }
});

test("a watch stops rechecking once stopped", async () => {
  let checks = 0;
  const tracker = trackPublicPageLive(
    () => {},
    async () => {
      checks += 1;
      return false;
    },
  );
  const stop = tracker.watch("band", [5]);
  await wait(20);
  stop();
  const stoppedAt = checks;
  await wait(30);
  expect(checks).toBe(stoppedAt);
});

test("a stale 404 from a watch cannot undo a finished publish", async () => {
  const seen = { live: null as string | null };
  const pending = deferred();
  let checks = 0;
  const tracker = trackPublicPageLive(
    (slug) => {
      seen.live = slug;
    },
    () => {
      checks += 1;
      return pending.promise;
    },
  );
  const stop = tracker.watch("band", [5]);
  try {
    tracker.confirmed("band");
    pending.resolve(false);
    await wait(30);
    expect(seen.live).toBe("band");
    expect(checks).toBe(1);
  } finally {
    stop();
  }
});
