import { expect, test } from "@playwright/test";

test("signup rejects invalid inputs and succeeds after correcting them", async ({
  page,
}) => {
  await page.goto("/signup");
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  const username = page.getByLabel("Username", { exact: true });
  const email = page.getByLabel("Email", { exact: true });
  const password = page.getByLabel("Password", { exact: true });
  await username.fill("bad username");
  await email.fill("not-an-email");
  await password.fill("short");
  await page.getByLabel("Band name", { exact: true }).fill("Signup Band");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect
    .poll(() =>
      username.evaluate(
        (input: HTMLInputElement) => input.validity.patternMismatch,
      ),
    )
    .toBe(true);
  await username.fill(`browser-${crypto.randomUUID()}`);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect
    .poll(() =>
      email.evaluate((input: HTMLInputElement) => input.validity.typeMismatch),
    )
    .toBe(true);
  await email.fill(`browser-${crypto.randomUUID()}@example.com`);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect
    .poll(() =>
      password.evaluate((input: HTMLInputElement) => input.validity.tooShort),
    )
    .toBe(true);
  await expect(page.getByLabel("Band name", { exact: true })).toHaveValue(
    "Signup Band",
  );
  await password.fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByLabel("View band").selectOption({ label: "Signup Band" });
  await expect(
    page.getByRole("heading", { name: "Signup Band", exact: true, level: 2 }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Log out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toBeVisible();
});
