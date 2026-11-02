import { expect, test } from "./fixtures";

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    ...(currency === "CZK" ? { maximumFractionDigits: 0 } : {}),
  })
    .format(amount)
    .replace(/[\u00a0\u202f]/g, " ");

test.beforeEach(async ({ page, account }) => {
  await account.seedGig({
    id: "prague",
    title: "Prague show",
    loadIn: "16:00",
    soundcheck: "17:00",
    setTimes: ["20:00"],
    setLength: 45,
    fee: { amount: 5000, currency: "CZK", extras: ["Dinner"] },
    notes: "Use the side entrance",
  });
  await account.seedGig({ id: "berlin", title: "Berlin show" });
  await page.goto("/login");
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
  await page.getByLabel("Username", { exact: true }).fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByLabel("View band").selectOption(account.bandId);
  await expect(
    page.getByRole("button", { name: /2030-06-20 · Prague show/ }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("band currency inputs accept real codes and reject malformed ones", async ({
  page,
  account,
}) => {
  const currency = page.getByLabel("Band currency", { exact: true });
  for (const value of ["CZ", "123", "C3"]) {
    await currency.fill(value);
    await page
      .getByRole("button", { name: "Save currency", exact: true })
      .click();
    await expect
      .poll(() =>
        currency.evaluate(
          (input: HTMLInputElement) => input.validity.patternMismatch,
        ),
      )
      .toBe(true);
    expect((await account.read("band")).currency).toBe("CZK");
  }
  await currency.fill("EUR");
  await page
    .getByRole("button", { name: "Save currency", exact: true })
    .click();
  await expect
    .poll(async () => (await account.read("band")).currency)
    .toBe("EUR");
  await currency.fill("czk");
  await page
    .getByRole("button", { name: "Save currency", exact: true })
    .click();
  await expect
    .poll(async () => (await account.read("band")).currency)
    .toBe("CZK");
  await page.getByRole("button", { name: "+ New band", exact: true }).click();
  const create = page.locator("#new-band");
  await create.getByLabel("Band name", { exact: true }).fill("Second Band");
  await create.getByLabel("Currency", { exact: true }).fill("CZK");
  await create
    .getByRole("button", { name: "Create band", exact: true })
    .click();
  await expect(page.getByLabel("Band currency", { exact: true })).toHaveValue(
    "CZK",
  );
  await expect(
    page.getByRole("heading", { name: "Second Band", exact: true, level: 2 }),
  ).toBeVisible();
});

test("booking validation opens collapsed invalid fields and preserves the draft", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New enquiry", exact: true }).click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("New booking");
  await page
    .getByLabel("Proposed gig date", { exact: true })
    .fill("2030-07-01");
  await page
    .getByRole("combobox", { name: "Venue", exact: true })
    .selectOption("club");
  await page.getByText("Enquiry", { exact: true }).click();
  await page.getByRole("button", { name: "Save enquiry", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Source", exact: true }),
  ).toBeVisible();
  await expect(title).toHaveValue("New booking");
  await page
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption("email");
  await page.getByLabel("Set length (minutes)").fill("0");
  await page.getByRole("button", { name: "Save enquiry", exact: true }).click();
  await expect
    .poll(() =>
      page
        .getByLabel("Set length (minutes)")
        .evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow),
    )
    .toBe(true);
  await page.getByLabel("Set length (minutes)").fill("45");
  await page.getByText("Money", { exact: true }).click();
  const fee = page.getByLabel("Fee", { exact: true });
  await expect(page.getByLabel("Fee currency", { exact: true })).toHaveValue(
    "CZK",
  );
  await fee.fill("-5");
  await page.getByRole("button", { name: "Save enquiry", exact: true }).click();
  await expect
    .poll(() =>
      fee.evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow),
    )
    .toBe(true);
  await fee.fill("1500");
  await page.getByRole("button", { name: "Save enquiry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New booking", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByLabel("View band").selectOption({ label: "Touring Band" });
  await page.getByRole("button", { name: /2030-07-01 · New booking/ }).click();
  await expect(
    page.getByText("Set length: 45 minutes", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Bookings" })
      .getByText(`Fee: ${money(1500, "CZK")}`, { exact: true }),
  ).toBeVisible();
});

test("survey choices are required, cancel leaves the gig unplayed", async ({
  page,
  account,
}) => {
  await page.getByRole("button", { name: /2030-06-20 · Prague show/ }).click();
  await page.getByRole("button", { name: "Mark played", exact: true }).click();
  await page
    .getByRole("button", { name: "Save and mark played", exact: true })
    .click();
  for (const name of [
    "Rating",
    "Capacity",
    "Indoor or outdoor",
    "PA",
    "Would you play here again?",
  ]) {
    await expect(page.getByRole("combobox", { name, exact: true })).toHaveValue(
      "",
    );
  }
  expect((await account.read("gigs/prague")).status).toBe("confirmed");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mark played", exact: true }),
  ).toBeVisible();
  expect(await account.exists("surveys/prague")).toBe(false);
});

test("earnings validate, recalculate, persist currencies per gig and stay out of venue data", async ({
  page,
  account,
  request,
}) => {
  for (const [title, currency] of [
    ["Prague", "CZK"],
    ["Berlin", "EUR"],
  ]) {
    await page
      .getByRole("button", { name: new RegExp(`2030-06-20 · ${title} show`) })
      .click();
    await page
      .getByRole("button", { name: "Mark played", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Rating", exact: true })
      .selectOption("4");
    await page
      .getByRole("combobox", { name: "Capacity", exact: true })
      .selectOption("50–100");
    await page
      .getByRole("combobox", { name: "Indoor or outdoor", exact: true })
      .selectOption("indoor");
    await page
      .getByRole("combobox", { name: "PA", exact: true })
      .selectOption("venue provided");
    await page
      .getByRole("combobox", {
        name: "Would you play here again?",
        exact: true,
      })
      .selectOption("yes");
    const totalOverride = page.getByLabel(
      "Total including fixed fee (optional override)",
    );
    await expect(totalOverride).toHaveValue(title === "Prague" ? "5000" : "");
    if (title === "Prague") {
      // A fee in another currency is never relabelled as the earnings total.
      await page.getByLabel("Currency", { exact: true }).fill("EUR");
      await expect(totalOverride).toHaveValue("");
      await page.getByLabel("Currency", { exact: true }).fill("CZK");
    }
    await page
      .getByRole("combobox", { name: "Deal type", exact: true })
      .selectOption("mixed");
    await expect(totalOverride).toHaveValue("");
    await expect(page.getByLabel("Currency", { exact: true })).toHaveValue(
      "CZK",
    );
    await page.getByLabel("Currency", { exact: true }).fill(currency as string);
    await page.getByLabel("Door takings (optional)").fill("-1");
    await page
      .getByRole("button", { name: "Save and mark played", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .getByLabel("Door takings (optional)")
          .evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow),
      )
      .toBe(true);
    await page.getByLabel("Door takings (optional)").fill("100");
    await page.getByLabel("Hat takings (optional)").fill("20");
    await page.getByLabel("Bar takings (optional)").fill("30");
    const c = currency as string;
    await expect(
      page.getByText(`Total takings: ${money(150, c)}`, { exact: true }),
    ).toBeVisible();
    await totalOverride.fill("200");
    await expect(
      page.getByText(`Total takings: ${money(200, c)}`, { exact: true }),
    ).toBeVisible();
    await totalOverride.clear();
    await expect(
      page.getByText(`Total takings: ${money(150, c)}`, { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Split with other bands").selectOption("bands");
    await page.getByLabel("Number of bands (including yours)").fill("1.5");
    await page
      .getByRole("button", { name: "Save and mark played", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .getByLabel("Number of bands (including yours)")
          .evaluate((input: HTMLInputElement) => input.validity.stepMismatch),
      )
      .toBe(true);
    await page.getByLabel("Number of bands (including yours)").fill("3");
    await expect(
      page.getByText(`Your band took home: ${money(50, c)}`, { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Split with other bands").selectOption("amount");
    await page
      .getByRole("spinbutton", { name: "Amount handed over", exact: true })
      .fill("151");
    await page
      .getByRole("button", { name: "Save and mark played", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .getByRole("spinbutton", { name: "Amount handed over", exact: true })
          .evaluate((input: HTMLInputElement) => input.validity.rangeOverflow),
      )
      .toBe(true);
    await page
      .getByRole("spinbutton", { name: "Amount handed over", exact: true })
      .fill("25");
    await expect(
      page.getByText(`Your band took home: ${money(125, c)}`, {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Take-home amount (optional override)").fill("120");
    await page
      .getByRole("button", { name: "Save and mark played", exact: true })
      .click();
    await expect(
      page.getByText(`Your band took home: ${money(120, c)}`, {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Gigs", exact: true }).click();
  }
  await expect
    .poll(async () => (await account.read("gigs/berlin")).status)
    .toBe("played");
  expect((await account.read("gigs/prague")).earnings).toMatchObject({
    takeHome: 120,
    currency: "CZK",
    handedOver: 25,
  });
  expect((await account.read("gigs/berlin")).earnings).toMatchObject({
    takeHome: 120,
    currency: "EUR",
    handedOver: 25,
  });
  const shared = [
    await account.read("venues/club"),
    await account.read("surveys/prague"),
    await account.read("surveys/berlin"),
  ];
  expect(shared[1]).toMatchObject({ venueId: "club", rating: 4 });
  expect(JSON.stringify(shared)).not.toMatch(
    /earnings|takeHome|handedOver|currency/,
  );
  expect(
    (
      await request.get(`/storage/storage/${account.username}/gigger/bands/`)
    ).status(),
  ).toBe(403);
  await page.reload();
  await page.getByLabel("View band").selectOption(account.bandId);
  await page.getByRole("button", { name: /2030-06-20 · Berlin show/ }).click();
  await expect(
    page.getByText(`Your band took home: ${money(120, "EUR")}`, {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Venues", exact: true }).click();
  await page.getByRole("button", { name: "Test Club", exact: true }).click();
  await expect(page.getByText(/Average rating: 4.0 \/ 5/)).toBeVisible();
});

test("gig sheet shows logistics, omits empty fields and hides other UI in print", async ({
  page,
}) => {
  await page.getByRole("button", { name: /2030-06-20 · Prague show/ }).click();
  await page
    .getByRole("button", { name: "View gig sheet", exact: true })
    .click();
  const sheet = page.locator(".gig-sheet");
  await expect(
    sheet.getByText("Main Street 12, Prague", { exact: false }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("link", { name: "Map and directions" }),
  ).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/search?query=Main%20Street%2012%2C%20Prague",
  );
  for (const text of [
    "Touring Band",
    "16:00",
    "17:00",
    "20:00",
    "45 minutes",
    money(5000, "CZK"),
    "Dinner",
    "Use the side entrance",
  ])
    await expect(sheet.getByText(text, { exact: true })).toBeVisible();
  await expect(
    sheet.getByText(/Jo · \+420123456789 · jo@example.com/),
  ).toBeVisible();
  await expect(sheet.locator("input, select, textarea")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ media: "print" });
  await expect(sheet.getByRole("heading")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Gigger", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Print gig sheet" }),
  ).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Back to gig", exact: true }).click();
  await page.getByRole("button", { name: "Gigs", exact: true }).click();
  await page.getByRole("button", { name: /2030-06-20 · Berlin show/ }).click();
  await page
    .getByRole("button", { name: "View gig sheet", exact: true })
    .click();
  for (const label of [
    "Arrival time",
    "Soundcheck",
    "Set start",
    "Set length",
    "Fee",
    "Extras",
    "Notes",
  ])
    await expect(sheet.getByText(label, { exact: true })).toHaveCount(0);
});

test("legacy free-text fees survive unrelated edits until replaced", async ({
  page,
  account,
}) => {
  await account.seedGig({
    id: "legacy",
    title: "Legacy show",
    fee: "door split",
  });
  await page.reload();
  await page.getByLabel("View band").selectOption(account.bandId);
  await page.getByRole("button", { name: /2030-06-20 · Legacy show/ }).click();
  const bookings = page.getByRole("region", { name: "Bookings" });
  await expect(
    bookings.getByText("Fee: door split", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit gig", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Legacy show renamed");
  await page
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption("email");
  await page.getByText("Money", { exact: true }).click();
  await expect(page.getByText(/Current fee: door split/)).toBeVisible();
  await expect(page.getByLabel("Fee", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Save gig", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Legacy show renamed", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await account.read("gigs/legacy")).fee)
    .toEqual({ amount: "door split", extras: [] });
  await page.getByRole("button", { name: "Edit gig", exact: true }).click();
  await page.getByText("Money", { exact: true }).click();
  await page.getByLabel("Fee", { exact: true }).fill("250");
  await page.getByRole("button", { name: "Save gig", exact: true }).click();
  await expect
    .poll(async () => (await account.read("gigs/legacy")).fee)
    .toEqual({ amount: 250, currency: "CZK", extras: [] });
  await expect(
    bookings.getByText(`Fee: ${money(250, "CZK")}`, { exact: true }),
  ).toBeVisible();
});
