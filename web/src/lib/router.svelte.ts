export const screens = [
  "bookings",
  "venues",
  "contacts",
  "bands",
  "band",
  "settings",
] as const;
export type Screen = (typeof screens)[number];

/**
 * Hash routes keep the browser's back button working, so on a phone Back closes
 * a detail and returns to its list. Examples:
 *   #/bookings/gig/<bandId>/<gigId>[/edit|/played]
 *   #/bookings/message/<conversationId>
 *   #/bookings/new[?from=<conversationId>|?contact=<contactId>]
 *   #/venues/<id>[/edit], #/venues/new
 */
class Router {
  screen = $state<Screen>("bookings");
  parts = $state<string[]>([]);
  query = $state<URLSearchParams>(new URLSearchParams());

  constructor() {
    if (typeof window === "undefined") return;
    this.read();
    window.addEventListener("hashchange", () => {
      // Most navigation is a plain <a href="#/..."> link, not router.go();
      // a hashchange event (unlike pushState) only ever fires for an entry
      // in this document's own history, so it's always safe to go back to.
      this.came = true;
      this.read();
    });
  }
  read() {
    const [path, search = ""] = location.hash.replace(/^#\/?/, "").split("?");
    const [screen, ...parts] = path.split("/").filter(Boolean).map(decode);
    this.screen = (screens as readonly string[]).includes(screen)
      ? (screen as Screen)
      : "bookings";
    this.parts = parts;
    this.query = new URLSearchParams(search);
  }
  go(path: string, { replace = false } = {}) {
    const hash = `#/${path.replace(/^[#/]+/, "")}`;
    if (replace) history.replaceState(history.state, "", hash);
    else {
      history.pushState(history.state, "", hash);
      this.came = true;
    }
    this.read();
  }
  /** Back within the app when there is history, otherwise up to the list. */
  back(fallback: string) {
    if (history.length > 1 && this.came) history.back();
    else this.go(fallback, { replace: true });
  }
  /** Whether the user navigated inside the app at least once. */
  came = false;
}
const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
export const path = (...parts: string[]) =>
  parts.map((part) => encodeURIComponent(part)).join("/");
export const router = new Router();
