import { STORAGE_MODULE_SLUG } from "@showday/schemas";
import { resolveAppOrigin } from "./app-origin";
import { armadiettoStorageHeaders } from "./storage";

const usernameRe = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const langRe = /^(en|cs)$/;

type Target = "en" | "cs";

export async function libreTranslate(
  q: string,
  source: string,
  target: Target,
  baseUrl: string,
  apiKey?: string,
): Promise<string> {
  const root = baseUrl.replace(/\/$/, "");
  const response = await fetch(`${root}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q,
      source,
      target,
      format: "text",
      ...(apiKey ? { api_key: apiKey } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`translate:${response.status}`);
  const result = (await response.json()) as { translatedText?: unknown };
  if (
    typeof result.translatedText !== "string" ||
    !result.translatedText.trim()
  )
    throw new Error("translate:bad-response");
  return result.translatedText;
}

async function verifyStorageToken(
  armadiettoUrl: string,
  username: string,
  token: string,
  appOrigin: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${armadiettoUrl}/storage/storage/${encodeURIComponent(username)}/${STORAGE_MODULE_SLUG}/bands/`,
      {
        headers: armadiettoStorageHeaders(token, appOrigin),
        signal: AbortSignal.timeout(10_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/** POST /translate {username, subject?, body, target, source?} with Bearer token. */
export function translateHandler(
  armadiettoUrl = process.env.ARMADIETTO_URL ?? "http://armadietto:8000",
  appOrigin = resolveAppOrigin(),
  env = process.env,
) {
  const fail = (error: string, status: number) =>
    Response.json(
      { error },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  return async (req: Request) => {
    if (req.headers.get("origin") && req.headers.get("origin") !== appOrigin)
      return fail("Invalid request origin.", 403);
    let input: Record<string, unknown>;
    try {
      input = await req.json();
    } catch {
      return fail("Invalid request.", 400);
    }
    const { username, subject, body, target, source } = input ?? {};
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    if (
      typeof username !== "string" ||
      !usernameRe.test(username) ||
      !token ||
      typeof body !== "string" ||
      !body.trim() ||
      typeof target !== "string" ||
      !langRe.test(target)
    )
      return fail("Invalid request.", 400);
    if (subject !== undefined && typeof subject !== "string")
      return fail("Invalid request.", 400);
    const from =
      typeof source === "string" && langRe.test(source)
        ? source
        : target === "en"
          ? "cs"
          : "en";
    const baseUrl = env.LIBRETRANSLATE_URL?.trim();
    if (!baseUrl) return fail("Translation is not available right now.", 503);
    if (!(await verifyStorageToken(armadiettoUrl, username, token, appOrigin)))
      return fail("Could not verify access. Please retry.", 403);
    const apiKey = env.LIBRETRANSLATE_API_KEY?.trim() || undefined;
    try {
      const translatedBody = await libreTranslate(
        body.trim(),
        from,
        target as Target,
        baseUrl,
        apiKey,
      );
      let translatedSubject: string | undefined;
      if (typeof subject === "string" && subject.trim()) {
        translatedSubject = await libreTranslate(
          subject.trim(),
          from,
          target as Target,
          baseUrl,
          apiKey,
        );
      }
      return Response.json(
        { subject: translatedSubject, body: translatedBody },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return fail("Could not translate this message.", 502);
    }
  };
}
