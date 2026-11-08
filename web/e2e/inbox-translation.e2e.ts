import type { APIRequestContext, Page } from "@playwright/test";
import { conversationId, type Message, messagePath } from "@showday/schemas";
import { expect, go, login, test } from "./fixtures";

const messageBody = (page: Page) => page.locator(".bubble.latest .text > .pre");
const messageHeader = (page: Page) => page.locator(".conv-head .subject");
const messageKicker = (page: Page) => page.locator(".conv-head .when");

/** Same formatting as `messageTimeLong` in the open message header (en-GB). */
function formatMessageKickerTime(iso: string): string {
  const at = new Date(iso);
  const dateLocale = "en-GB";
  const time = at.toLocaleTimeString(dateLocale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const day = (d: Date) => d.toLocaleDateString("en-CA");
  if (day(at) === day(new Date())) return `Today ${time}`;
  return `${at.toLocaleDateString(dateLocale, { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

async function bumpConversationLastIn(
  request: APIRequestContext,
  seeded: {
    root: string;
    headers: Record<string, string>;
    conversation: string;
  },
  lastIn: string,
) {
  const indexUrl = `${seeded.root}conversations/index`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const got = await request.get(indexUrl, { headers: seeded.headers });
    expect(got.ok()).toBe(true);
    const etag = got.headers().etag;
    const index = (await got.json()) as Record<string, unknown>;
    const entry = index[seeded.conversation] as Record<string, unknown>;
    const updated = await request.put(indexUrl, {
      headers: {
        ...seeded.headers,
        ...(etag ? { "If-Match": etag } : { "If-Match": "*" }),
      },
      data: {
        ...index,
        [seeded.conversation]: { ...entry, lastIn },
      },
    });
    if ([200, 201].includes(updated.status())) return;
    expect(updated.status()).toBe(412);
  }
  throw new Error("Could not bump conversation lastIn");
}

async function pullRemoteInboxRefresh(page: Page) {
  const ok = await page.evaluate(async () => {
    const run = window.showdaySyncUntilCompleteForLocalE2E?.();
    if (!run) return false;
    await run;
    return true;
  });
  expect(ok).toBe(true);
}

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
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "desktop layout and reload check",
    );
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
    await page.goto(`/#/inbox/${conversation}`);
    await expect(
      page.getByRole("button", { name: "Show in English" }),
    ).toBeVisible();
    await expect(messageHeader(page)).toHaveText("Nabídka koncertu");
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
    await expect(messageBody(page)).toContainText(czech, { timeout: 15000 });
    await expect(
      page.getByRole("button", { name: "Show in English" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("translated view survives background thread refresh", async ({
    page,
    request,
    account,
  }) => {
    test.setTimeout(90_000);
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
    await page.goto(`/#/inbox/${seeded.conversation}`);
    await page.getByRole("button", { name: "Show in English" }).click();
    await expect(messageBody(page)).toContainText(/In English:/, {
      timeout: 15000,
    });
    const language = page.getByRole("radiogroup", {
      name: "Message language",
    });
    await expect(
      language.getByRole("radio", { name: "English", exact: true }),
    ).toBeChecked({ timeout: 15000 });
    const initialKicker = (await messageKicker(page).textContent()) ?? "";
    const refreshedAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const kickerAfterRefresh = await page.evaluate(
      formatMessageKickerTime,
      refreshedAt,
    );
    const freshMessage: Message = {
      ...(seeded.message as Message),
      published: refreshedAt,
    };
    await request.put(`${seeded.root}${messagePath(freshMessage)}`, {
      headers: seeded.headers,
      data: freshMessage,
    });
    await bumpConversationLastIn(request, seeded, refreshedAt);
    await pullRemoteInboxRefresh(page);
    await expect
      .poll(
        async () => {
          const kickerText = (await messageKicker(page).textContent()) ?? "";
          if (kickerText === initialKicker) return false;
          if (!kickerText.includes(kickerAfterRefresh)) return false;
          const group = page.getByRole("radiogroup", {
            name: "Message language",
          });
          if ((await group.count()) === 0) return false;
          const english = group.getByRole("radio", {
            name: "English",
            exact: true,
          });
          if (!(await english.isChecked())) return false;
          const body = (await messageBody(page).textContent()) ?? "";
          if (!/In English:/.test(body)) return false;
          const header = (await messageHeader(page).textContent()) ?? "";
          return /In English:/.test(header);
        },
        { timeout: 30000 },
      )
      .toBe(true);
    await expect(messageBody(page)).toHaveText(`In English: ${czech}`);
  });

  test("a translation still running when the thread refreshes finishes", async ({
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
    await page.goto(`/#/inbox/${seeded.conversation}`);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/translate", async (route) => {
      await held;
      await route.continue();
    });
    await page.getByRole("button", { name: "Show in English" }).click();
    await expect(page.getByText("Translating…").first()).toBeVisible();
    // A newer copy of the thread arrives while the request is still out.
    await bumpConversationLastIn(
      request,
      seeded,
      new Date(Date.now() + 60_000).toISOString(),
    );
    await pullRemoteInboxRefresh(page);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
    release();
    await expect(messageBody(page)).toContainText(/In English:/, {
      timeout: 15000,
    });
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
    await page.goto(`/#/inbox/${conversation}`);
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
    await go(page, "inbox");
    await expect(page).toHaveURL(/#\/inbox$/);
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
    await page.goto(`/#/inbox/${conversation}`);
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
