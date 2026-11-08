import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  clearInboxLangSession,
  inboxLangSessionKey,
  readInboxLangSession,
  writeInboxLangSession,
} from "./message-translate-ui-session";

function mockSessionStorage() {
  const items = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem(key: string, value: string) {
        items.set(key, value);
      },
      removeItem(key: string) {
        items.delete(key);
      },
      clear() {
        items.clear();
      },
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "sessionStorage", original);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  };
}

let restoreSessionStorage: (() => void) | undefined;

beforeEach(() => {
  restoreSessionStorage = mockSessionStorage();
});

afterEach(() => {
  sessionStorage.clear();
  restoreSessionStorage?.();
});

test("inbox language session is per conversation and cleared on a fresh open", () => {
  writeInboxLangSession("conv-a", {
    messageId: "m1",
    chosen: "en",
    segmented: true,
    view: "en",
  });
  expect(readInboxLangSession("conv-a")?.view).toBe("en");
  expect(readInboxLangSession("conv-b")).toBeUndefined();
  clearInboxLangSession("conv-a");
  expect(sessionStorage.getItem(inboxLangSessionKey("conv-a"))).toBeNull();
});
