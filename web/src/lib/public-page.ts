/** Shown when automatic publish retries exhaust; no jargon. */
export const publicPageCouldNotPublish =
  "The public page could not be published. Try again.";
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
    await write();
    if (await isPublicPageLive(slug)) return;
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.3), 2500);
  }
  throw new Error(publicPageCouldNotPublish);
}
