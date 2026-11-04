import { afterAll, afterEach, expect, test } from "bun:test";
import type { Message } from "@gigger/schemas";

// Threads is loaded outside Svelte's compiler, where $state has no meaning;
// stubbing it as identity lets the module run as plain JS for this test.
// Removed again after import so it doesn't leak into other test files.
const globals = globalThis as Record<string, unknown>;
globals.$state = (value: unknown) => value;
const { threads } = await import("./lib/messages.svelte");
const { bands } = await import("./storage");
afterAll(() => {
  delete globals.$state;
});

const party = { id: "p", name: "Someone" };
const message: Message = {
  id: "m1",
  channel: "email",
  direction: "in",
  conversation: "c1",
  bandId: "b",
  actor: party,
  target: party,
  object: { type: "Note", content: "Hi" },
  published: "2026-11-04T10:00:00Z",
};

const original = bands.messages;
afterEach(() => {
  bands.messages = original;
  threads.reset();
});

test("a read that resolves after reset is dropped, not written into the cache", async () => {
  let resolveRead: (messages: Message[]) => void = () => {};
  bands.messages = () =>
    new Promise((resolve) => {
      resolveRead = resolve;
    });
  const pending = threads.load("c1");
  threads.reset();
  resolveRead([message]);
  await pending;
  expect(threads.byId.c1).toBeUndefined();
});

test("a read that resolves before any reset is cached as usual", async () => {
  bands.messages = async () => [message];
  await threads.load("c1");
  expect(threads.byId.c1).toEqual([message]);
});
