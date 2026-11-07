import { resolveAppOrigin } from "./app-origin";

const HTTPS_SCHEME = "https://";
const FORWARDED_PROTO_HEADER = "X-Forwarded-Proto";
const FORWARDED_PROTO_HTTPS = "https";

/** Headers for unauthenticated Armadietto reads; https.force rejects even public documents without X-Forwarded-Proto. */
export function armadiettoPublicStorageHeaders(appOrigin = resolveAppOrigin()) {
  const headers: Record<string, string> = {};
  if (appOrigin.startsWith(HTTPS_SCHEME))
    headers[FORWARDED_PROTO_HEADER] = FORWARDED_PROTO_HTTPS;
  return headers;
}

/** Headers for Armadietto behind TLS termination (https.force reads X-Forwarded-Proto). */
export function armadiettoStorageHeaders(
  token: string,
  appOrigin = resolveAppOrigin(),
): Record<string, string> {
  return {
    ...armadiettoPublicStorageHeaders(appOrigin),
    Authorization: `Bearer ${token}`,
  };
}

/** Minimal remoteStorage HTTP client for one account, used for server-side message writes. */
export function remoteStore(
  baseUrl: string,
  username: string,
  token: string,
  appOrigin = resolveAppOrigin(),
) {
  const url = (path: string) =>
    `${baseUrl}/storage/storage/${encodeURIComponent(username)}/showday/${path}`;
  const authorization = armadiettoStorageHeaders(token, appOrigin);
  const timeout = () => AbortSignal.timeout(10000);
  async function get<T>(path: string) {
    const response = await fetch(url(path), {
      headers: authorization,
      signal: timeout(),
    });
    if (response.status === 404) return { value: undefined, etag: undefined };
    if (!response.ok)
      throw new Error(`Storage read failed (${response.status})`);
    return {
      value: (await response.json()) as T,
      etag: response.headers.get("etag") ?? undefined,
    };
  }
  /** `ifMatch` undefined creates only; a string requires that version. Returns the status so callers can treat 412 as a conflict. */
  async function put(
    path: string,
    body: unknown,
    contentType = "application/json",
    ifMatch?: string,
  ) {
    const response = await fetch(url(path), {
      method: "PUT",
      headers: {
        ...authorization,
        "Content-Type": contentType,
        ...(ifMatch ? { "If-Match": ifMatch } : { "If-None-Match": "*" }),
      },
      body:
        body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body),
      signal: timeout(),
    });
    if (!response.ok && response.status !== 412)
      throw new Error(`Storage write failed (${response.status})`);
    return response.status;
  }
  return {
    get,
    put,
    /** Read-modify-write; a 412 means another writer got there first, so read again. Returns whether anything was written. */
    async update<T>(path: string, change: (current: T | undefined) => T) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { value, etag } = await get<T>(path);
        const next = change(value);
        if (next === value) return false;
        const status = etag
          ? await put(path, next, "application/json", etag)
          : await put(path, next);
        if (status !== 412) return true;
      }
      throw new Error("Storage kept changing; please retry.");
    },
  };
}
export type RemoteStore = ReturnType<typeof remoteStore>;
