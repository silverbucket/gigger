import { expect, go, login, openGig, test } from "./fixtures";

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
  page.on("dialog", (dialog) => dialog.accept());
  await login(page, account);
  await go(page, "band/public");
  const slug = `touring-${account.username.slice(4, 12)}`;
  const address = page.getByRole("textbox", { name: "Page address" });
  await expect(address).toHaveValue("touring-band");
  await address.fill(slug);
  await expect(address).toHaveValue(slug);
  const publish = page.getByRole("button", {
    name: "Publish",
    exact: true,
  });
  await publish.click();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("link", { name: "Open page", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open page", exact: true }),
  ).toHaveAttribute("href", `${new URL(page.url()).origin}/b/${slug}`);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const publicPath = `/storage/storage/${account.username}/public/showday/${slug}/`;
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
  const loginResponse = await request.post("/api/auth/login", {
    data: { username: account.username, password: account.password },
  });
  const { token } = await loginResponse.json();
  const malformed = await request.put(`${publicPath}gigs/broken`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    data: "not json",
  });
  expect(malformed.ok()).toBe(true);
  const html = await (await request.get(`/b/${slug}`)).text();
  expect(html).toContain("Touring Band");
  expect(html).toContain("All ages");
  expect(html).not.toMatch(/5000|Dinner|side entrance|Prague show|promoter/i);
  const ics = await (await request.get(`/b/${slug}/gigs.ics`)).text();
  expect(ics).toContain("UID:prague@");
  expect(ics).not.toMatch(/5000|Dinner|side entrance/i);
  await openGig(page, "Prague show");
  await page.getByRole("button", { name: "Cancel gig", exact: true }).click();
  await expect
    .poll(async () => (await request.get(`${publicPath}gigs/prague`)).status())
    .toBe(404);
  await expect
    .poll(
      async () =>
        JSON.parse(await (await request.get(`/b/${slug}/gigs.json`)).text())
          .gigs.length,
      { timeout: 30000 },
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
  const open = async (tab: typeof page) => {
    tab.on("dialog", (dialog) => dialog.accept());
    await login(tab, account);
  };
  await open(page);
  await go(page, "band/public");
  const slug = `test-${account.username.slice(4, 12)}`;
  const address = page.getByRole("textbox", { name: "Page address" });
  await address.fill(slug);
  await expect(address).toHaveValue(slug);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Open page", exact: true }),
  ).toBeVisible({ timeout: 30000 });
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
    await open(other);
    await openGig(other, "Second show");
    await second.setOffline(true);
    await other
      .getByRole("button", { name: "Cancel gig", exact: true })
      .click();
    await expect(
      other.getByText(/public gig removal is waiting to sync/),
    ).toBeVisible();
    await openGig(page, "First show");
    await page.getByRole("button", { name: "Cancel gig", exact: true }).click();
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
