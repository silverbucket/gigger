import type { Page } from "@playwright/test";
import { choose, expect, go, login, test } from "./fixtures";

test.beforeEach(async ({ page, account }) => {
  await login(page, account);
});

async function startGig(page: Page) {
  await go(page, "bookings/new");
  await page.getByLabel("Proposed gig date").fill("2031-05-02");
  await page.getByRole("combobox", { name: "Venue" }).fill("Test");
  await page.getByRole("option", { name: /Test Club/ }).click();
}

test("saving without a source says what is missing", async ({ page }) => {
  await startGig(page);
  await page.getByRole("button", { name: "Save gig" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("To save, check: Source.");
  await expect(alert).toBeInViewport();
  await expect(
    page.getByRole("radiogroup", { name: "Source" }),
  ).toBeInViewport();
  await expect(page.getByLabel("Proposed gig date")).toHaveValue("2031-05-02");
  await choose(page, "Source", "Email");
  await expect(alert).toHaveCount(1);
  await page.getByRole("button", { name: "Save gig" }).click();
  await expect(
    page.getByRole("heading", { name: "Test Club", level: 2 }),
  ).toBeVisible();
});

test("a typed venue that was not picked is named, and an exact name counts", async ({
  page,
}) => {
  await go(page, "bookings/new");
  await choose(page, "Source", "Email");
  await page.getByLabel("Proposed gig date").fill("2031-05-02");
  const venue = page.getByRole("combobox", { name: "Venue" });
  await venue.fill("Nowhere");
  await page.getByRole("button", { name: "Save gig" }).click();
  await expect(page.getByRole("alert")).toContainText("Choose “Nowhere”");
  await venue.fill("test club");
  await page.getByRole("button", { name: "Save gig" }).click();
  await expect(
    page.getByRole("heading", { name: "Test Club", level: 2 }),
  ).toBeVisible();
  // A picked venue whose text is then changed is no longer picked.
  await go(page, "bookings/new");
  await choose(page, "Source", "Email");
  await page.getByLabel("Proposed gig date").fill("2031-06-02");
  await venue.fill("Test");
  await page.getByRole("option", { name: /Test Club/ }).click();
  await venue.fill("Elsewhere");
  await page.getByRole("button", { name: "Save gig" }).click();
  await expect(page.getByRole("alert")).toContainText("Choose “Elsewhere”");
  await venue.fill("Test Club");
  await page.getByRole("button", { name: "Save gig" }).click();
  await expect(
    page.getByRole("heading", { name: "Test Club", level: 2 }),
  ).toBeVisible();
});

test("a new gig keeps what was typed after leaving, and takes the venue name as title", async ({
  page,
  account,
}) => {
  await startGig(page);
  await choose(page, "Source", "Instagram");
  await go(page, "contacts");
  await go(page, "bookings/new");
  await expect(
    page.getByText("Restored what you typed earlier."),
  ).toBeVisible();
  await expect(page.getByLabel("Proposed gig date")).toHaveValue("2031-05-02");
  await expect(page.getByRole("combobox", { name: "Venue" })).toHaveValue(
    "Test Club",
  );
  await page.getByRole("button", { name: "Save gig" }).click();
  await expect(
    page.getByRole("heading", { name: "Test Club", level: 2 }),
  ).toBeVisible();
  const id = decodeURIComponent(page.url().split("/").pop() ?? "");
  const gig = await account.read(`gigs/${id}`);
  expect(gig.title).toBe("Test Club");
  expect(gig.enquirySource).toBe("instagram");
  await go(page, "bookings/new");
  await expect(page.getByText("Restored what you typed earlier.")).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Proposed gig date")).toHaveValue("");
});

test("venues keep a website, email and phone", async ({ page, account }) => {
  await go(page, "venues/club/edit");
  await page.getByLabel("Website").fill("testclub.cz");
  await page.getByLabel("Email", { exact: true }).fill("booking@testclub.cz");
  await page.getByLabel("Phone").fill("+420 123 456 789");
  await page.getByRole("button", { name: "Save venue" }).click();
  await expect(
    page.getByRole("link", { name: "testclub.cz", exact: true }),
  ).toHaveAttribute("href", "https://testclub.cz");
  await expect
    .poll(async () => (await account.read("venues/club")).website)
    .toBe("https://testclub.cz");
  const venue = await account.read("venues/club");
  expect(venue.email).toBe("booking@testclub.cz");
  expect(venue.phone).toBe("+420 123 456 789");
});
