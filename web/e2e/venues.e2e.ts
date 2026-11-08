import {
  choose,
  details,
  expect,
  go,
  login,
  logoutFromApp,
  test,
} from "./fixtures";

test("a venue one band adds is offered to another band, with its country", async ({
  page,
  account,
  request,
}) => {
  const hall = `Hall ${crypto.randomUUID().slice(0, 8)}`;
  await login(page, account);
  await go(page, "bookings/new");
  await choose(page, "Source", "Email");
  await page.getByLabel("Proposed gig date").fill("2031-05-02");
  await page.getByRole("combobox", { name: "Venue" }).fill(hall);
  await page.getByRole("option", { name: `+ Create “${hall}”` }).click();
  await page.getByLabel("Address").fill("Torstraße 1");
  await page.getByLabel("City").fill("Berlin");
  await page.getByLabel("Country").selectOption("DE");
  await page.getByRole("button", { name: "Save gig" }).click();
  await expect(
    page.getByRole("heading", { name: hall, level: 2 }),
  ).toBeVisible();
  // Its own venue is not offered back to the band as a shared one.
  await go(page, "bookings/new");
  await page.getByRole("combobox", { name: "Venue" }).fill(hall);
  await expect(
    page.getByRole("option", { name: new RegExp(`^${hall}`) }),
  ).toHaveCount(1);
  await expect(page.getByRole("option", { name: /Shared/ })).toHaveCount(0);
  await go(page, "bookings");
  await logoutFromApp(page);

  const other = {
    username: `e2e-${crypto.randomUUID()}`,
    password: "other-band-pw",
  };
  const signup = await request.post("/api/auth/signup", {
    data: {
      ...other,
      email: `${other.username}@example.com`,
      bandName: "Other Band",
      currency: "EUR",
    },
  });
  expect(signup.ok()).toBe(true);
  await login(page, other);
  await go(page, "bookings/new");
  await choose(page, "Source", "Email");
  await page.getByLabel("Proposed gig date").fill("2031-06-02");
  await page.getByRole("combobox", { name: "Venue" }).fill(hall.slice(0, 8));
  const offered = page.getByRole("option", { name: new RegExp(`^${hall}`) });
  await expect(offered).toContainText("Shared");
  await offered.click();
  await expect(page.getByLabel("Venue name")).toHaveValue(hall);
  await expect(page.getByLabel("Address")).toHaveValue("Torstraße 1");
  await expect(page.getByLabel("City")).toHaveValue("Berlin");
  await expect(page.getByLabel("Country")).toHaveValue("DE");
  await page.getByRole("button", { name: "Save gig" }).click();
  await expect(
    page.getByRole("heading", { name: hall, level: 2 }),
  ).toBeVisible();
  await expect(
    details(page).getByText("Torstraße 1, Berlin, Germany"),
  ).toBeVisible();
});

test("a private show takes an address instead of a venue and stays off the public page", async ({
  page,
  account,
}) => {
  await login(page, account);
  await go(page, "bookings/new");
  await choose(page, "Source", "Messenger");
  await page.getByLabel("Proposed gig date").fill("2031-07-04");
  await choose(page, "Where", "Private show");
  await expect(page.getByRole("combobox", { name: "Venue" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save gig" }).click();
  await expect(page.getByRole("alert")).toContainText("Address");
  await page.getByLabel("Address").fill("Na Kampě 7, Praha\nRing twice");
  await page.getByRole("button", { name: "Save gig" }).click();
  await expect(
    page.getByRole("heading", { name: "Private show", level: 2 }),
  ).toBeVisible();
  await expect(details(page).getByText(/Ring twice/)).toBeVisible();
  await expect(
    page.getByText("Private shows are never listed there."),
  ).toBeVisible();
  const id = new URL(page.url()).hash.split("/").pop() as string;
  const gig = await account.read(`gigs/${id}`);
  expect(gig).toMatchObject({
    privateShow: true,
    address: "Na Kampě 7, Praha\nRing twice",
  });
  expect(gig.venueId).toBeUndefined();
});
