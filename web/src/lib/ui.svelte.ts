import { data } from "./data.svelte";

export const staleMessage =
  "This gig changed somewhere else, reload to see the latest";

/** One busy flag and one error line for the whole app. */
class Ui {
  busy = $state(false);
  error = $state("");
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
