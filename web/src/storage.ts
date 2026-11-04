import { Gigger, type GiggerStore } from "@gigger/schemas";
import RemoteStorage from "remotestoragejs";
import { router } from "./lib/router.svelte";
import { createLogoutSync } from "./logout-sync";
export const storage = new RemoteStorage({
  discovery: { allowPrivateAddresses: true, timeout: 5000 },
  changeEvents: { local: true, window: false, remote: true, conflict: true },
});
storage.addModule(Gigger);
storage.access.claim("gigger", "rw");
storage.caching.enable("/gigger/");
storage.caching.enable("/public/gigger/");
export const bands = (storage as RemoteStorage & { gigger: GiggerStore })
  .gigger;

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
      "Local storage is still opening or clearing. Close other Gigger tabs and try again.",
    );
}

export function connectSession(username: string, token: string) {
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
  sessionEvents.dispatchEvent(new Event("logout"));
  if (broadcast) logoutSync?.broadcast();
  storage.stopSync();
  storage.disconnect();
  history.replaceState(null, "", "/login");
  // replaceState fires no hashchange, so the router would otherwise keep
  // showing whatever record was open when the session ended.
  router.read();
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
