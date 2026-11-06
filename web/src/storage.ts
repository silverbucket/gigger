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

let sessionReady = false;
const sessionEvents = new EventTarget();
storage.on("ready", () => {
  sessionReady = true;
});
const logoutSync =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? createLogoutSync(() => logout(false))
    : undefined;

export function onSessionLogout(callback: () => void) {
  sessionEvents.addEventListener("logout", callback);
  return () => sessionEvents.removeEventListener("logout", callback);
}
export function ensureSessionReady() {
  if (!sessionReady)
    throw new Error(
      "Local storage is still opening or clearing. Close other Showday tabs and try again.",
    );
}

export function connectSession(username: string, token: unknown) {
  if (typeof token !== "string" || !token)
    throw new Error("Could not open your account. Please log in again.");
  ensureSessionReady();
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
