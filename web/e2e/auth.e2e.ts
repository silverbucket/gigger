import { expect, go, login, test } from "./fixtures";

test("local username login opens the app without an authorization prompt", async ({
  page,
  account,
}) => {
  const authorizationRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/storage/oauth"))
      authorizationRequests.push(request.url());
  });
  await login(page, account);
  await page.reload();
  await expect(page.getByLabel("View band")).toBeVisible();
  expect(authorizationRequests).toEqual([]);
});

test("a session revoked on the server asks to log in again and keeps changes that had not synced", async ({
  page,
  request,
  account,
}) => {
  test.slow();
  await login(page, account);
  const token = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("remotestorage:wireclient") ?? "{}")
        .token as string | undefined,
  );
  expect(token).toBeTruthy();

  await go(page, "band/settings");
  await page.getByLabel(/^Band currency/).fill("EUR");
  // Storage is down when the change is saved, so it waits in this browser.
  const storageRequests = "**/storage/storage/**";
  await page.route(storageRequests, (route) => route.fulfill({ status: 503 }));
  const pushed = page.waitForRequest(
    (sent) => sent.method() === "PUT" && sent.url().endsWith("/band"),
  );
  await page
    .getByRole("button", { name: "Save currency", exact: true })
    .click();
  await pushed;
  const revoked = await request.post("/api/auth/logout", {
    headers: { Authorization: `Bearer ${token}` },
    data: { username: account.username },
  });
  expect(revoked.ok()).toBe(true);
  await page.unroute(storageRequests);

  // The next sync attempt meets the revoked token.
  await expect(
    page.getByText("Please log in again.", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/connection/i)).toHaveCount(0);
  expect((await account.read("band")).currency).toBe("CZK");

  await page.getByLabel("Username", { exact: true }).fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByLabel("View band")).toBeVisible();
  await expect
    .poll(async () => (await account.read("band")).currency, { timeout: 15000 })
    .toBe("EUR");
  await expect(page.getByText("Please log in again.")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
