import { expect, login, test } from "./fixtures";

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

test("a session revoked on the server asks to log in again instead of blaming the connection", async ({
  page,
  request,
  account,
}) => {
  await login(page, account);
  const token = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("remotestorage:wireclient") ?? "{}")
        .token as string | undefined,
  );
  expect(token).toBeTruthy();
  const revoked = await request.post("/api/auth/logout", {
    headers: { Authorization: `Bearer ${token}` },
    data: { username: account.username },
  });
  expect(revoked.ok()).toBe(true);

  await page.reload();
  await expect(
    page.getByText("Please log in again.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/connection/i)).toHaveCount(0);

  // Logging straight back in waits for the ended session to clear.
  await page.getByLabel("Username", { exact: true }).fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByLabel("View band")).toBeVisible();
  await expect(page.getByText("Please log in again.")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
