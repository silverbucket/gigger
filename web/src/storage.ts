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

let sessionReady = false;
const sessionEvents = new EventTarget();
storage.on("ready", () => {
  sessionReady = true;
  sessionEvents.dispatchEvent(new Event("ready"));
});
const logoutSync =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? createLogoutSync(() => logout(false))
    : undefined;

export function onSessionLogout(callback: () => void) {
  sessionEvents.addEventListener("logout", callback);
  return () => sessionEvents.removeEventListener("logout", callback);
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
  return whenSessionReady().then(() => connect(username, token));
}
function connect(username: string, token: string) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      storage.removeEventListener("connected", connected);
      storage.removeEventListener("error", failed);
    };
    const connected = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("Could not open your account. Please log in again."));
    };
    const timeout = setTimeout(failed, 15000);
    storage.on("connected", connected);
    storage.on("error", failed);
    storage.connect(`${encodeURIComponent(username)}@${location.host}`, token);
  });
}

export function logout(broadcast = true) {
  const { userAddress, token } = storage.remote;
  sessionReady = false;
  history.replaceState(null, "", "/login");
  // Dispatched after the URL is cleared so onSessionLogout listeners (the
  // router resync included) see it already gone.
  sessionEvents.dispatchEvent(new Event("logout"));
  if (broadcast) logoutSync?.broadcast();
  storage.stopSync();
  storage.disconnect();
  if (userAddress.endsWith(`@${location.host}`)) {
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
}
