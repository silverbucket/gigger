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
export const bands = (storage as RemoteStorage & Record<string, ShowdayStore>)[
  STORAGE_MODULE_SLUG
];

export const slowStartMessage =
  "This is taking longer than usual. Please try again.";
/** How long sync may keep failing before the user is told. */
export const syncTroubleAfter = 2 * 60_000;

let sessionReady = false;
let expiring = false;
let failingSince: number | undefined;
let lastFailure = 0;
let syncTrouble = false;
const sessionEvents = new EventTarget();
storage.on("ready", () => {
  sessionReady = true;
  sessionEvents.dispatchEvent(new Event("ready"));
});
storage.on("connected", clearSyncTrouble);
storage.on("error", (error) => {
  const { name, message } = (error ?? {}) as {
    name?: string;
    message?: string;
  };
  // 401/403: the token was revoked, or doesn't cover this app's scope.
  if (name === "Unauthorized") expireSession();
  else if (name === "SyncError" || /^HTTP response code/.test(`${message}`))
    syncFailed();
});
storage.on("sync-done", (event) => {
  if ((event as { completed?: boolean }).completed) clearSyncTrouble();
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

/** Resolves once the local cache has opened, or finished clearing the last session. */
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
 * Like whenSessionReady, before opening `address`. A session the server ended
 * leaves its cache for the same account to pick up; another account gets a
 * cleared one.
 */
export function whenSessionReadyFor(address: string) {
  const previous = storage.remote.userAddress;
  if (previous && previous !== address) clearCache(true);
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

export function connectSession(username: string, token: unknown) {
  if (typeof token !== "string" || !token)
    throw new Error("Could not open your account. Please log in again.");
  const address = `${encodeURIComponent(username)}@${location.host}`;
  return whenSessionReadyFor(address).then(() => connect(address, token));
}
function connect(address: string, token: string) {
  const resuming = Boolean(storage.remote.userAddress);
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      storage.removeEventListener("connected", connected);
      storage.removeEventListener("error", failed);
    };
    const connected = () => {
      cleanup();
      // Sync restarts by itself only on a fresh cache.
      if (resuming) void storage.startSync();
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

function expireSession() {
  if (expiring || !storage.remote.connected) return;
  expiring = true;
  // Out of the library's error dispatch before the session is touched.
  setTimeout(() => {
    expiring = false;
    if (storage.remote.connected) expire();
  });
}
/**
 * Back to the login screen, keeping the cache: changes that have not synced
 * yet go up once the same account logs in again.
 */
function expire() {
  const { userAddress, token } = storage.remote;
  storage.stopSync();
  storage.remote.configure({ token: null });
  leave(true);
  revoke(userAddress, token);
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
  if (broadcast) logoutSync?.broadcast();
  storage.stopSync();
  storage.disconnect();
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
function clearSyncTrouble() {
  failingSince = undefined;
  if (!syncTrouble) return;
  syncTrouble = false;
  sessionEvents.dispatchEvent(
    new CustomEvent("sync-trouble", { detail: false }),
  );
}
