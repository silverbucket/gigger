import { Gigger, type GiggerStore } from "@gigger/schemas";
import RemoteStorage from "remotestoragejs";
export const storage = new RemoteStorage({
  discovery: { allowPrivateAddresses: true, timeout: 5000 },
  changeEvents: { local: true, window: false, remote: true, conflict: true },
});
storage.addModule(Gigger);
storage.access.claim("gigger", "rw");
storage.caching.enable("/gigger/");
export const bands = (storage as RemoteStorage & { gigger: GiggerStore })
  .gigger;

export function connectSession(username: string, token: string) {
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

export function logout() {
  const { userAddress, token } = storage.remote;
  storage.stopSync();
  storage.disconnect();
  history.replaceState(null, "", "/login");
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
