import {
  afterAll,
  expect,
  type Mock,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import RemoteStorage from "remotestoragejs";
import { createLogoutSync } from "./logout-sync";
import {
  connectSession,
  logout,
  onSessionLogout,
  slowStartMessage,
  startSession,
  storage,
  syncTroubleAfter,
  whenSessionReady,
} from "./storage";

// ui.svelte runs outside Svelte's compiler here, where runes have no meaning;
// identity stubs let it load as plain JS. Removed again after this file.
const globals = globalThis as Record<string, unknown>;
globals.$state = (value: unknown) => value;
globals.$derived = (value: unknown) => value;
const { loginAgainMessage, syncTroubleMessage, ui, watchSession } =
  await import("./lib/ui.svelte");
afterAll(() => {
  delete globals.$state;
  delete globals.$derived;
});

/**
 * Stands in for the page on localhost:8080. `respond` answers account API
 * calls; storage requests stay pending so sync never gets in the way.
 */
function browser(
  respond: (url: string, init: RequestInit) => Promise<Response> = () =>
    new Promise<Response>(() => {}),
) {
  const original = {
    fetch: globalThis.fetch,
    location: Object.getOwnPropertyDescriptor(globalThis, "location"),
    history: Object.getOwnPropertyDescriptor(globalThis, "history"),
  };
  const page = {
    path: "",
    requests: [] as { url: string; init: RequestInit }[],
    restore() {
      globalThis.fetch = original.fetch;
      for (const key of ["location", "history"] as const) {
        const descriptor = original[key];
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { host: "localhost:8080" },
  });
  Object.defineProperty(globalThis, "history", {
    configurable: true,
    value: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        page.path = url;
      },
    },
  });
  globalThis.fetch = ((url: unknown, init: RequestInit = {}) => {
    const path = String(url);
    if (!path.startsWith("/api/")) return new Promise<Response>(() => {});
    page.requests.push({ url: path, init });
    return respond(path, init);
  }) as typeof fetch;
  return page;
}

function signIn(username = "leader", token = "session-token") {
  storage.remote.configure({
    userAddress: `${username}@localhost:8080`,
    href: `http://localhost:8080/storage/storage/${username}`,
    token,
    storageApi: "draft-dejong-remotestorage-10",
  });
  storage.stopSync();
}
function signOutQuietly() {
  storage.remote.configure({
    userAddress: null,
    href: null,
    token: null,
    storageApi: null,
  });
}

/** Logout's cache cleanup stalls, as when another tab holds the database open. */
function stallCleanup() {
  return spyOn(storage, "disconnect").mockImplementation(signOutQuietly);
}
async function finishCleanup(stalled: Mock<typeof storage.disconnect>) {
  stalled.mockRestore();
  storage.disconnect();
  await whenSessionReady();
}

async function settles(promise: Promise<unknown>) {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  return settled;
}

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
  await whenSessionReady();
  let finishRequest: (response: Response) => void = () => {};
  const page = browser(
    () =>
      new Promise<Response>((resolve) => {
        finishRequest = resolve;
      }),
  );
  const ended: boolean[] = [];
  const unsubscribe = onSessionLogout((expired) => ended.push(expired));
  const stalled = stallCleanup();
  try {
    signIn();
    expect(logout()).toBeUndefined();
    expect(ended).toEqual([false]);
    expect(storage.remote.token).toBeFalsy();
    expect(storage.remote.userAddress).toBeFalsy();
    expect(page.path).toBe("/login");
    const [revoke] = page.requests;
    expect(revoke?.url).toBe("/api/auth/logout");
    expect(revoke?.init.keepalive).toBe(true);
    expect(revoke?.init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer session-token",
    });
    expect(JSON.parse(String(revoke?.init.body))).toEqual({
      username: "leader",
    });

    // Opening the next session waits for the cleanup instead of failing.
    const ready = whenSessionReady();
    expect(await settles(ready)).toBe(false);
    await finishCleanup(stalled);
    expect(await ready).toBeUndefined();
  } finally {
    stalled.mockRestore();
    unsubscribe();
    finishRequest(new Response(null, { status: 200 }));
    page.restore();
  }
});

test("logging in or signing up right after a logout waits for the cache to clear", async () => {
  await whenSessionReady();
  const page = browser(async (url, init) => {
    if (url === "/api/auth/logout") return new Response(null);
    const { username } = JSON.parse(String(init.body));
    return Response.json({ username, token: `token-for-${username}` });
  });
  const connect = spyOn(storage, "connect").mockImplementation(
    (address, token) => {
      signIn(address.slice(0, address.indexOf("@")), token);
    },
  );
  try {
    for (const [mode, username] of [
      ["login", "returning"],
      ["signup", "newcomer"],
    ] as const) {
      signIn();
      const stalled = stallCleanup();
      logout();
      page.requests.length = 0;
      const opening = startSession(mode, {
        username,
        password: "secret",
        ...(mode === "signup" ? { bandName: "Band", currency: "CZK" } : {}),
      });
      expect(await settles(opening)).toBe(false);
      expect(page.requests).toEqual([]);
      expect(connect).not.toHaveBeenCalled();

      await finishCleanup(stalled);
      await opening;
      expect(page.requests.map((request) => request.url)).toEqual([
        `/api/auth/${mode}`,
      ]);
      expect(connect).toHaveBeenCalledWith(
        `${username}@localhost:8080`,
        `token-for-${username}`,
      );
      expect(storage.remote.token).toBe(`token-for-${username}`);
      connect.mockClear();
    }
  } finally {
    connect.mockRestore();
    const stalled = stallCleanup();
    logout();
    await finishCleanup(stalled);
    page.restore();
  }
});

test("waiting gives up with a calm retry message if the cache never clears", async () => {
  await whenSessionReady();
  const page = browser(async () => new Response(null));
  const stalled = stallCleanup();
  try {
    signIn();
    logout();
    const error = await whenSessionReady(30).catch((cause) => cause);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(slowStartMessage);
    expect(slowStartMessage).toBe(
      "This is taking longer than usual. Please try again.",
    );
  } finally {
    await finishCleanup(stalled);
    page.restore();
  }
});

test("a revoked or out-of-scope token sends the user to log in again, not to check their connection", async () => {
  await whenSessionReady();
  const page = browser(async () => new Response(null));
  let resets = 0;
  const unwatch = watchSession(() => {
    resets++;
  });
  const disconnect = spyOn(storage, "disconnect");
  try {
    ui.error = "";
    ui.notice = "";
    signIn();
    // A 401 is reported by both the wire client and sync.
    storage._emit("error", new RemoteStorage.Unauthorized());
    storage._emit("error", new RemoteStorage.Unauthorized());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ui.error).toBe("");
    expect(ui.notice).toBe(loginAgainMessage);
    expect(loginAgainMessage).toBe("Please log in again.");
    expect(resets).toBe(1);
    expect(page.path).toBe("/login");
    expect(storage.remote.connected).toBe(false);
    expect(storage.remote.token).toBeFalsy();
    expect(storage.remote.userAddress).toBe("leader@localhost:8080");
    // The dead token is revoked as on logout, but the cache stays open.
    expect(page.requests.map((request) => request.url)).toEqual([
      "/api/auth/logout",
    ]);
    expect(page.requests[0]?.init.headers).toMatchObject({
      Authorization: "Bearer session-token",
    });
    expect(disconnect).not.toHaveBeenCalled();
    expect(await settles(whenSessionReady())).toBe(true);

    // Late failures from the ended session change nothing.
    storage._emit("error", new RemoteStorage.Unauthorized());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resets).toBe(1);
    expect(page.requests).toHaveLength(1);
  } finally {
    unwatch();
    disconnect.mockRestore();
    signOutQuietly();
    ui.notice = "";
    page.restore();
  }
});

/**
 * Opens a fresh cache with a stand-in storage server: an empty account where
 * pushes made with `rejected` get a 401. Sync handles finished requests in
 * order, so a request left hanging, here or by an earlier test, would hold
 * back every push behind it.
 */
async function storageServer(rejected: string) {
  logout();
  await whenSessionReady();
  const pushes: { path: string; body: unknown; token: unknown }[] = [];
  let pushed = () => {};
  const get = spyOn(storage.remote, "get").mockResolvedValue({
    statusCode: 404,
  });
  const put = spyOn(storage.remote, "put").mockImplementation(
    async (path, body) => {
      const { token } = storage.remote;
      pushes.push({ path, body, token });
      pushed();
      return token === rejected
        ? { statusCode: 401 }
        : { statusCode: 201, revision: `${pushes.length}` };
    },
  );
  return {
    pushes,
    nextPush: () =>
      new Promise<void>((resolve) => {
        pushed = resolve;
      }),
    restore() {
      get.mockRestore();
      put.mockRestore();
    },
  };
}
/** Resolves with `expired` the next time the session ends. */
function sessionEnds() {
  return new Promise<boolean>((resolve) => {
    const stop = onSessionLogout((expired) => {
      stop();
      resolve(expired);
    });
  });
}
const draft = () => storage.scope("/showday/");
async function cachedDraft() {
  const file = (await draft().getFile("draft.txt", false)) as {
    data?: unknown;
  };
  return file.data;
}

test("changes that had not synced when the token was rejected go up after logging in again", async () => {
  await whenSessionReady();
  const page = browser(async (url, init) => {
    if (url === "/api/auth/logout") return new Response(null);
    const { username } = JSON.parse(String(init.body));
    return Response.json({ username, token: "fresh-token" });
  });
  const connect = spyOn(storage, "connect").mockImplementation(
    (address, token) => {
      signIn(address.slice(0, address.indexOf("@")), token);
    },
  );
  const server = await storageServer("rejected-token");
  const disconnect = spyOn(storage, "disconnect");
  try {
    signIn("leader", "rejected-token");
    const ended = sessionEnds();
    await draft().storeFile("text/plain", "draft.txt", "Set list v2");
    expect(await ended).toBe(true);
    expect(server.pushes[0]).toMatchObject({
      path: "/showday/draft.txt",
      token: "rejected-token",
    });
    expect(disconnect).not.toHaveBeenCalled();
    expect(await cachedDraft()).toBe("Set list v2");

    const pushed = server.nextPush();
    await startSession("login", { username: "leader", password: "secret" });
    await pushed;
    expect(server.pushes.at(-1)).toEqual({
      path: "/showday/draft.txt",
      body: "Set list v2",
      token: "fresh-token",
    });
    expect(disconnect).not.toHaveBeenCalled();
  } finally {
    connect.mockRestore();
    disconnect.mockRestore();
    server.restore();
    const stalled = stallCleanup();
    logout();
    await finishCleanup(stalled);
    page.restore();
  }
});

test("logging in as someone else after the token was rejected starts from a cleared cache", async () => {
  await whenSessionReady();
  const page = browser(async (url, init) => {
    if (url === "/api/auth/logout") return new Response(null);
    const { username } = JSON.parse(String(init.body));
    return Response.json({ username, token: `token-for-${username}` });
  });
  const connect = spyOn(storage, "connect").mockImplementation(
    (address, token) => {
      signIn(address.slice(0, address.indexOf("@")), token);
    },
  );
  const server = await storageServer("rejected-token");
  try {
    signIn("leader", "rejected-token");
    const ended = sessionEnds();
    await draft().storeFile("text/plain", "draft.txt", "Set list v2");
    expect(await ended).toBe(true);
    expect(await cachedDraft()).toBe("Set list v2");

    await startSession("login", { username: "deputy", password: "secret" });
    expect(connect).toHaveBeenCalledWith(
      "deputy@localhost:8080",
      "token-for-deputy",
    );
    expect(await cachedDraft()).toBeUndefined();
  } finally {
    connect.mockRestore();
    server.restore();
    const stalled = stallCleanup();
    logout();
    await finishCleanup(stalled);
    page.restore();
  }
});

/** Sync reports a failure `seconds` after `start`. */
function failSyncAt(start: number, seconds: number, error: Error) {
  setSystemTime(start + seconds * 1000);
  storage._emit("error", error);
}
const offline = () => new RemoteStorage.SyncError("Network request failed.");
const serverError = () => new Error("HTTP response code 503 received.");

test("transient sync failures retry quietly", async () => {
  await whenSessionReady();
  const page = browser();
  const unwatch = watchSession(() => {});
  const disconnect = spyOn(storage, "disconnect");
  const start = Date.now();
  try {
    ui.error = "";
    signIn();
    failSyncAt(start, 0, offline());
    failSyncAt(start, 0, serverError());
    failSyncAt(start, 10, new Error("Unknown IndexedDB error"));
    failSyncAt(start, 110, serverError());
    expect(ui.error).toBe("");

    // A sync that gets through ends the streak.
    storage._emit("sync-done", { completed: true });
    failSyncAt(start, 130, offline());
    expect(ui.error).toBe("");

    // So does a long quiet spell, like a laptop asleep overnight.
    failSyncAt(start, 8 * 60 * 60, offline());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ui.error).toBe("");
    expect(ui.notice).toBe("");
    expect(disconnect).not.toHaveBeenCalled();
    expect(storage.remote.connected).toBe(true);
  } finally {
    setSystemTime();
    unwatch();
    disconnect.mockRestore();
    signOutQuietly();
    page.restore();
  }
});

test("sync that keeps failing shows a plain error until it recovers", async () => {
  await whenSessionReady();
  const page = browser();
  const unwatch = watchSession(() => {});
  const start = Date.now();
  try {
    ui.error = "";
    signIn();
    for (let seconds = 0; seconds < syncTroubleAfter / 1000; seconds += 10) {
      failSyncAt(start, seconds, seconds % 20 ? offline() : serverError());
      expect(ui.error).toBe("");
    }
    failSyncAt(start, syncTroubleAfter / 1000, offline());
    expect(ui.error).toBe(syncTroubleMessage);
    expect(syncTroubleMessage).toBe(
      "Changes are not syncing right now. Showday will keep trying.",
    );

    // A sync that still has failing requests is not a recovery.
    storage._emit("sync-done", { completed: false });
    expect(ui.error).toBe(syncTroubleMessage);
    storage._emit("sync-done", { completed: true });
    expect(ui.error).toBe("");

    // Dismissed, it stays away while the same outage goes on.
    for (let seconds = 200; seconds <= 400; seconds += 60)
      failSyncAt(start, seconds, offline());
    expect(ui.error).toBe(syncTroubleMessage);
    ui.error = "";
    failSyncAt(start, 460, offline());
    expect(ui.error).toBe("");

    // It never replaces an error the user is already looking at.
    storage._emit("sync-done", { completed: true });
    ui.error = "Could not save changes. Please retry.";
    for (let seconds = 500; seconds <= 700; seconds += 60)
      failSyncAt(start, seconds, offline());
    expect(ui.error).toBe("Could not save changes. Please retry.");
  } finally {
    setSystemTime();
    unwatch();
    ui.error = "";
    signOutQuietly();
    page.restore();
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
