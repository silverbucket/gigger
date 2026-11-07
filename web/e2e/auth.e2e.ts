import { expect, go, login, logoutFromApp, test } from "./fixtures";

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

test("a revoked server token keeps the app signed in and unsynced changes stay local", async ({
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

  await go(page, "settings");
  const currency = page.getByLabel(/^Band currency/);
  const saveCurrency = page.getByRole("button", {
    name: "Save currency",
    exact: true,
  });
  await currency.fill("EUR");
  await expect(currency).toHaveValue("EUR");
  const storageRequests = "**/storage/storage/**";
  await page.route(storageRequests, (route) => route.fulfill({ status: 503 }));
  const pushed = page.waitForRequest(
    (sent) => sent.method() === "PUT" && sent.url().endsWith("/band"),
  );
  await saveCurrency.click();
  await pushed;
  await expect(saveCurrency).toBeEnabled();
  await expect(currency).toHaveValue("EUR");
  const revoked = await request.post("/api/auth/logout", {
    headers: { Authorization: `Bearer ${token}` },
    data: { username: account.username },
  });
  expect(revoked.ok()).toBe(true);

  await expect(page).not.toHaveURL(/\/login$/);
  await expect(page.getByText("Please log in again.")).toHaveCount(0);
  expect((await account.read("band")).currency).toBe("CZK");
  await expect(page.getByLabel(/^Band currency/)).toHaveValue("EUR");
  await page.unroute(storageRequests);
});

test("a reload while another tab blocks a logout's cleanup never opens the old cache for the next account", async ({
  page,
  context,
  request,
  account,
}) => {
  test.slow();
  await account.seedGig({ id: "secret", title: "Secret show" });
  await login(page, account);
  await go(page, "bookings");
  await expect(
    page.getByRole("link", { name: /Secret show/ }).first(),
  ).toBeVisible();

  // Another tab holding the cache open keeps the logout from deleting it.
  const holder = await context.newPage();
  await holder.route("**/other-tab", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Other tab</title>",
    }),
  );
  await holder.goto("/other-tab");
  await holder.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open("remotestorage");
        opening.onsuccess = () => {
          // Kept reachable: a collected connection would be closed.
          Object.assign(globalThis, { cache: opening.result });
          resolve();
        };
        opening.onerror = () => reject(opening.error);
      }),
  );
  await logoutFromApp(page);
  await page.reload();
  await holder.close();

  const other = {
    username: `e2e-${crypto.randomUUID()}`,
    password: crypto.randomUUID(),
  };
  const signedUp = await request.post("/api/auth/signup", {
    data: {
      ...other,
      email: `${other.username}@example.com`,
      bandName: "Second Band",
      currency: "CZK",
    },
  });
  expect(signedUp.ok()).toBe(true);
  await page.getByLabel("Username", { exact: true }).fill(other.username);
  await page.getByLabel("Password", { exact: true }).fill(other.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByLabel("View band").locator("option")).toHaveText([
    "All bands",
    "Second Band",
  ]);
  await go(page, "bookings");
  await expect(
    page.getByRole("link", { name: "New enquiry", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Secret show")).toHaveCount(0);
});
