import type { APIRequestContext, Page } from "@playwright/test";
import { conversationId, type Message, messagePath } from "@showday/schemas";
import { expect, go, login, test } from "./fixtures";

const messageBody = (page: Page) => page.locator(".body .pre");
const messageHeader = (page: Page) => page.locator(".detail-head .muted");

async function seedInboxEmail(
  request: APIRequestContext,
  account: { username: string; bandId: string },
  token: string,
  content: string,
  subject: string,
) {
  const peer = `promoter-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const conversation = conversationId("email", account.bandId, peer);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const root = `/storage/storage/${account.username}/showday/`;
  const message = {
    "@context": "http://remotestorage.io/spec/modules/showday/message",
    id: `msg-${crypto.randomUUID()}`,
    channel: "email",
    direction: "in",
    conversation,
    bandId: account.bandId,
    actor: { id: peer, name: "Promoter" },
    target: { id: `${account.username}@example.com` },
    object: { type: "Note", content },
    published: new Date().toISOString(),
  };
  const saved = await request.put(`${root}${messagePath(message)}`, {
    headers,
    data: message,
  });
  expect(saved.ok()).toBe(true);
  const indexed = await request.put(`${root}conversations/index`, {
    headers: { ...headers, "If-Match": "*" },
    data: {
      "@context": "http://remotestorage.io/spec/modules/showday/conversations",
      [conversation]: {
        bandId: account.bandId,
        channel: "email",
        peer: message.actor,
        lastIn: message.published,
        preview: content.slice(0, 80),
        subject,
      },
    },
  });
  expect([200, 201, 412]).toContain(indexed.status());
  return { conversation, peer, message, root, headers };
}

test.describe("inbox email translation", () => {
  test("desktop message detail shows translation controls and states", async ({
    page,
    request,
    account,
  }) => {
    const signup = await request.post("/api/auth/login", {
      data: { username: account.username, password: account.password },
    });
    const { token } = await signup.json();
    const czech =
      "Dobrý den, nabízíme koncert 12. června v Praze. Termín by nám vyhovoval.";
    const { conversation } = await seedInboxEmail(
      request,
      account,
      token,
      czech,
      "Nabídka koncertu",
    );
    await login(page, account);
    await page.goto(`/#/bookings/message/${conversation}`);
    await expect(
      page.getByRole("button", { name: "Show in English" }),
    ).toBeVisible();
    await expect(page.getByText("Nabídka koncertu")).toBeVisible();
    await page.getByRole("button", { name: "Show in English" }).click();
    await expect(
      page.getByRole("radiogroup", { name: "Message language" }),
    ).toBeVisible();
    await expect(page.getByText("Original", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "Check names, dates, venues, and amounts in the original.",
      ),
    ).toBeVisible({ timeout: 15000 });
    await expect(messageBody(page)).toContainText(/In English:/);
    await expect(messageHeader(page)).toContainText(/In English:/);
    await page
      .getByRole("radiogroup", { name: "Message language" })
      .getByText("Original", { exact: true })
      .click();
    await expect(messageBody(page)).toContainText(czech);
    await page
      .getByRole("radiogroup", { name: "Message language" })
      .getByText("English", { exact: true })
      .click();
    await expect(messageBody(page)).toContainText(/In English:/);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Show in English" }),
    ).toBeVisible();
    await expect(messageBody(page)).toContainText(czech);
  });

  test("translated view survives background thread refresh", async ({
    page,
    request,
    account,
  }) => {
    const signup = await request.post("/api/auth/login", {
      data: { username: account.username, password: account.password },
    });
    const { token } = await signup.json();
    const czech =
      "Dobrý den, nabízíme koncert 12. června v Praze. Termín by nám vyhovoval.";
    const seeded = await seedInboxEmail(
      request,
      account,
      token,
      czech,
      "Nabídka koncertu",
    );
    await login(page, account);
    await page.goto(`/#/bookings/message/${seeded.conversation}`);
    await page.getByRole("button", { name: "Show in English" }).click();
    await expect(messageBody(page)).toContainText(/In English:/, {
      timeout: 15000,
    });
    const language = page.getByRole("radiogroup", {
      name: "Message language",
    });
    await expect(
      language.getByRole("radio", { name: "English", exact: true }),
    ).toBeChecked();
    const freshMessage: Message = {
      ...(seeded.message as Message),
      published: new Date().toISOString(),
    };
    await request.put(`${seeded.root}${messagePath(freshMessage)}`, {
      headers: seeded.headers,
      data: freshMessage,
    });
    await expect
      .poll(() => messageBody(page).textContent(), { timeout: 30000 })
      .toMatch(/In English:/);
    await expect(
      language.getByRole("radio", { name: "English", exact: true }),
    ).toBeChecked();
    await expect(messageHeader(page)).toContainText(/In English:/);
  });

  test("reopening a message applies session cache on the first action", async ({
    page,
    request,
    account,
  }) => {
    const signup = await request.post("/api/auth/login", {
      data: { username: account.username, password: account.password },
    });
    const { token } = await signup.json();
    const czech =
      "Dobrý den, nabízíme koncert 12. června v Praze. Termín by nám vyhovoval.";
    const { conversation } = await seedInboxEmail(
      request,
      account,
      token,
      czech,
      "Nabídka koncertu",
    );
    await login(page, account);
    await page.goto(`/#/bookings/message/${conversation}`);
    await page.getByRole("button", { name: "Show in English" }).click();
    await expect(messageBody(page)).toContainText(/In English:/, {
      timeout: 15000,
    });
    const language = page.getByRole("radiogroup", {
      name: "Message language",
    });
    await expect(
      language.getByRole("radio", { name: "English", exact: true }),
    ).toBeChecked();
    await go(page, "bookings");
    await expect(page).toHaveURL(/#\/bookings$/);
    await page
      .getByRole("link", { name: /Promoter/i })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Show in English" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show in English" }).click();
    const languageAgain = page.getByRole("radiogroup", {
      name: "Message language",
    });
    await expect(
      languageAgain.getByRole("radio", { name: "English", exact: true }),
    ).toBeChecked({ timeout: 2000 });
    await expect(messageBody(page)).toContainText(/In English:/);
    await expect(
      messageBody(page).getByText(czech, { exact: true }),
    ).not.toBeVisible();
  });

  test("phone full-screen message uses a full-width two-segment control", async ({
    page,
    request,
    account,
  }) => {
    test.skip(
      test.info().project.name !== "mobile-webkit",
      "layout check is for the phone project",
    );
    const signup = await request.post("/api/auth/login", {
      data: { username: account.username, password: account.password },
    });
    const { token } = await signup.json();
    const english = "Hello, we would like to book your band for a concert.";
    const { conversation } = await seedInboxEmail(
      request,
      account,
      token,
      english,
      "Booking enquiry",
    );
    await login(page, account);
    await page.goto(`/#/bookings/message/${conversation}`);
    const group = page.getByRole("radiogroup", { name: "Message language" });
    await expect(
      page.getByRole("button", { name: "Show in Čeština" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show in Čeština" }).click();
    await expect(group).toBeVisible();
    await expect(group).toHaveCSS("display", "grid");
    await expect(group.locator("label")).toHaveCount(2);
    const height = await group
      .locator("label")
      .first()
      .evaluate((node) => node.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);
  });
});
