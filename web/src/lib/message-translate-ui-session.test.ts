import { afterEach, expect, test } from "bun:test";
import {
  beginMessageDetailConversation,
  clearInboxLangUiOnConversationOpen,
  readInboxLangUi,
  resetInboxLangOpenTracking,
  writeInboxLangUi,
} from "./message-translate-ui-session";

afterEach(() => {
  resetInboxLangOpenTracking();
});

test("in-memory latest-email control is per conversation", () => {
  writeInboxLangUi("conv-a", {
    messageId: "m1",
    chosen: "en",
    segmented: true,
    view: "en",
  });
  expect(readInboxLangUi("conv-a")?.view).toBe("en");
  expect(readInboxLangUi("conv-b")).toBeUndefined();
});

test("open tracking clears only when the user enters a message from elsewhere", () => {
  writeInboxLangUi("conv-a", {
    messageId: "m1",
    chosen: "en",
    segmented: true,
    view: "en",
  });
  clearInboxLangUiOnConversationOpen("conv-a");
  expect(readInboxLangUi("conv-a")).toBeUndefined();
  writeInboxLangUi("conv-a", {
    messageId: "m1",
    chosen: "en",
    segmented: true,
    view: "en",
  });
  clearInboxLangUiOnConversationOpen("conv-a");
  expect(readInboxLangUi("conv-a")?.view).toBe("en");
  resetInboxLangOpenTracking();
  clearInboxLangUiOnConversationOpen("conv-a");
  expect(readInboxLangUi("conv-a")).toBeUndefined();
});

test("message detail open tracking survives sync re-renders of the same id", () => {
  expect(beginMessageDetailConversation("conv-a")).toBe(true);
  expect(beginMessageDetailConversation("conv-a")).toBe(false);
  resetInboxLangOpenTracking();
  expect(beginMessageDetailConversation("conv-a")).toBe(true);
});
