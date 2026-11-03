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
