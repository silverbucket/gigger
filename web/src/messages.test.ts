import { afterAll, afterEach, expect, test } from "bun:test";
import type { Attachment, Message } from "@gigger/schemas";

// Threads is loaded outside Svelte's compiler, where $state has no meaning;
// stubbing it as identity lets the module run as plain JS for this test.
// Removed again after import so it doesn't leak into other test files.
const globals = globalThis as Record<string, unknown>;
globals.$state = (value: unknown) => value;
const { threads } = await import("./lib/messages.svelte");
const { bands, storage } = await import("./storage");
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

const originalMessages = bands.messages;
const originalScope = storage.scope;
afterEach(() => {
  bands.messages = originalMessages;
  storage.scope = originalScope;
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

test("an attachment read that resolves after reset refetches instead of caching the previous account's file", async () => {
  const attachment: Attachment = {
    url: "showday/a.txt",
    type: "application/octet-stream",
  };
  let calls = 0;
  storage.scope = (() => ({
    getFile: async () => {
      calls++;
      // A logout lands while the first read for this path is in flight.
      if (calls === 1) threads.reset();
      return { data: new Uint8Array([calls]), mimeType: "text/plain" };
    },
  })) as unknown as typeof storage.scope;
  const url = await threads.fileUrl(attachment);
  expect(calls).toBe(2);
  expect(threads.files[attachment.url]).toBe(url);
});
