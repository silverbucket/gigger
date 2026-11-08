import { api } from "./api";

export type TranslateTarget = "en" | "cs";
export type LanguageHint = "cs" | "en" | "mixed" | "unknown";

const czechChars = /[ěščřžýáíéúůďťň]/i;
const czechWords =
  /\b(ahoj|dobrý|prosím|koncert|termín|místo|kapela|přijde|děkuji|zdravím|nabídka)\b/i;
const englishWords =
  /\b(the|and|for|with|please|booking|concert|would|thank|hello|venue|offer|gig)\b/i;

export function detectEmailLanguage(
  subject: string | undefined,
  body: string,
): LanguageHint {
  const text = `${subject ?? ""}\n${body}`.trim();
  if (!text) return "unknown";
  const czech = czechChars.test(text) || czechWords.test(text);
  const english = englishWords.test(text);
  if (czech && english) return "mixed";
  if (czech) return "cs";
  if (english) return "en";
  return "unknown";
}

export function firstActions(hint: LanguageHint): TranslateTarget[] {
  if (hint === "cs") return ["en"];
  if (hint === "en") return ["cs"];
  return ["en", "cs"];
}

export function targetLabel(target: TranslateTarget): string {
  return target === "en" ? "English" : "Čeština";
}

export function showInLabel(target: TranslateTarget): string {
  return target === "en" ? "Show in English" : "Show in Čeština";
}

export function alreadyMatchesCopy(target: TranslateTarget): string {
  return target === "en"
    ? "This message looks like it's already in English."
    : "This message looks like it's already in Čeština.";
}

export function languageAlreadyMatches(
  hint: LanguageHint,
  target: TranslateTarget,
  subject: string | undefined,
  body: string,
): boolean {
  if (hint === target) return true;
  if (hint === "mixed" || hint === "unknown") {
    const again = detectEmailLanguage(subject, body);
    return again === target;
  }
  return false;
}

export type TranslationResult = { subject?: string; body: string };

type CacheKey = `${string}:${TranslateTarget}`;

const sessionCache = new Map<CacheKey, TranslationResult>();

export function readTranslationCache(
  messageId: string,
  target: TranslateTarget,
): TranslationResult | undefined {
  return sessionCache.get(`${messageId}:${target}`);
}

export function writeTranslationCache(
  messageId: string,
  target: TranslateTarget,
  value: TranslationResult,
) {
  sessionCache.set(`${messageId}:${target}`, value);
}

export function clearTranslationCache() {
  sessionCache.clear();
}

export function sourceForTarget(hint: LanguageHint): TranslateTarget | "auto" {
  if (hint === "cs") return "cs";
  if (hint === "en") return "en";
  return "auto";
}

export async function requestTranslation(
  input: {
    subject?: string;
    body: string;
    target: TranslateTarget;
    source?: TranslateTarget | "auto";
  },
  signal?: AbortSignal,
): Promise<TranslationResult> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return await api<TranslationResult>(
    "/api/translate",
    {
      method: "POST",
      body: {
        subject: input.subject,
        body: input.body,
        target: input.target,
        ...(input.source && input.source !== "auto"
          ? { source: input.source }
          : {}),
      },
    },
    "Could not translate this message.",
  );
}
