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
  bands,
  connectSession,
  logout,
  onSessionLogout,
  onTokenRejected,
  reconnectSession,
  slowStartMessage,
  startProviderSession,
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
const { run, syncTroubleMessage, ui, watchSession } = await import(
  "./lib/ui.svelte"
);
const { data } = await import("./lib/data.svelte");
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
  storage._emit("connected");
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

/**
 * A localStorage holding only Showday's own keys. The library checks for one
 * by writing a key of its own, which this refuses, so the library carries on
 * without it.
 */
function showdayStorage(entries: Record<string, string> = {}) {
  const items = new Map(Object.entries(entries));
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem(key: string, value: string) {
        if (!key.startsWith("showday:")) throw new Error(`Refused ${key}`);
        items.set(key, value);
      },
      removeItem(key: string) {
        items.delete(key);
      },
    },
  });
  return {
    items,
    restore() {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
    },
  };
}

test("a logout leaves the cache marked as its account's until the cleanup has deleted it", async () => {
  await whenSessionReady();
  const page = browser(async () => new Response(null));
  const marks = showdayStorage();
  const connect = spyOn(storage, "connect").mockImplementation(() => {});
  const stalled = stallCleanup();
  let cleared = false;
  try {
    signIn();
    expect(marks.items.get("showday:account")).toBe("leader@localhost:8080");
    logout();
    // What a reload would find while another tab blocks the deletion.
    expect(Object.fromEntries(marks.items)).toEqual({
      "showday:account": "leader@localhost:8080",
      "showday:clearing": "1",
    });

    // Data on its way out is nothing to ask about; the login just waits.
    const leaving = startProviderSession("someone@elsewhere.example", () => {
      throw new Error("Asked to discard the cache");
    });
    expect(await settles(leaving)).toBe(false);
    await finishCleanup(stalled);
    cleared = true;
    expect(await leaving).toBe(true);
    expect(connect).toHaveBeenCalledWith("someone@elsewhere.example");
    expect(marks.items.size).toBe(0);
  } finally {
    connect.mockRestore();
    if (!cleared) await finishCleanup(stalled);
    marks.restore();
    page.restore();
  }
});

test("a revoked token keeps the session open until the user logs out", async () => {
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
    storage._emit("error", new RemoteStorage.Unauthorized());
    storage._emit("error", new RemoteStorage.Unauthorized());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ui.notice).toBe("");
    expect(resets).toBe(0);
    expect(page.path).not.toBe("/login");
    expect(storage.remote.connected).toBe(true);
    expect(storage.remote.token).toBe("session-token");
    expect(disconnect).not.toHaveBeenCalled();
    expect(page.requests).toHaveLength(0);
  } finally {
    unwatch();
    disconnect.mockRestore();
    signOutQuietly();
    page.restore();
  }
});

test("only an explicit logout leaves the login screen and revokes the token", async () => {
  await whenSessionReady();
  const page = browser(async () => new Response(null));
  let resets = 0;
  const unwatch = watchSession(() => {
    resets++;
  });
  try {
    signIn();
    logout();
    await settles(whenSessionReady());
    expect(resets).toBe(1);
    expect(page.path).toBe("/login");
    expect(page.requests.map((request) => request.url)).toEqual([
      "/api/auth/logout",
    ]);
  } finally {
    unwatch();
    page.restore();
  }
});

test("repeated out-of-scope 403 responses do not show sync trouble", async () => {
  await whenSessionReady();
  const page = browser();
  const unwatch = watchSession(() => {});
  const start = Date.now();
  try {
    signIn();
    const sync = storage.sync as {
      handleResponse: (
        path: string,
        action: string,
        response: { statusCode: number },
      ) => Promise<boolean>;
    };
    for (
      let seconds = 0;
      seconds <= syncTroubleAfter / 1000 + 30;
      seconds += 5
    ) {
      setSystemTime(start + seconds * 1000);
      await sync
        .handleResponse("/gigger/", "get", { statusCode: 403 })
        .catch(() => {});
    }
    expect(ui.syncTrouble).toBe(false);
  } finally {
    setSystemTime();
    unwatch();
    signOutQuietly();
    page.restore();
  }
});

test("a 403 on another module's folder does not end the session", async () => {
  await whenSessionReady();
  const page = browser();
  let resets = 0;
  const unwatch = watchSession(() => {
    resets++;
  });
  const disconnect = spyOn(storage, "disconnect");
  try {
    signIn();
    const sync = storage.sync as {
      handleResponse: (
        path: string,
        action: string,
        response: { statusCode: number },
      ) => Promise<boolean>;
    };
    expect(sync).toBeDefined();
    await expect(
      sync.handleResponse("/gigger/", "get", { statusCode: 403 }),
    ).rejects.toThrow("Storage path is outside Showday scope.");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ui.notice).toBe("");
    expect(ui.syncTrouble).toBe(false);
    expect(resets).toBe(0);
    expect(page.path).not.toBe("/login");
    expect(storage.remote.connected).toBe(true);
    expect(storage.remote.token).toBe("session-token");
    expect(disconnect).not.toHaveBeenCalled();
    expect(page.requests).toHaveLength(0);
  } finally {
    unwatch();
    disconnect.mockRestore();
    signOutQuietly();
    page.restore();
  }
});

/**
 * Opens a fresh cache with a stand-in storage server: an empty account where
 * pushes made with `rejected` get a 401, every request gets `down` while that
 * is set, and pushes are answered only once `held` settles. Sync handles
 * finished requests in order, so a request left hanging, here or by an
 * earlier test, would hold back every push behind it.
 */
async function storageServer(rejected = "") {
  signOutQuietly();
  await whenSessionReady();
  const pushes: { path: string; body: unknown; token: unknown }[] = [];
  let pushed = () => {};
  const server = {
    pushes,
    down: undefined as number | undefined,
    held: Promise.resolve(),
    nextPush: () =>
      new Promise<void>((resolve) => {
        pushed = resolve;
      }),
    restore() {
      get.mockRestore();
      put.mockRestore();
    },
  };
  const get = spyOn(storage.remote, "get").mockImplementation(async () => ({
    statusCode: server.down ?? 404,
  }));
  const put = spyOn(storage.remote, "put").mockImplementation(
    async (path, body) => {
      const { token } = storage.remote;
      pushes.push({ path, body, token });
      pushed();
      await server.held;
      if (server.down) return { statusCode: server.down };
      return token === rejected
        ? { statusCode: 401 }
        : { statusCode: 201, revision: `${pushes.length}` };
    },
  );
  return server;
}
/** Resolves once a sync gets through everything it had to do. */
function syncCompletes() {
  return new Promise<void>((resolve) => {
    const done = (event: unknown) => {
      if (!(event as { completed?: boolean }).completed) return;
      storage.removeEventListener("sync-done", done);
      resolve();
    };
    storage.on("sync-done", done);
  });
}
const draft = () => storage.scope("/showday/");
async function cachedDraft() {
  const file = (await draft().getFile("draft.txt", false)) as {
    data?: unknown;
  };
  return file.data;
}

test("a change the server keeps refusing is kept on this device without holding up the app", async () => {
  await whenSessionReady();
  const page = browser(async () => new Response(null));
  const marks = showdayStorage();
  const unwatch = watchSession(() => {});
  const server = await storageServer();
  try {
    ui.error = "";
    signIn();
    const band = { id: "band", name: "Band", currency: "CZK" };
    await bands.save("band", band.id, band);
    server.down = 503;

    const saving = run(() =>
      bands.save("band", band.id, { ...band, currency: "EUR" }),
    );
    expect(ui.busy).toBe(true);
    expect(await saving).toBe(true);
    expect(ui.busy).toBe(false);
    expect(ui.error).toBe("");
    expect(data.band(band.id)?.band.currency).toBe("EUR");
    // The reload asked the server, which refused the change.
    expect(server.pushes.map((push) => push.path)).toContain(
      "/showday/bands/band/band",
    );
    expect(page.path).not.toBe("/login");
    expect(storage.remote.connected).toBe(true);

    server.down = undefined;
    const pushed = server.nextPush();
    void storage.startSync();
    await pushed;
    const sent = server.pushes.at(-1);
    expect(sent?.path).toBe("/showday/bands/band/band");
    expect(JSON.parse(String(sent?.body))).toMatchObject({ currency: "EUR" });
  } finally {
    unwatch();
    server.restore();
    const stalled = stallCleanup();
    logout();
    await finishCleanup(stalled);
    data.reset();
    marks.restore();
    page.restore();
  }
});

test("changes that had not synced when the token was rejected go up after logging in again", async () => {
  await whenSessionReady();
  const page = browser(async (url, init) => {
    if (url === "/api/auth/logout") return new Response(null);
    const { username } = JSON.parse(String(init.body));
    return Response.json({ username, token: "fresh-token" });
  });
  const server = await storageServer("rejected-token");
  const disconnect = spyOn(storage, "disconnect");
  let rejected = false;
  const unwatchToken = onTokenRejected((value) => {
    rejected = value;
  });
  try {
    // The push made with the rejected token is only answered after logging in again.
    let answer = () => {};
    server.held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    signIn("leader", "rejected-token");
    await draft().storeFile("text/plain", "draft.txt", "Set list v2");
    storage._emit("error", new RemoteStorage.Unauthorized());
    expect(rejected).toBe(true);
    expect(storage.remote.connected).toBe(true);
    expect(server.pushes[0]).toMatchObject({
      path: "/showday/draft.txt",
      token: "rejected-token",
    });
    expect(disconnect).not.toHaveBeenCalled();
    expect(await cachedDraft()).toBe("Set list v2");

    const pushed = server.nextPush();
    await reconnectSession({ username: "leader", password: "secret" });
    expect(rejected).toBe(false);
    expect(storage.remote.token).toBe("fresh-token");

    const synced = syncCompletes();
    answer();
    await pushed;
    expect(server.pushes.at(-1)).toEqual({
      path: "/showday/draft.txt",
      body: "Set list v2",
      token: "fresh-token",
    });
    await synced;
    expect(rejected).toBe(false);
    expect(disconnect).not.toHaveBeenCalled();
  } finally {
    unwatchToken();
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
      storage._emit("connected");
    },
  );
  const server = await storageServer("rejected-token");
  try {
    signIn("leader", "rejected-token");
    await draft().storeFile("text/plain", "draft.txt", "Set list v2");
    storage._emit("error", new RemoteStorage.Unauthorized());
    expect(await cachedDraft()).toBe("Set list v2");

    logout();
    await whenSessionReady();
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

test("a user@host login for another account asks first, and saying no keeps the changes that had not synced", async () => {
  await whenSessionReady();
  const page = browser(async (url, init) => {
    if (url === "/api/auth/logout") return new Response(null);
    const { username } = JSON.parse(String(init.body));
    return Response.json({ username, token: "fresh-token" });
  });
  const connect = spyOn(storage, "connect").mockImplementation(
    (address, token) => {
      signIn(address.slice(0, address.indexOf("@")), token);
      storage._emit("connected");
    },
  );
  const server = await storageServer("rejected-token");
  try {
    signIn("leader", "rejected-token");
    await draft().storeFile("text/plain", "draft.txt", "Set list v2");
    storage._emit("error", new RemoteStorage.Unauthorized());

    // A mistyped address, say.
    const asked: string[] = [];
    const left = await startProviderSession(
      "leadr@elsewhere.example",
      (held) => {
        asked.push(held);
        return false;
      },
    );
    expect(left).toBe(false);
    expect(asked).toEqual(["leader@localhost:8080"]);
    expect(connect).not.toHaveBeenCalled();
    expect(await cachedDraft()).toBe("Set list v2");

    const pushed = server.nextPush();
    await connectSession("leader", "fresh-token");
    await pushed;
    expect(server.pushes.at(-1)).toMatchObject({
      path: "/showday/draft.txt",
      token: "fresh-token",
    });
  } finally {
    connect.mockRestore();
    server.restore();
    const stalled = stallCleanup();
    logout();
    await finishCleanup(stalled);
    page.restore();
  }
});

test("a user@host login for the same account keeps the cache, and one for another account clears it only once agreed", async () => {
  await whenSessionReady();
  const page = browser(async () => new Response(null));
  const cacheAtConnect: Promise<unknown>[] = [];
  const connect = spyOn(storage, "connect").mockImplementation((address) => {
    // The library names the account before leaving for its provider.
    storage.remote.configure({ userAddress: address });
    cacheAtConnect.push(cachedDraft());
    storage._emit("connected");
  });
  const server = await storageServer("rejected-token");
  try {
    signIn("leader", "rejected-token");
    await draft().storeFile("text/plain", "draft.txt", "Set list v2");
    storage._emit("error", new RemoteStorage.Unauthorized());

    const unasked = () => {
      throw new Error("Asked to discard the cache");
    };
    expect(await startProviderSession("leader@localhost:8080", unasked)).toBe(
      true,
    );
    expect(await cacheAtConnect[0]).toBe("Set list v2");

    expect(
      await startProviderSession("someone@elsewhere.example", () => true),
    ).toBe(true);
    expect(connect).toHaveBeenLastCalledWith("someone@elsewhere.example");
    expect(await cacheAtConnect[1]).toBeUndefined();

    // The first account's cache is still here until the user agrees to clear it.
    expect(
      await startProviderSession("other@elsewhere.example", () => true),
    ).toBe(true);
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
    expect(ui.syncTrouble).toBe(false);

    // A sync that gets through ends the streak.
    storage._emit("sync-done", { completed: true });
    failSyncAt(start, 130, offline());
    expect(ui.syncTrouble).toBe(false);

    // So does a long quiet spell, like a laptop asleep overnight.
    failSyncAt(start, 8 * 60 * 60, offline());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ui.syncTrouble).toBe(false);
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

test("sync that keeps failing says so until it recovers", async () => {
  await whenSessionReady();
  const page = browser();
  const unwatch = watchSession(() => {});
  const start = Date.now();
  try {
    ui.error = "";
    signIn();
    for (let seconds = 0; seconds < syncTroubleAfter / 1000; seconds += 10) {
      failSyncAt(start, seconds, seconds % 20 ? offline() : serverError());
      expect(ui.syncTrouble).toBe(false);
    }
    failSyncAt(start, syncTroubleAfter / 1000, offline());
    expect(ui.syncTrouble).toBe(true);
    expect(ui.error).toBe("");
    expect(syncTroubleMessage).toBe(
      "Changes are not syncing right now. Showday will keep trying.",
    );

    // A sync that still has failing requests is not a recovery.
    storage._emit("sync-done", { completed: false });
    expect(ui.syncTrouble).toBe(true);
    storage._emit("sync-done", { completed: true });
    expect(ui.syncTrouble).toBe(false);

    // Ending the session takes it down too.
    failSyncAt(start, 300, offline());
    failSyncAt(start, 300 + syncTroubleAfter / 1000, offline());
    expect(ui.syncTrouble).toBe(true);
    const stalled = stallCleanup();
    logout();
    expect(ui.syncTrouble).toBe(false);
    await finishCleanup(stalled);
  } finally {
    setSystemTime();
    unwatch();
    ui.syncTrouble = false;
    signOutQuietly();
    page.restore();
  }
});

test("edits and their errors leave the not-syncing line up for the whole outage", async () => {
  await whenSessionReady();
  const page = browser();
  const unwatch = watchSession(() => {});
  const load = spyOn(data, "load").mockResolvedValue(undefined);
  const start = Date.now();
  try {
    signIn();
    failSyncAt(start, 0, offline());
    failSyncAt(start, syncTroubleAfter / 1000, offline());
    expect(ui.syncTrouble).toBe(true);

    expect(await run(async () => {})).toBe(true);
    expect(ui.syncTrouble).toBe(true);
    const failed = await run(async () => {
      throw new Error("Could not save changes. Please retry.");
    });
    expect(failed).toBe(false);
    expect(ui.error).toBe("Could not save changes. Please retry.");
    expect(ui.syncTrouble).toBe(true);

    // Dismissing that error leaves the outage showing as it goes on.
    ui.error = "";
    for (let seconds = 180; seconds <= 600; seconds += 60)
      failSyncAt(start, seconds, offline());
    expect(ui.syncTrouble).toBe(true);

    storage._emit("sync-done", { completed: true });
    expect(ui.syncTrouble).toBe(false);
  } finally {
    setSystemTime();
    unwatch();
    load.mockRestore();
    ui.error = "";
    ui.syncTrouble = false;
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

// Last, as it starts a second copy of the storage module.
test("a cache cleanup that a reload cut short is finished before anyone can log in", async () => {
  // Left by a logout whose deletion another tab was still blocking.
  const marks = showdayStorage({
    "showday:account": "leader@localhost:8080",
    "showday:clearing": "1",
  });
  let started = () => {};
  const cleanup = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = spyOn(
    RemoteStorage.prototype,
    "disconnect",
  ).mockImplementation(() => started());
  try {
    const specifier = "./storage.ts?reloaded";
    const reloaded = (await import(specifier)) as typeof import("./storage");
    // A login tried as soon as the page is up.
    const opening = reloaded.whenSessionReady();
    await cleanup;
    expect(await settles(opening)).toBe(false);
    expect(Object.fromEntries(marks.items)).toEqual({
      "showday:account": "leader@localhost:8080",
      "showday:clearing": "1",
    });
    expect(blocked).toHaveBeenCalledTimes(1);

    blocked.mockRestore();
    reloaded.storage.disconnect();
    await opening;
    expect(marks.items.size).toBe(0);
  } finally {
    blocked.mockRestore();
    marks.restore();
  }
});
