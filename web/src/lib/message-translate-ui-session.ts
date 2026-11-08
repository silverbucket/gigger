import type { TranslateTarget } from "./message-translate";

/** In-view language control for the latest email (survives remount, not reload). */
export type InboxLangUi = {
  messageId: string;
  chosen: TranslateTarget;
  segmented: boolean;
  view: "original" | TranslateTarget;
};

const latestControlByConversation = new Map<string, InboxLangUi>();

export function readInboxLangUi(
  conversationId: string,
): InboxLangUi | undefined {
  return latestControlByConversation.get(conversationId);
}

export function writeInboxLangUi(conversationId: string, value: InboxLangUi) {
  latestControlByConversation.set(conversationId, value);
}

export function clearInboxLangUi(conversationId: string) {
  latestControlByConversation.delete(conversationId);
}

/** Clears stored control state only when the user opens this message from elsewhere. */
let openTranslationClearToken: string | undefined;

export function resetInboxLangOpenTracking() {
  openTranslationClearToken = undefined;
  resetMessageDetailOpenTracking();
}

export function clearInboxLangUiOnConversationOpen(conversationId: string) {
  if (openTranslationClearToken === conversationId) return;
  clearInboxLangUi(conversationId);
  openTranslationClearToken = conversationId;
}

/** Avoid clearing pinned translate content when the same conversation re-renders after sync. */
let messageDetailOpenId: string | undefined;

export function resetMessageDetailOpenTracking() {
  messageDetailOpenId = undefined;
}

/** @returns true when this is a fresh open of the conversation in the detail pane. */
export function beginMessageDetailConversation(id: string): boolean {
  if (messageDetailOpenId === id) return false;
  messageDetailOpenId = id;
  return true;
}
