import { publicPageCouldNotPublish as publishFailure } from "@showday/schemas";

/** Shown when automatic publish retries exhaust; no jargon. */
export const publicPageCouldNotPublish = publishFailure;
export const publicPageCouldNotUnpublish =
  "The public page could not be taken down. Try again.";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** True when both the public page and its gigs listing are served. */
export async function isPublicPageLive(slug: string): Promise<boolean> {
  const base = `/b/${encodeURIComponent(slug)}`;
  try {
    const [gigs, page] = await Promise.all([
      fetch(`${base}/gigs.json`, { cache: "no-store" }),
      fetch(base, { cache: "no-store" }),
    ]);
    return gigs.ok && page.ok;
  } catch {
    return false;
  }
}

export type PublicPageAction =
  | "idle"
  | "publishing"
  | "saving"
  | "unpublishing";

/** What the editor's page actions show; the page being live drives everything. */
export function publicPageControls(state: {
  live: boolean;
  unsaved: boolean;
  action: PublicPageAction;
  listed: number;
}) {
  const { live, unsaved, action, listed } = state;
  return {
    status: live ? "Published" : "Not published",
    listedTag: live && listed > 0,
    primary:
      action === "publishing"
        ? "Publishing…"
        : action === "saving"
          ? "Saving…"
          : live
            ? "Save"
            : "Publish",
    /** The live write the primary button starts; Save repeats the publish. */
    primaryAction: (live ? "saving" : "publishing") as PublicPageAction,
    busy: action !== "idle",
    unpublish: live,
    cancel: unsaved,
    openAndExport: live,
  };
}

/**
 * Remembers which slug is known to serve a public page. A finished publish or
 * unpublish outranks any live check that was already in flight, and a slug
 * already confirmed live is not rechecked, so a slow check cannot flip Save
 * back to Publish.
 */
export function trackPublicPageLive(
  onChange: (liveSlug: string | null) => void,
  check: (slug: string) => Promise<boolean> = isPublicPageLive,
) {
  let generation = 0;
  let liveSlug: string | null = null;
  const set = (slug: string | null) => {
    liveSlug = slug;
    onChange(slug);
  };
  return {
    confirmed(slug: string) {
      generation += 1;
      set(slug);
    },
    takenDown() {
      generation += 1;
      set(null);
    },
    async probe(slug: string) {
      if (liveSlug === slug) return;
      const started = ++generation;
      const live = await check(slug);
      if (started === generation) set(live ? slug : null);
    },
  };
}

/**
 * Registers and writes the public copy, then rechecks the live URLs until they
 * respond or the time limit is reached. Retries the write step between checks.
 */
export async function publishUntilLive(
  slug: string,
  write: () => Promise<void>,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  let delay = 500;
  while (Date.now() < deadline) {
    try {
      await write();
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(publicPageCouldNotPublish);
    }
    if (await isPublicPageLive(slug)) return;
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.3), 2500);
  }
  throw new Error(publicPageCouldNotPublish);
}
