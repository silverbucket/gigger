import type { TranslateTarget } from "./message-translate";

export type InboxLangSession = {
  messageId: string;
  chosen?: TranslateTarget;
  segmented: boolean;
  view: "original" | TranslateTarget;
};

export function inboxLangSessionKey(conversationId: string) {
  return `showday:inbox-lang:${conversationId}`;
}

export function readInboxLangSession(
  conversationId: string,
): InboxLangSession | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(inboxLangSessionKey(conversationId));
    if (!raw) return undefined;
    return JSON.parse(raw) as InboxLangSession;
  } catch {
    return undefined;
  }
}

export function writeInboxLangSession(
  conversationId: string,
  value: InboxLangSession,
) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      inboxLangSessionKey(conversationId),
      JSON.stringify(value),
    );
  } catch {
    // Private browsing or quota: reading aid still works without persistence.
  }
}

export function clearInboxLangSession(conversationId: string) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(inboxLangSessionKey(conversationId));
}
