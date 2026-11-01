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

export async function logout() {
  try {
    await new Promise<void>((resolve, reject) => {
      const done = (event: unknown) => {
        clearTimeout(timeout);
        storage.removeEventListener("sync-done", done);
        if ((event as { completed: boolean }).completed) resolve();
        else
          reject(
            new Error(
              "Could not finish saving. Try logging out again when online.",
            ),
          );
      };
      const timeout = setTimeout(() => done({ completed: false }), 15000);
      storage.on("sync-done", done);
      void storage.startSync().catch(() => done({ completed: false }));
    });
    const username = decodeURIComponent(
      storage.remote.userAddress.slice(
        0,
        storage.remote.userAddress.lastIndexOf("@"),
      ),
    );
    if (storage.remote.userAddress.endsWith(`@${location.host}`)) {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${storage.remote.token}`,
        },
        body: JSON.stringify({ username }),
      });
      if (!response.ok) throw new Error("Could not log out. Please retry.");
    }
  } catch {
    if (
      !confirm(
        "Could not finish saving or end the session on the server. Log out on this device anyway? Unsaved changes will be lost.",
      )
    )
      return;
  }
  await new Promise<void>((resolve) => {
    const done = () => {
      storage.removeEventListener("disconnected", done);
      resolve();
    };
    storage.on("disconnected", done);
    storage.disconnect();
  });
  history.replaceState(null, "", "/login");
}
