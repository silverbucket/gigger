import {
  choose,
  details,
  expect,
  go,
  login,
  money,
  openGig,
  test,
} from "./fixtures";

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
  page.on("dialog", (dialog) => dialog.accept());
  await login(page, account);
  await expect(
    page.getByRole("link", { name: /Prague show/ }).first(),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("band currency inputs accept real codes and reject malformed ones", async ({
  page,
  account,
}) => {
  await go(page, "band/settings");
  const currency = page.getByLabel(/^Band currency/);
  const save = page.getByRole("button", { name: "Save currency", exact: true });
  for (const value of ["CZ", "123", "C3"]) {
    await currency.fill(value);
    await save.click();
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
  await save.click();
  await expect
    .poll(async () => (await account.read("band")).currency, { timeout: 15000 })
    .toBe("EUR");
  await expect(save).toBeEnabled();
  await expect(currency).toHaveValue("EUR");
  await currency.fill("czk");
  await save.click();
  await expect
    .poll(async () => (await account.read("band")).currency, { timeout: 15000 })
    .toBe("CZK");
  await page.getByRole("button", { name: "New band", exact: true }).click();
  const create = page.locator("#new-band");
  await create.getByLabel("Band name", { exact: true }).fill("Second Band");
  await create.getByLabel("Currency", { exact: true }).fill("CZK");
  await create
    .getByRole("button", { name: "Create band", exact: true })
    .click();
  await expect(
    page.getByLabel("View band").locator("option:checked"),
  ).toHaveText("Second Band");
  await expect(page.getByLabel(/^Band currency/)).toHaveValue("CZK");
});

test("booking validation opens collapsed invalid fields and preserves the draft", async ({
  page,
}) => {
  await page.getByRole("link", { name: "New enquiry", exact: true }).click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("New booking");
  await page
    .getByLabel("Proposed gig date", { exact: true })
    .fill("2030-07-01");
  await page.getByRole("combobox", { name: "Venue" }).fill("test");
  await page.getByRole("option", { name: /Test Club/ }).click();
  await page.getByRole("button", { name: "Save enquiry" }).click();
  const email = page
    .getByRole("radiogroup", { name: "Source" })
    .getByRole("radio", { name: "Email" });
  await expect
    .poll(() =>
      email.evaluate((input: HTMLInputElement) => input.validity.valueMissing),
    )
    .toBe(true);
  await expect(title).toHaveValue("New booking");
  await choose(page, "Source", "Email");
  await page.getByText("When", { exact: true }).click();
  await page.getByLabel("Set length (minutes)").fill("0");
  // Closing the section again: an invalid field reopens it.
  await page.getByText("When", { exact: true }).click();
  await page.getByRole("button", { name: "Save enquiry" }).click();
  await expect
    .poll(() =>
      page
        .getByLabel("Set length (minutes)")
        .evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow),
    )
    .toBe(true);
  await expect(page.getByLabel("Set length (minutes)")).toBeVisible();
  await page.getByLabel("Set length (minutes)").fill("45");
  await page.getByText("Money · Public", { exact: true }).click();
  const fee = page.getByLabel("Fee", { exact: true });
  await expect(page.getByLabel("Fee currency", { exact: true })).toHaveValue(
    "CZK",
  );
  await fee.fill("-5");
  await page.getByRole("button", { name: "Save enquiry" }).click();
  await expect
    .poll(() =>
      fee.evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow),
    )
    .toBe(true);
  await fee.fill("1500");
  await page.getByRole("button", { name: "Save enquiry" }).click();
  await expect(
    page.getByRole("heading", { name: "New booking", exact: true }),
  ).toBeVisible();
  // The open gig is in the address, so a reload keeps it on screen.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "New booking", exact: true }),
  ).toBeVisible();
  await expect(details(page).getByText("45 min")).toBeVisible();
  await expect(details(page).getByText(money(1500, "CZK"))).toBeVisible();
});

test("survey choices are required, cancel leaves the gig unplayed", async ({
  page,
  account,
}) => {
  await openGig(page, "Prague show");
  await page.getByRole("button", { name: "Mark played", exact: true }).click();
  await page.getByRole("button", { name: /Save and mark played/ }).click();
  for (const name of [
    "Rating",
    "Capacity",
    "Indoor or outdoor",
    "PA",
    "Would you play here again?",
  ]) {
    const first = page
      .getByRole("radiogroup", { name, exact: true })
      .getByRole("radio")
      .first();
    await expect(first).not.toBeChecked();
  }
  await expect(page.getByText(/Still to fill in: rating/)).toBeVisible();
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
  const total = page.locator(".total-row");
  const tookHome = page.getByText(/Your band took home/);
  for (const [title, currency] of [
    ["Prague", "CZK"],
    ["Berlin", "EUR"],
  ] as const) {
    await openGig(page, `${title} show`);
    await page
      .getByRole("button", { name: "Mark played", exact: true })
      .click();
    await choose(page, "Rating", "4");
    await choose(page, "Capacity", "50–100");
    await choose(page, "Indoor or outdoor", "Indoor");
    await choose(page, "PA", "Venue provided");
    await choose(page, "Would you play here again?", "Yes");
    await page.getByLabel("Attendance on the night").fill("80");
    if (title === "Berlin")
      await page
        .getByRole("button", { name: "Override total or take-home" })
        .click();
    const totalOverride = page.getByLabel("Total including fixed fee");
    await expect(totalOverride).toHaveValue(title === "Prague" ? "5000" : "");
    if (title === "Prague") {
      // A fee in another currency is never relabelled as the earnings total,
      // and clearing the currency does not fall back to the band's currency.
      await page.getByLabel("Currency", { exact: true }).clear();
      await expect(totalOverride).toHaveValue("");
      await page.getByRole("button", { name: /Save and mark played/ }).click();
      await expect
        .poll(() =>
          page
            .getByLabel("Currency", { exact: true })
            .evaluate((input: HTMLInputElement) => input.validity.valueMissing),
        )
        .toBe(true);
      await page.getByLabel("Currency", { exact: true }).fill("CZK");
    }
    await choose(page, "Deal type", "Mixed");
    await expect(totalOverride).toHaveValue("");
    await expect(page.getByLabel("Currency", { exact: true })).toHaveValue(
      "CZK",
    );
    await page.getByLabel("Currency", { exact: true }).fill(currency);
    await page.getByLabel("Door takings").fill("-1");
    await page.getByRole("button", { name: /Save and mark played/ }).click();
    await expect
      .poll(() =>
        page
          .getByLabel("Door takings")
          .evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow),
      )
      .toBe(true);
    // Floating-point sums are rounded to cents so a matching split is valid.
    await page.getByLabel("Door takings").fill("0.10");
    await page.getByLabel("Hat takings").fill("0.70");
    await expect(total).toContainText(money(0.8, currency));
    await choose(page, "Split with other bands", "Handed over");
    await page
      .getByRole("spinbutton", { name: "Amount handed over", exact: true })
      .fill("0.80");
    await expect
      .poll(() =>
        page
          .getByRole("spinbutton", { name: "Amount handed over", exact: true })
          .evaluate((input: HTMLInputElement) => input.validity.valid),
      )
      .toBe(true);
    await choose(page, "Split with other bands", "No split");
    await page.getByLabel("Door takings").fill("100");
    await page.getByLabel("Hat takings").fill("20");
    await page.getByLabel("Bar takings").fill("30");
    await expect(total).toContainText(money(150, currency));
    await totalOverride.fill("200");
    await expect(total).toContainText(money(200, currency));
    await totalOverride.clear();
    await expect(total).toContainText(money(150, currency));
    await choose(page, "Split with other bands", "Equally");
    await page.getByLabel("Number of bands, including yours").fill("1.5");
    await page.getByRole("button", { name: /Save and mark played/ }).click();
    await expect
      .poll(() =>
        page
          .getByLabel("Number of bands, including yours")
          .evaluate((input: HTMLInputElement) => input.validity.stepMismatch),
      )
      .toBe(true);
    await page.getByLabel("Number of bands, including yours").fill("3");
    await expect(tookHome).toContainText(money(50, currency));
    await choose(page, "Split with other bands", "Handed over");
    await page
      .getByRole("spinbutton", { name: "Amount handed over", exact: true })
      .fill("151");
    await page.getByRole("button", { name: /Save and mark played/ }).click();
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
    await expect(tookHome).toContainText(money(125, currency));
    await page.getByLabel("Take-home amount").fill("120");
    // Pressing the button keeps focus in the field, so the first tap saves
    // even while a phone keyboard is still open.
    await page.getByRole("button", { name: /Save and mark played/ }).hover();
    await page.mouse.down();
    await expect(page.getByLabel("Take-home amount")).toBeFocused();
    await page.mouse.up();
    await expect(details(page).getByText(/Took home/)).toContainText(
      money(120, currency),
    );
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
  expect(shared[1]).toMatchObject({
    venueId: "club",
    rating: 4,
    attendance: 80,
  });
  expect(JSON.stringify(shared)).not.toMatch(
    /earnings|takeHome|handedOver|currency/,
  );
  expect(
    (
      await request.get(`/storage/storage/${account.username}/showday/bands/`)
    ).status(),
  ).toBe(403);
  await page.reload();
  await openGig(page, "Berlin show");
  await expect(details(page).getByText(/Took home/)).toContainText(
    money(120, "EUR"),
  );
  await go(page, "venues");
  await page.getByRole("link", { name: /Test Club/ }).click();
  await expect(details(page).getByText("4.0 / 5")).toBeVisible();
  await expect(details(page).getByText("avg 80 people")).toBeVisible();
});

test("gig sheet shows logistics, omits empty fields and hides other UI in print", async ({
  page,
}) => {
  await openGig(page, "Prague show");
  const sheet = page.locator(".gig-sheet");
  await expect(sheet).toBeHidden();
  await page.emulateMedia({ media: "print" });
  await expect(sheet).toBeVisible();
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
  await expect(
    page.getByRole("link", { name: "Showday", exact: true }),
  ).toBeHidden();
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Prague show", level: 2 }),
  ).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await openGig(page, "Berlin show");
  await page.emulateMedia({ media: "print" });
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
  await openGig(page, "Legacy show");
  await expect(details(page).getByText("door split")).toBeVisible();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Legacy show renamed");
  await choose(page, "Source", "Email");
  await page.getByText("Money · Public", { exact: true }).click();
  await expect(page.getByText(/Current fee: door split/)).toBeVisible();
  await expect(page.getByLabel("Fee", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: /Save gig/ }).click();
  await expect(
    page.getByRole("heading", { name: "Legacy show renamed", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await account.read("gigs/legacy")).fee)
    .toEqual({ amount: "door split", extras: [] });
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByText("Money · Public", { exact: true }).click();
  await page.getByLabel("Fee", { exact: true }).fill("250");
  await page.getByRole("button", { name: /Save gig/ }).click();
  await expect
    .poll(async () => (await account.read("gigs/legacy")).fee)
    .toEqual({ amount: 250, currency: "CZK", extras: [] });
  await expect(details(page).getByText(money(250, "CZK"))).toBeVisible();
});

test("venue and other-band searches match accents and preserve selections", async ({
  page,
  account,
}) => {
  await account.seedVenue("cafe", "Čáslav Café");
  await account.seedOtherBand("band-a", "Žáby");
  await account.seedOtherBand("band-b", "Áčko");
  await page.reload();
  await expect(page.getByLabel("View band")).toBeVisible();
  await page.getByRole("link", { name: "New enquiry", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Accent test");
  await page
    .getByLabel("Proposed gig date", { exact: true })
    .fill("2030-07-01");
  const venue = page.getByRole("combobox", { name: "Venue" });
  await venue.fill("caslav cafe");
  await page.getByRole("option", { name: /Čáslav Café/ }).click();
  await expect(venue).toHaveValue("Čáslav Café");
  await page.getByText("Who", { exact: true }).click();
  const bandSearch = page.getByRole("combobox", { name: "Add a band" });
  await bandSearch.fill("zaby");
  await page.getByRole("option", { name: "Žáby", exact: true }).click();
  await bandSearch.fill("acko");
  await page.getByRole("option", { name: "Áčko", exact: true }).click();
  await page.getByRole("button", { name: "Remove Žáby" }).click();
  await choose(page, "Source", "Email");
  await page.getByRole("button", { name: "Save enquiry" }).click();
  await expect(details(page).getByText("Čáslav Café").first()).toBeVisible();
  await expect(
    details(page).getByRole("link", { name: "Áčko", exact: true }),
  ).toBeVisible();
  await expect(
    details(page).getByRole("link", { name: "Žáby", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(venue).toHaveValue("Čáslav Café");
  await page.getByText("Who", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Áčko" })).toBeVisible();
});
