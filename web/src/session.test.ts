import { expect, test } from "bun:test";
import { logout, storage } from "./storage";

test("logout clears the browser session before the background request completes", async () => {
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
    expect(logout()).toBeUndefined();
    expect(storage.remote.token).toBeFalsy();
    expect(storage.remote.userAddress).toBeFalsy();
    expect(path).toBe("/login");
    expect(request?.keepalive).toBe(true);
    expect(request?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer session-token",
    });
    expect(JSON.parse(String(request?.body))).toEqual({ username: "leader" });
    await disconnected;
    await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  } finally {
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
