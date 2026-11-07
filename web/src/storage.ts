import {
  Showday,
  type ShowdayStore,
  STORAGE_MODULE_SLUG,
} from "@showday/schemas";
import RemoteStorage from "remotestoragejs";
import { createLogoutSync } from "./logout-sync";
export const storage = new RemoteStorage({
  discovery: { allowPrivateAddresses: true, timeout: 5000 },
  changeEvents: { local: true, window: false, remote: true, conflict: true },
});
storage.addModule(Showday);
storage.access.claim(STORAGE_MODULE_SLUG, "rw");
storage.caching.enable(`/${STORAGE_MODULE_SLUG}/`);
storage.caching.enable(`/public/${STORAGE_MODULE_SLUG}/`);
type Get = (path: string, maxAge?: false | number) => Promise<unknown>;
const library = storage as unknown as {
  get: Get;
  _setGPD: (impl: unknown, context?: unknown) => void;
};
const setGPD = library._setGPD.bind(storage);
// The library installs a new get each time its cache opens.
library._setGPD = (impl, context) => {
  setGPD(impl, context);
  library.get = cacheIfServerFails(library.get);
};
export const bands = (storage as RemoteStorage & Record<string, ShowdayStore>)[
  STORAGE_MODULE_SLUG
];

export const slowStartMessage =
  "This is taking longer than usual. Please try again.";
/** How long sync may keep failing before the user is told. */
export const syncTroubleAfter = 2 * 60_000;

let sessionReady = false;
let failingSince: number | undefined;
let lastFailure = 0;
let syncTrouble = false;
/** Server rejected the storage token; the user can log in again without clearing the cache. */
let tokenRejected = false;
const cacheAccountKey = "showday:account";
const cacheClearingKey = "showday:clearing";
const cacheMarksHere = new Map<string, string>();
/** Set when a reload or a closed tab cut the last cache cleanup short. */
let recovering = cacheMark(cacheClearingKey) !== undefined;
const sessionEvents = new EventTarget();
storage.on("ready", () => {
  if (recovering) {
    recovering = false;
    // Finished before anyone logs in, out of the library's ready dispatch.
    setTimeout(() => clearCache(false));
    return;
  }
  sessionReady = true;
  sessionEvents.dispatchEvent(new Event("ready"));
});
storage.on("connected", () => {
  clearSyncTrouble();
  setTokenRejected(false);
  setCacheMark(cacheAccountKey, storage.remote.userAddress);
  installSyncGuards();
});
// Only once the library has deleted the cache.
storage.on("disconnected", () => {
  setCacheMark(cacheAccountKey, undefined);
  setCacheMark(cacheClearingKey, undefined);
});
storage.on("error", (error) => {
  const { name, message } = (error ?? {}) as {
    name?: string;
    message?: string;
  };
  // Stay signed in unless the user clicks Log out; auth-shaped failures retry quietly.
  if (name === OUT_OF_SCOPE_STORAGE) return;
  if (name === "Unauthorized") {
    setTokenRejected(true);
    syncFailed();
    return;
  }
  if (name === "SyncError" || /^HTTP response code/.test(`${message}`))
    syncFailed();
});
storage.on("sync-done", (event) => {
  if (!(event as { completed?: boolean }).completed) return;
  clearSyncTrouble();
  // A running sync completes only once nothing is left to retry.
  setTokenRejected(false);
});
const logoutSync =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? createLogoutSync(() => logout(false))
    : undefined;

/** Called with true when the server ended the session rather than the user. */
export function onSessionLogout(callback: (expired: boolean) => void) {
  const listener = (event: Event) =>
    callback((event as CustomEvent<boolean>).detail);
  sessionEvents.addEventListener("logout", listener);
  return () => sessionEvents.removeEventListener("logout", listener);
}
/** Called with true once sync has kept failing for a while, and with false when it recovers. */
export function onSyncTrouble(callback: (trouble: boolean) => void) {
  const listener = (event: Event) =>
    callback((event as CustomEvent<boolean>).detail);
  sessionEvents.addEventListener("sync-trouble", listener);
  return () => sessionEvents.removeEventListener("sync-trouble", listener);
}
/** Called when sync was rejected with 401; reconnecting can refresh the token without clearing cache. */
export function onTokenRejected(callback: (rejected: boolean) => void) {
  callback(tokenRejected);
  const listener = (event: Event) =>
    callback((event as CustomEvent<boolean>).detail);
  sessionEvents.addEventListener("token-rejected", listener);
  return () => sessionEvents.removeEventListener("token-rejected", listener);
}

/**
 * Resolves once the local cache has opened, or finished clearing the last
 * session, including one a reload cut short.
 */
export function whenSessionReady(timeout = 30_000) {
  if (sessionReady) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const ready = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      sessionEvents.removeEventListener("ready", ready);
      reject(new Error(slowStartMessage));
    }, timeout);
    sessionEvents.addEventListener("ready", ready, { once: true });
  });
}
/**
 * Like whenSessionReady, before opening `address`, an account that has been
 * verified or that the user chose over the cached one. A session the server
 * ended leaves its cache for the same account to pick up; another account gets
 * a cleared one.
 */
function whenSessionReadyFor(address: string) {
  const held = cacheAccount();
  if (held && held !== address) clearCache(true);
  return whenSessionReady();
}

/** Logs in or signs up with this site's account service, then opens the account. */
export async function startSession(
  mode: "login" | "signup",
  fields: Record<string, unknown>,
) {
  await whenSessionReady();
  const fallback = "Could not log in. Please retry.";
  const response = await fetch(`/api/auth/${mode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  }).catch(() => {
    throw new Error(fallback);
  });
  const session = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(session.error ?? fallback);
  await connectSession(session.username, session.token);
}
/**
 * Sends the browser to `address`'s storage provider to log in. That account is
 * only verified once the provider sends the user back, so the cache is cleared
 * for it beforehand, losing changes another account has not synced yet, only
 * if `discard` agrees. Resolves false, with nothing touched, if it doesn't.
 */
export async function startProviderSession(
  address: string,
  discard: (held: string) => boolean,
) {
  const held = cacheAccount();
  if (held && held !== address && !discard(held)) return false;
  await whenSessionReadyFor(address);
  storage.connect(address);
  return true;
}

export function connectSession(username: string, token: unknown) {
  if (typeof token !== "string" || !token)
    throw new Error("Could not open your account. Please log in again.");
  const address = `${encodeURIComponent(username)}@${location.host}`;
  return whenSessionReadyFor(address).then(() => connect(address, token));
}
/**
 * Fetches a new token for an account on this site and reconnects storage,
 * keeping unsynced local changes when the username matches the cached account.
 */
export async function reconnectSession(fields: {
  username: string;
  password: string;
}) {
  await whenSessionReady();
  const username = fields.username.trim();
  const address = `${encodeURIComponent(username)}@${location.host}`;
  const held = cacheAccount() ?? storage.remote.userAddress;
  if (held && held !== address)
    throw new Error("Log in as the same account to keep unsynced changes.");
  const fallback = "Could not log in. Please retry.";
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: fields.password }),
  }).catch(() => {
    throw new Error(fallback);
  });
  const session = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(session.error ?? fallback);
  if (!storage.remote.connected || storage.remote.userAddress !== address)
    return connectSession(username, session.token);
  if (typeof session.token !== "string" || !session.token)
    throw new Error(fallback);
  // storage.connect() keeps the old token while the remote is connected.
  storage.remote.configure({ token: session.token });
  if (!storage.sync) return;
  // Requests still out with the old token fail this sync; retry them now
  // rather than at the next scheduled one.
  const retry = (event: unknown) => {
    storage.removeEventListener("sync-done", retry);
    if (!(event as { completed?: boolean }).completed) void storage.startSync();
  };
  storage.on("sync-done", retry);
  void storage.startSync();
}
function connect(address: string, token: string) {
  const resuming = cacheAccount() === address;
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      storage.removeEventListener("connected", connected);
      storage.removeEventListener("error", failed);
    };
    const connected = () => {
      cleanup();
      // Sync restarts by itself only on a fresh cache.
      if (resuming && storage.sync) void storage.startSync();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("Could not open your account. Please log in again."));
    };
    const timeout = setTimeout(failed, 15000);
    storage.on("connected", connected);
    storage.on("error", failed);
    storage.connect(address, token);
  });
}

export function logout(broadcast = true) {
  const { userAddress, token } = storage.remote;
  leave(false);
  clearCache(broadcast);
  revoke(userAddress, token);
}

/** Error name for a 403 on storage outside Showday's scope (not sync trouble). */
const OUT_OF_SCOPE_STORAGE = "OutOfScopeStorage";

class OutOfScopeStorageError extends Error {
  constructor() {
    super("Storage path is outside Showday scope.");
    this.name = OUT_OF_SCOPE_STORAGE;
  }
}

/** Paths the Showday token is supposed to touch; other folders may return 403. */
function isAppStoragePath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return (
    normalized === "/showday" ||
    normalized.startsWith("/showday/") ||
    normalized === "/public/showday" ||
    normalized.startsWith("/public/showday/")
  );
}

/**
 * Reads that set no maxAge of their own settle for the cache when the server
 * cannot vouch for it, as they do offline. Reads that set one still fail.
 */
function cacheIfServerFails(get: Get): Get {
  return (path, maxAge) =>
    maxAge === undefined
      ? get(path, undefined).catch(() => get(path, false))
      : get(path, maxAge);
}

type SyncLike = {
  interpretStatus: (status: number | string) => { unAuth?: boolean };
  dealWithFailure: (path: string) => Promise<void>;
  handleResponse: (
    path: string,
    action: string,
    response: { statusCode: number | string },
  ) => Promise<boolean>;
  queueGetRequest: (path: string) => Promise<unknown>;
  finishUnsuccessfulTask: (task: unknown, error: unknown) => Promise<void>;
};

/**
 * Stops remotestorage.js treating out-of-app 403 responses like a revoked
 * token, and fails reads waiting on the server once a sync request fails. The
 * library settles those only when a request succeeds, so a server that keeps
 * failing would otherwise hold them, and whatever awaits them, forever.
 */
function installSyncGuards() {
  const sync = storage.sync as
    | (SyncLike & { __showdayGuards?: boolean })
    | undefined;
  if (!sync || sync.__showdayGuards) return;
  const waiting = new Set<(error: unknown) => void>();
  const queueGetRequest = sync.queueGetRequest.bind(sync);
  sync.queueGetRequest = (path) =>
    new Promise((resolve, reject) => {
      const fail = (error: unknown) => {
        waiting.delete(fail);
        reject(error);
      };
      waiting.add(fail);
      queueGetRequest(path).then((response) => {
        waiting.delete(fail);
        resolve(response);
      }, fail);
    });
  const finishUnsuccessfulTask = sync.finishUnsuccessfulTask.bind(sync);
  sync.finishUnsuccessfulTask = (task, error) => {
    // All of them: requests queued behind a failure wait for the next sync.
    for (const fail of [...waiting]) fail(error);
    return finishUnsuccessfulTask(task, error);
  };
  const handleResponse = sync.handleResponse.bind(sync);
  sync.handleResponse = async (path, action, response) => {
    const status = sync.interpretStatus(response.statusCode);
    if (
      status.unAuth &&
      response.statusCode === 403 &&
      !isAppStoragePath(path)
    ) {
      await sync.dealWithFailure(path);
      const error = new OutOfScopeStorageError();
      storage._emit("error", error);
      throw error;
    }
    return handleResponse(path, action, response);
  };
  sync.__showdayGuards = true;
}

function leave(expired: boolean) {
  clearSyncTrouble();
  history.replaceState(null, "", "/login");
  // Dispatched after the URL is cleared so onSessionLogout listeners (the
  // router resync included) see it already gone.
  sessionEvents.dispatchEvent(new CustomEvent("logout", { detail: expired }));
}
function clearCache(broadcast: boolean) {
  sessionReady = false;
  // The cache stays marked as its account's until the library has deleted it,
  // so a reload before then (another tab blocking the deletion, say) finishes
  // the cleanup instead of reopening the data for whoever logs in next.
  setCacheMark(cacheClearingKey, "1");
  if (broadcast) logoutSync?.broadcast();
  storage.stopSync();
  storage.disconnect();
}
/**
 * The account whose data the local cache holds, or none while it is being
 * deleted. Kept in localStorage for other tabs and later visits; the remote's
 * own address won't do, as it names whoever last tried to log in, verified or
 * not.
 */
function cacheAccount() {
  return cacheMark(cacheClearingKey) === undefined
    ? cacheMark(cacheAccountKey)
    : undefined;
}
function cacheMark(key: string) {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return cacheMarksHere.get(key);
  }
}
function setCacheMark(key: string, value: string | undefined) {
  if (value === undefined) cacheMarksHere.delete(key);
  else cacheMarksHere.set(key, value);
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Without localStorage, this tab's copy has to do.
  }
}
/** Revokes a token from this site's account service in the background. */
function revoke(userAddress: string, token: string | false | undefined) {
  if (!token || !userAddress?.endsWith(`@${location.host}`)) return;
  const username = decodeURIComponent(
    userAddress.slice(0, userAddress.lastIndexOf("@")),
  );
  void fetch("/api/auth/logout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ username }),
    keepalive: true,
  }).catch(() => {});
}
function syncFailed() {
  if (!storage.remote.connected) return;
  const now = Date.now();
  // Failed syncs are retried within a minute or two, so a longer gap (a device
  // waking from sleep, say) starts a new streak rather than continuing one.
  if (failingSince === undefined || now - lastFailure > syncTroubleAfter)
    failingSince = now;
  lastFailure = now;
  if (syncTrouble || now - failingSince < syncTroubleAfter) return;
  syncTrouble = true;
  sessionEvents.dispatchEvent(
    new CustomEvent("sync-trouble", { detail: true }),
  );
}
function setTokenRejected(rejected: boolean) {
  if (tokenRejected === rejected) return;
  tokenRejected = rejected;
  sessionEvents.dispatchEvent(
    new CustomEvent("token-rejected", { detail: rejected }),
  );
}
function clearSyncTrouble() {
  failingSince = undefined;
  if (!syncTrouble) return;
  syncTrouble = false;
  sessionEvents.dispatchEvent(
    new CustomEvent("sync-trouble", { detail: false }),
  );
}
