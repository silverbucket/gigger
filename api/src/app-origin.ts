/** Default browser origin when `APP_ORIGIN` is unset (local development). */
export const DEFAULT_APP_ORIGIN = "http://localhost:8080";

export function resolveAppOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return env.APP_ORIGIN ?? DEFAULT_APP_ORIGIN;
}
