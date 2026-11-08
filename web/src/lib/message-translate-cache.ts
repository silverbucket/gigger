export type TranslationResult = { subject?: string; body: string };
type TranslateTarget = "en" | "cs";

const sessionCache = new Map<string, TranslationResult>();

function key(
  account: string,
  messageId: string,
  target: TranslateTarget,
): string {
  return `${account}:${messageId}:${target}`;
}

export function readTranslationCacheEntry(
  account: string,
  messageId: string,
  target: TranslateTarget,
): TranslationResult | undefined {
  return sessionCache.get(key(account, messageId, target));
}

export function writeTranslationCacheEntry(
  account: string,
  messageId: string,
  target: TranslateTarget,
  value: TranslationResult,
) {
  sessionCache.set(key(account, messageId, target), value);
}

export function clearTranslationCache() {
  sessionCache.clear();
}
