import { storage } from "../storage";

/** The signed-in account on this site, for API calls that act on its storage. */
export function account() {
  const { userAddress, token } = storage.remote;
  if (!userAddress.endsWith(`@${location.host}`))
    throw new Error("This feature is available for accounts on this site.");
  return {
    username: decodeURIComponent(
      userAddress.slice(0, userAddress.lastIndexOf("@")),
    ),
    token,
  };
}
/** Calls the API with the account's storage token; throws the server's error message. */
export async function api<T>(
  url: string,
  init: { method?: string; body?: object; query?: Record<string, string> } = {},
  fallback = "Something went wrong. Please retry.",
): Promise<T> {
  const { username, token } = account();
  const search = init.query
    ? `?${new URLSearchParams({ username, ...init.query })}`
    : "";
  const response = await fetch(`${url}${search}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify({ username, ...init.body }) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error ?? fallback) as Error & {
      status?: number;
      result?: unknown;
    };
    error.status = response.status;
    error.result = result;
    throw error;
  }
  return result as T;
}
