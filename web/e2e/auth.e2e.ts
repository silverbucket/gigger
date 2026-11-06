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
