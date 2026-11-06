import { expect, spyOn, test } from "bun:test";
import { createLogoutSync } from "./logout-sync";
import {
  connectSession,
  ensureSessionReady,
  logout,
  onSessionLogout,
  storage,
} from "./storage";

test("a missing local session token never starts OAuth", () => {
  const connect = spyOn(storage, "connect");
  try {
    expect(() => connectSession("nick", undefined)).toThrow(
      "Could not open your account. Please log in again.",
    );
    expect(connect).not.toHaveBeenCalled();
  } finally {
    connect.mockRestore();
  }
});

test("logout clears the UI while cache cleanup and server revocation are pending", async () => {
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  storage.stopSync();
  const originalFetch = globalThis.fetch;
  const originalLocation = Object.getOwnPropertyDescriptor(
    globalThis,
    "location",
  );
  const originalHistory = Object.getOwnPropertyDescriptor(
    globalThis,
    "history",
  );
  let path = "";
  let request: RequestInit | undefined;
  let finishRequest: (response: Response) => void = () => {};
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { host: "localhost:8080" },
  });
  Object.defineProperty(globalThis, "history", {
    configurable: true,
    value: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        path = url;
      },
    },
  });
  globalThis.fetch = ((_url: unknown, options: RequestInit) => {
    request = options;
    return new Promise<Response>((resolve) => {
      finishRequest = resolve;
    });
  }) as typeof fetch;
  let notified = false;
  const unsubscribe = onSessionLogout(() => {
    notified = true;
  });
  const disconnect = spyOn(storage, "disconnect").mockImplementation(() => {
    storage.remote.configure({
      userAddress: null,
      href: null,
      token: null,
      storageApi: null,
    });
    // Simulate blocked IndexedDB deletion: no disconnected/ready events yet.
  });
  try {
    storage.remote.configure({
      userAddress: "leader@localhost:8080",
      href: "http://localhost:8080/storage/storage/leader",
      token: "session-token",
      storageApi: "draft-dejong-remotestorage-10",
    });
    const disconnected = new Promise<void>((resolve) => {
      const done = () => {
        storage.removeEventListener("disconnected", done);
        resolve();
      };
      storage.on("disconnected", done);
    });
    expect(ensureSessionReady()).toBeUndefined();
    expect(logout()).toBeUndefined();
    expect(notified).toBe(true);
    expect(ensureSessionReady).toThrow(
      "Local storage is still opening or clearing",
    );

    expect(storage.remote.token).toBeFalsy();
    expect(storage.remote.userAddress).toBeFalsy();
    expect(path).toBe("/login");
    expect(request?.keepalive).toBe(true);
    expect(request?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer session-token",
    });
    expect(JSON.parse(String(request?.body))).toEqual({ username: "leader" });
    disconnect.mockRestore();
    storage.disconnect();
    await disconnected;
    await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
    expect(ensureSessionReady()).toBeUndefined();
  } finally {
    disconnect.mockRestore();
    unsubscribe();
    storage.stopSync();
    finishRequest(new Response(null, { status: 200 }));
    globalThis.fetch = originalFetch;
    if (originalLocation)
      Object.defineProperty(globalThis, "location", originalLocation);
    else Reflect.deleteProperty(globalThis, "location");
    if (originalHistory)
      Object.defineProperty(globalThis, "history", originalHistory);
    else Reflect.deleteProperty(globalThis, "history");
  }
});

test("logout messages reach other tabs without echoing or reacting to unrelated messages", async () => {
  const name = `showday-session-test-${crypto.randomUUID()}`;
  const firstChannel = new BroadcastChannel(name);
  const secondChannel = new BroadcastChannel(name);
  let firstCount = 0;
  let secondCount = 0;
  let firstReceived: () => void = () => {};
  let secondReceived: () => void = () => {};
  const receivedByFirst = new Promise<void>((resolve) => {
    firstReceived = resolve;
  });
  const receivedBySecond = new Promise<void>((resolve) => {
    secondReceived = resolve;
  });
  const first = createLogoutSync(() => {
    firstCount++;
    firstReceived();
  }, firstChannel);
  const second = createLogoutSync(() => {
    secondCount++;
    secondReceived();
  }, secondChannel);
  try {
    firstChannel.postMessage("unrelated");
    first.broadcast();
    await receivedBySecond;
    expect(firstCount).toBe(0);
    expect(secondCount).toBe(1);
    second.broadcast();
    await receivedByFirst;
    expect(firstCount).toBe(1);
    expect(secondCount).toBe(1);
  } finally {
    first.close();
    second.close();
  }
});
