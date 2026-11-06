import { test as base, expect, type Page } from "@playwright/test";
import type { Gig } from "@showday/schemas";

export const test = base.extend<{
  account: {
    username: string;
    password: string;
    bandId: string;
    read: (path: string) => Promise<Record<string, unknown>>;
    exists: (path: string) => Promise<boolean>;
    seedGig: (gig: Partial<Gig> & Pick<Gig, "id" | "title">) => Promise<void>;
    seedVenue: (id: string, name: string) => Promise<void>;
    seedOtherBand: (id: string, name: string) => Promise<void>;
  };
}>({
  account: async ({ request }, use) => {
    const username = `e2e-${crypto.randomUUID()}`;
    const password = crypto.randomUUID();
    const response = await request.post("/api/auth/signup", {
      data: {
        username,
        password,
        email: `${username}@example.com`,
        bandName: "Touring Band",
        currency: "CZK",
      },
    });
    expect(response.ok()).toBe(true);
    const { token } = await response.json();
    const root = `/storage/storage/${username}/showday/bands/`;
    const headers = { Authorization: `Bearer ${token}` };
    const listing = await request.get(root, { headers });
    expect(listing.ok()).toBe(true);
    const bandId = Object.keys((await listing.json()).items)[0]?.replace(
      /\/$/,
      "",
    );
    expect(bandId).toBeTruthy();
    const path = `${root}${bandId}/`;
    async function put(kind: string, location: string, value: object) {
      const saved = await request.put(`${path}${location}`, {
        headers,
        data: {
          "@context": `http://remotestorage.io/spec/modules/showday/${kind}`,
          ...value,
        },
      });
      expect(saved.ok()).toBe(true);
    }
    await put("venue", "venues/club", {
      id: "club",
      name: "Test Club",
      address: "Main Street 12, Prague",
    });
    await put("contact", "contacts/promoter", {
      id: "promoter",
      name: "Jo",
      email: "jo@example.com",
      phone: "+420123456789",
    });
    await use({
      username,
      password,
      bandId: bandId as string,
      async read(location) {
        // Writes from the browser land asynchronously; retry briefly instead
        // of failing on a transient 404 or 5xx.
        for (let attempt = 0; attempt < 11; attempt++) {
          const result = await request.get(`${path}${location}`, { headers });
          if (result.ok()) {
            try {
              return await result.json();
            } catch {
              // A storage write can be in progress while the file is read.
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        throw new Error(`Could not read ${location} from storage`);
      },
      async exists(location) {
        const result = await request.get(`${path}${location}`, { headers });
        expect([200, 404]).toContain(result.status());
        return result.status() === 200;
      },
      async seedVenue(id, name) {
        await put("venue", `venues/${id}`, { id, name, address: "Prague" });
      },
      async seedOtherBand(id, name) {
        await put("otherBand", `otherBands/${id}`, {
          id,
          name,
          contactIds: [],
        });
      },
      async seedGig(gig) {
        await put("gig", `gigs/${gig.id}`, {
          date: "2030-06-20",
          status: "confirmed",
          venueId: "club",
          contactIds: ["promoter"],
          ...gig,
        });
      },
    });
    const logout = await request.post("/api/auth/logout", {
      headers,
      data: { username },
    });
    expect(logout.ok()).toBe(true);
  },
});
export { expect } from "@playwright/test";

/** Logs in through the form and waits for the bands to load. */
export async function login(
  page: Page,
  account: { username: string; password: string },
) {
  await page.goto("/login");
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  await page.getByLabel("Username", { exact: true }).fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByLabel("View band")).toBeVisible();
  await expect(page.getByText("Loading your bands…")).toHaveCount(0);
}
/** Goes to an app screen by its hash route, e.g. "band/settings". */
export async function go(page: Page, route: string) {
  await page.evaluate((hash) => {
    location.hash = hash;
  }, `/${route}`);
}
/** Opens a gig from the bookings list; on a phone it opens on its own screen. */
export async function openGig(page: Page, title: string) {
  await go(page, "bookings");
  // The list starts on upcoming gigs; played and cancelled ones are under Past.
  const link = page.getByRole("link", { name: new RegExp(title) }).first();
  await choose(page, "Show", "Upcoming");
  const upcoming = await link
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!upcoming) await choose(page, "Show", "Past");
  await link.click();
  await expect(
    page.getByRole("heading", { name: title, exact: true, level: 2 }),
  ).toBeVisible();
}
/** Picks an option in a segmented control (radios under the labels). */
export async function choose(page: Page, group: string, option: string) {
  await page
    .getByRole("radiogroup", { name: group, exact: true })
    .getByText(option, { exact: true })
    .click();
}
export const details = (page: Page) =>
  page.getByRole("region", { name: "Details" });
/** Money as the app shows it: no decimals for whole amounts or CZK. */
export const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    ...(currency === "CZK" || Number.isInteger(amount)
      ? { maximumFractionDigits: 0 }
      : {}),
  })
    .format(amount)
    .replace(/[\u00a0\u202f]/g, " ");
