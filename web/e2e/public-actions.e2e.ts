import type { Page } from "@playwright/test";
import { expect, go, login, test } from "./fixtures";

/** Desktop shows the public page beside the members on the plain band route. */
async function openEditor(page: Page) {
  const width = page.viewportSize()?.width ?? 1280;
  await go(page, width < 900 ? "band/public" : "band");
  await expect(
    page.getByRole("textbox", { name: "Page address" }),
  ).toBeVisible();
}

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const link = (page: Page, name: string) =>
  page.getByRole("link", { name, exact: true });

async function expectNotLive(page: Page) {
  await expect(page.getByText("Not published", { exact: true })).toBeVisible();
  await expect(button(page, "Publish")).toBeVisible();
  await expect(button(page, "Save")).toHaveCount(0);
  await expect(button(page, "Unpublish")).toHaveCount(0);
  await expect(link(page, "Open page")).toHaveCount(0);
  await expect(link(page, "Export static page (.zip)")).toHaveCount(0);
}

async function expectLive(page: Page) {
  await expect(button(page, "Save")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await expect(button(page, "Publish")).toHaveCount(0);
  await expect(button(page, "Unpublish")).toBeVisible();
  await expect(link(page, "Open page")).toBeVisible();
  await expect(link(page, "Export static page (.zip)")).toBeVisible();
}

test("Publish becomes Save with Unpublish, Open page and Export, and Unpublish reverts it", async ({
  page,
  account,
  request,
}) => {
  await account.seedGig({ id: "listed", title: "Listed show" });
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });
  await login(page, account);
  await openEditor(page);
  await expectNotLive(page);
  await expect(button(page, "Cancel")).toHaveCount(0);

  const slug = `live-${account.username.slice(4, 12)}`;
  await page.getByRole("textbox", { name: "Page address" }).fill(slug);
  await expect(button(page, "Cancel")).toBeVisible();
  await button(page, "Publish").click();
  await expectLive(page);
  await expect(page.getByText("1 gig listed", { exact: true })).toBeVisible();
  await expect(button(page, "Cancel")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(link(page, "Open page")).toHaveAttribute("target", "_blank");
  expect((await request.get(`/b/${slug}`)).status()).toBe(200);
  // The live state must survive the reload and recheck that follow a publish.
  await page.waitForTimeout(2000);
  await expectLive(page);

  const address = page.getByRole("textbox", { name: "Page address" });
  await address.fill(`${slug}-new`);
  await expect(
    page.getByText("Your old address will stop working.", { exact: true }),
  ).toBeVisible();
  await button(page, "Cancel").click();
  await expect(address).toHaveValue(slug);
  await expect(
    page.getByText("Your old address will stop working.", { exact: true }),
  ).toHaveCount(0);

  const bio = page.getByRole("textbox", { name: "Bio" });
  await bio.fill("Cancelled bio text");
  await expect(button(page, "Cancel")).toBeVisible();
  await button(page, "Cancel").click();
  await expect(bio).toHaveValue("");
  await expect(button(page, "Cancel")).toHaveCount(0);
  await expectLive(page);
  expect((await request.get(`/b/${slug}`)).status()).toBe(200);
  expect(await (await request.get(`/b/${slug}`)).text()).not.toContain(
    "Cancelled bio text",
  );

  await bio.fill("Loud and late");
  await button(page, "Save").click();
  await expectLive(page);
  await expect
    .poll(async () => (await request.get(`/b/${slug}`)).text(), {
      timeout: 30000,
    })
    .toContain("Loud and late");
  expect((await request.get(`/b/${slug}/gigs.json`)).status()).toBe(200);
  await expect(button(page, "Cancel")).toHaveCount(0);

  await button(page, "Unpublish").click();
  await expectNotLive(page);
  expect(dialogs).toContain("Take this public page down?");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(async () => (await request.get(`/b/${slug}`)).status())
    .toBe(404);
  expect(await (await request.get(`/b/${slug}`)).text()).toContain(
    "This band has no public page.",
  );
  await page.waitForTimeout(2000);
  await expectNotLive(page);
});

test("a stored slug whose public URL still 404s shows Not published and Publish", async ({
  page,
  account,
  request,
}) => {
  const slug = `ghost-${account.username.slice(4, 12)}`;
  await account.storeSlug(slug);
  expect((await request.get(`/b/${slug}`)).status()).toBe(404);
  await login(page, account);
  await openEditor(page);
  await expect(page.getByRole("textbox", { name: "Page address" })).toHaveValue(
    slug,
  );
  await page.waitForTimeout(1000);
  await expectNotLive(page);
  await expect(
    page.getByText("Your old address will stop working."),
  ).toHaveCount(0);
});
