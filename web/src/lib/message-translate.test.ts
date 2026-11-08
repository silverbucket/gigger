import { afterEach, expect, test } from "bun:test";
import { storage } from "../storage";
import {
  alreadyMatchesCopy,
  clearTranslationCache,
  detectEmailLanguage,
  firstActions,
  languageAlreadyMatches,
  readTranslationCache,
  showInLabel,
  targetLabel,
  writeTranslationCache,
} from "./message-translate";

function asAccount(address: string) {
  storage.remote.userAddress = address;
}

afterEach(() => {
  clearTranslationCache();
  storage.remote.userAddress = "";
});

test("detectEmailLanguage classifies Czech, English, mixed, and unknown", () => {
  expect(
    detectEmailLanguage("Koncert", "Dobrý den, máme termín v Praze."),
  ).toBe("cs");
  expect(
    detectEmailLanguage(
      "Booking",
      "Hello, we would like to offer a concert date.",
    ),
  ).toBe("en");
  expect(
    detectEmailLanguage(
      "Booking",
      "Hello, we would like to book you — prosím o termín koncertu.",
    ),
  ).toBe("mixed");
  expect(detectEmailLanguage(undefined, "255 123 456")).toBe("unknown");
});

test("first actions follow detection without inferring preferences", () => {
  expect(firstActions("cs")).toEqual(["en"]);
  expect(firstActions("en")).toEqual(["cs"]);
  expect(firstActions("mixed")).toEqual(["en", "cs"]);
  expect(firstActions("unknown")).toEqual(["en", "cs"]);
});

test("copy helpers use the approved strings", () => {
  expect(showInLabel("en")).toBe("Show in English");
  expect(showInLabel("cs")).toBe("Show in Čeština");
  expect(targetLabel("en")).toBe("English");
  expect(targetLabel("cs")).toBe("Čeština");
  expect(alreadyMatchesCopy("en")).toBe(
    "This message looks like it's already in English.",
  );
  expect(alreadyMatchesCopy("cs")).toBe(
    "This message looks like it's already in Čeština.",
  );
});

test("session cache is keyed by account, message and target", () => {
  asAccount("alice@example.com");
  writeTranslationCache("m1", "en", { body: "Hello", subject: "Hi" });
  expect(readTranslationCache("m1", "en")).toEqual({
    body: "Hello",
    subject: "Hi",
  });
  expect(readTranslationCache("m2", "en")).toBeUndefined();
  asAccount("bob@example.com");
  expect(readTranslationCache("m1", "en")).toBeUndefined();
  clearTranslationCache();
  asAccount("alice@example.com");
  expect(readTranslationCache("m1", "en")).toBeUndefined();
});

test("clearTranslationCache runs when the storage cache is cleared on logout", () => {
  asAccount("alice@example.com");
  writeTranslationCache("m1", "en", { body: "Hello" });
  clearTranslationCache();
  expect(readTranslationCache("m1", "en")).toBeUndefined();
});

test("already-matches accepts a deliberate target that matches redetected language", () => {
  expect(
    languageAlreadyMatches(
      "unknown",
      "en",
      "Offer",
      "We would like to book your band for a concert.",
    ),
  ).toBeTrue();
  expect(languageAlreadyMatches("mixed", "en", "Mix", "Ahoj")).toBeFalse();
});
