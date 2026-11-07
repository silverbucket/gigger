import { onSessionLogout, onSyncTrouble } from "../storage";
import { data } from "./data.svelte";

export const staleMessage =
  "This gig changed somewhere else, reload to see the latest";
export const loginAgainMessage = "Please log in again.";
export const syncTroubleMessage =
  "Changes are not syncing right now. Showday will keep trying.";

/** One busy flag and one error line for the whole app. */
class Ui {
  busy = $state(false);
  error = $state("");
  /** A calm line on the login screen, e.g. after the server ended the session. */
  notice = $state("");
  /** Sync keeps failing. Kept apart from the error line, which every change clears. */
  syncTrouble = $state(false);
  /** Matches the phone layout breakpoint in app.css. */
  phone = $state(
    typeof matchMedia !== "undefined" &&
      matchMedia("(max-width: 899px)").matches,
  );
  constructor() {
    if (typeof matchMedia === "undefined") return;
    matchMedia("(max-width: 899px)").addEventListener("change", (event) => {
      this.phone = event.matches;
    });
  }
}
export const ui = new Ui();

/** Runs a change, reloads the data and reports a failure in the app's error line. */
export async function run(
  action: () => Promise<unknown>,
  fallback = "Could not save changes. Please retry.",
) {
  ui.busy = true;
  ui.error = "";
  try {
    await action();
    await data.load();
    return true;
  } catch (cause) {
    ui.error =
      cause instanceof Error && cause.message ? cause.message : fallback;
    return false;
  } finally {
    ui.busy = false;
  }
}

/**
 * An ended session sends the user to log in again; sync that keeps failing
 * raises ui.syncTrouble until it recovers. Returns a function that stops.
 */
export function watchSession(onLogout: () => void) {
  const stopLogout = onSessionLogout((expired) => {
    onLogout();
    ui.notice = expired ? loginAgainMessage : "";
  });
  const stopSync = onSyncTrouble((trouble) => {
    ui.syncTrouble = trouble;
  });
  return () => {
    stopLogout();
    stopSync();
  };
}
