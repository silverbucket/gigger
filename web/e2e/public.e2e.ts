import { expect, test } from "./fixtures";

test("publishing a page copies only public gig fields and the page serves them", async ({
  page,
  account,
  request,
}) => {
  await account.seedGig({
    id: "prague",
    title: "Prague show",
    setTimes: ["20:00"],
    fee: { amount: 5000, currency: "CZK", extras: ["Dinner"] },
    notes: "Use the side entrance",
    public: { ticketUrl: "https://tickets.example/p", description: "All ages" },
  });
  await account.seedGig({
    id: "maybe",
    title: "Maybe show",
    status: "offered",
  });
  await page.goto("/login");
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  await page.getByLabel("Username", { exact: true }).fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByLabel("View band").selectOption(account.bandId);
  const slug = `touring-${account.username.slice(4, 12)}`;
  const address = page.getByRole("textbox", { name: "Page address" });
  await expect(address).toHaveValue("touring-band");
  await address.fill(slug);
  await page.getByRole("button", { name: "Publish page", exact: true }).click();
  await expect(
    page.getByRole("link", { name: `${new URL(page.url()).origin}/b/${slug}` }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const publicPath = `/storage/storage/${account.username}/public/gigger/${slug}/`;
  await expect
    .poll(async () => (await request.get(`${publicPath}gigs/prague`)).status())
    .toBe(200);
  const copy = await (await request.get(`${publicPath}gigs/prague`)).text();
  expect(JSON.parse(copy)).toMatchObject({
    date: "2030-06-20",
    start: "20:00",
    venue: "Test Club",
    ticketUrl: "https://tickets.example/p",
  });
  expect(copy).not.toMatch(/5000|Dinner|side entrance|Prague show|promoter/i);
  expect((await request.get(`${publicPath}gigs/maybe`)).status()).toBe(404);
  await expect
    .poll(async () => (await request.get(`/b/${slug}`)).status())
    .toBe(200);
  const html = await (await request.get(`/b/${slug}`)).text();
  expect(html).toContain("Touring Band");
  expect(html).toContain("All ages");
  expect(html).not.toMatch(/5000|Dinner|side entrance|Prague show|promoter/i);
  const ics = await (await request.get(`/b/${slug}/gigs.ics`)).text();
  expect(ics).toContain("UID:prague@");
  expect(ics).not.toMatch(/5000|Dinner|side entrance/i);
  await page.getByRole("button", { name: /2030-06-20 · Prague show/ }).click();
  await page
    .getByRole("button", { name: "Mark cancelled", exact: true })
    .click();
  await expect
    .poll(async () => (await request.get(`${publicPath}gigs/prague`)).status())
    .toBe(404);
  await expect
    .poll(
      async () =>
        JSON.parse(await (await request.get(`/b/${slug}/gigs.json`)).text())
          .gigs.length,
    )
    .toBe(0);
});

test("separate sessions preserve independent removals and sync an offline cancellation", async ({
  page,
  browser,
  account,
  request,
}) => {
  await account.seedGig({ id: "one", title: "First show" });
  await account.seedGig({ id: "two", title: "Second show" });
  const login = async (tab: typeof page) => {
    await tab.goto("/login");
    await expect(tab.getByText("Loading…", { exact: true })).toHaveCount(0);
    await tab.getByLabel("Username", { exact: true }).fill(account.username);
    await tab.getByLabel("Password", { exact: true }).fill(account.password);
    await tab.getByRole("button", { name: "Log in", exact: true }).click();
    await tab.getByLabel("View band").selectOption(account.bandId);
  };
  await login(page);
  const slug = `test-${account.username.slice(4, 12)}`;
  await page.getByRole("textbox", { name: "Page address" }).fill(slug);
  await page.getByRole("button", { name: "Publish page", exact: true }).click();
  const gigIds = async () => {
    const response = await request.get(`/b/${slug}/gigs.json`);
    if (!response.ok()) return null;
    return (await response.json()).gigs
      .map((gig: { id: string }) => gig.id)
      .sort();
  };
  await expect.poll(gigIds).toEqual(["one", "two"]);
  const second = await browser.newContext();
  try {
    const other = await second.newPage();
    await login(other);
    await other
      .getByRole("button", { name: /2030-06-20 · Second show/ })
      .click();
    await second.setOffline(true);
    await other
      .getByRole("button", { name: "Mark cancelled", exact: true })
      .click();
    await expect(
      other.getByText(/public gig removal is waiting to sync/),
    ).toBeVisible();
    await page.getByRole("button", { name: /2030-06-20 · First show/ }).click();
    await page
      .getByRole("button", { name: "Mark cancelled", exact: true })
      .click();
    await expect.poll(gigIds).toEqual(["two"]);
    await second.setOffline(false);
    await expect.poll(gigIds, { timeout: 30000 }).toEqual([]);
    await expect(
      other.getByText(/public gig removal is waiting to sync/),
    ).toHaveCount(0, { timeout: 30000 });
    expect(
      (
        await request.post("/api/public-gigs", {
          data: { username: account.username, slug },
        })
      ).status(),
    ).toBe(404);
  } finally {
    await second.close();
  }
});
