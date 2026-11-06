import { expect, test } from "bun:test";
import {
  currencyForLocale,
  feeAmount,
  formatFee,
  formatMoney,
  Showday,
  type ShowdayStore,
} from "@showday/schemas";
import RemoteStorage from "remotestoragejs";

const plain = (text = "") => text.replace(/[\u00a0\u202f]/g, " ");
test("money formats in the locale, without decimals for CZK", () => {
  expect(plain(formatMoney(14000, "CZK", "cs-CZ"))).toBe("14 000 Kč");
  expect(plain(formatMoney(4666.67, "czk", "cs-CZ"))).toBe("4 667 Kč");
  expect(plain(formatMoney(1234.5, "EUR", "cs-CZ"))).toBe("1 234,50 €");
  expect(formatMoney(1234.5, "EUR", "en-US")).toBe("€1,234.50");
  expect(formatMoney(5, "XXXX", "en-US")).toBe("5 XXXX");
});
test("fees format numbers in their own currency and keep legacy text", () => {
  expect(
    plain(
      formatFee({ amount: 5000, currency: "CZK", extras: [] }, "EUR", "en-US"),
    ),
  ).toBe("CZK 5,000");
  expect(formatFee({ amount: 50, extras: [] }, "EUR", "en-US")).toBe("€50.00");
  expect(formatFee({ amount: "500 EUR", extras: [] }, "CZK")).toBe("500 EUR");
  expect(formatFee("5000 CZK", "EUR")).toBe("5000 CZK");
  expect(formatFee("  ", "EUR")).toBeUndefined();
  expect(formatFee({ extras: ["Dinner"] }, "EUR")).toBeUndefined();
  expect(formatFee(undefined, "EUR")).toBeUndefined();
  expect(feeAmount({ amount: 5000, currency: "CZK", extras: [] })).toBe(5000);
  expect(feeAmount({ amount: "5000", extras: [] })).toBeUndefined();
  expect(feeAmount("5000 CZK")).toBeUndefined();
});
test("new bands default to the browser locale's currency", () => {
  expect(currencyForLocale("cs-CZ")).toBe("CZK");
  expect(currencyForLocale("cs")).toBe("CZK");
  expect(currencyForLocale("en-GB")).toBe("GBP");
  expect(currencyForLocale("en-US")).toBe("USD");
  expect(currencyForLocale("de")).toBe("EUR");
  expect(currencyForLocale("bg-BG")).toBe("EUR");
  expect(currencyForLocale("")).toBe("EUR");
  expect(currencyForLocale(undefined)).toBe("EUR");
  expect(currencyForLocale("not a locale!")).toBe("EUR");
});
test("gig schema accepts numeric fees with a currency and legacy text fees", async () => {
  const rs = new RemoteStorage();
  rs.addModule(Showday);
  rs.access.claim("showday", "rw");
  const store = (rs as RemoteStorage & { showday: ShowdayStore }).showday;
  await new Promise<void>((resolve) => rs.on("ready", () => resolve()));
  try {
    await store.save("band", "a", { id: "a", name: "Band", currency: "CZK" });
    await store.save("venue", "a", { id: "v", name: "Club", address: "Main" });
    const base = {
      title: "Show",
      date: "2030-01-01",
      status: "confirmed" as const,
      venueId: "v",
      contactIds: [],
    };
    const numeric = {
      ...base,
      id: "n",
      fee: { amount: 5000, currency: "CZK", extras: ["Dinner"] },
    };
    const legacy = { ...base, id: "l", fee: "5000 CZK" };
    await store.save("gig", "a", numeric);
    await store.save("gig", "a", legacy);
    const gigs = await store.list("gig", "a");
    expect(gigs.find((g) => g.id === "n")).toMatchObject(numeric);
    expect(gigs.find((g) => g.id === "l")).toMatchObject(legacy);
  } finally {
    rs.disconnect();
  }
});
