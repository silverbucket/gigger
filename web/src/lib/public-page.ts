/** Polls until the server's public route can load the band page (slug is claimed and storage has synced). */
export async function waitForLivePage(
  slug: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const path = `/b/${encodeURIComponent(slug)}/gigs.json`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(
    "The page is not live yet. Wait for sync to finish and try Save again.",
  );
}
