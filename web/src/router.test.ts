import { afterAll, expect, test } from "bun:test";

// Router reads outside Svelte's compiler, where $state has no meaning, and
// needs a minimal window/location to construct; stub both to load it as
// plain JS without a build step. Other test files construct a real
// RemoteStorage client that switches on `window`/`document`, so these must
// not leak past this file.
const globals = globalThis as Record<string, unknown>;
globals.$state = (value: unknown) => value;
globals.window = { addEventListener: () => {} };
globals.location = { hash: "" };
const { router } = await import("./lib/router.svelte");
afterAll(() => {
  delete globals.$state;
  delete globals.window;
  delete globals.location;
});

test("read() resyncs from the hash, which a session change relies on after replaceState", () => {
  (globalThis as unknown as { location: { hash: string } }).location.hash =
    "#/bookings/gig/b1/g1/edit";
  router.read();
  expect(router.screen).toBe("bookings");
  expect(router.parts).toEqual(["gig", "b1", "g1", "edit"]);

  // replaceState (used by logout and sign-in) fires no hashchange, so the
  // router only reflects a hash clear once read() is called again.
  (globalThis as unknown as { location: { hash: string } }).location.hash = "";
  router.read();
  expect(router.screen).toBe("bookings");
  expect(router.parts).toEqual([]);
});
