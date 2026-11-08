import { expect, test } from "bun:test";
import type { Gig } from "@showday/schemas";
import { currencyChoices, usedCurrencies } from "./lib/format";

test("currency choices put the given codes first, deduped, with names", () => {
  const choices = currencyChoices(["czk", undefined, "EUR", "nope", "CZK"]);
  expect(choices.slice(0, 3).map((choice) => choice.code)).toEqual([
    "CZK",
    "EUR",
    "USD",
  ]);
  expect(choices[0].name).toBe("Czech Koruna");
  expect(new Set(choices.map((choice) => choice.code)).size).toBe(
    choices.length,
  );
  expect(choices.length).toBeLessThan(20);
});

test("used currencies rank fee and earnings currencies by use", () => {
  const gigs = [
    { fee: { amount: "100", currency: "eur", extras: [] } },
    { fee: { amount: "100", currency: "CZK", extras: [] } },
    { fee: "legacy text", earnings: { currency: "CZK" } },
  ] as unknown as Gig[];
  expect(usedCurrencies(gigs)).toEqual(["CZK", "EUR"]);
});
