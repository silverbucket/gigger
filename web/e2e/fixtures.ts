import type { Gig } from "@gigger/schemas";
import { test as base, expect } from "@playwright/test";

export const test = base.extend<{
  account: {
    username: string;
    password: string;
    bandId: string;
    read: (path: string) => Promise<Record<string, unknown>>;
    seedGig: (gig: Partial<Gig> & Pick<Gig, "id" | "title">) => Promise<void>;
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
      },
    });
    expect(response.ok()).toBe(true);
    const { token } = await response.json();
    const root = `/storage/storage/${username}/gigger/bands/`;
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
          "@context": `http://remotestorage.io/spec/modules/gigger/${kind}`,
          ...value,
        },
      });
      expect(saved.ok()).toBe(true);
    }
    await put("band", "band", {
      id: bandId,
      name: "Touring Band",
      currency: "CZK",
    });
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
        const result = await request.get(`${path}${location}`, { headers });
        expect(result.ok()).toBe(true);
        return result.json();
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
