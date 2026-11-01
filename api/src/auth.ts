export function authHandler(
  baseUrl = process.env.ARMADIETTO_AUTH_URL ?? "http://armadietto:8001",
  appOrigin = process.env.APP_ORIGIN ?? "http://localhost:8080",
) {
  return async (req: Request, action: string) => {
    const headers = { "Cache-Control": "no-store" };
    if (req.headers.get("origin") && req.headers.get("origin") !== appOrigin)
      return Response.json(
        { error: "Invalid request origin." },
        { status: 403, headers },
      );
    if (!req.headers.get("content-type")?.startsWith("application/json"))
      return Response.json(
        { error: "Expected JSON." },
        { status: 415, headers },
      );
    let input: unknown;
    try {
      input = await req.json();
    } catch {
      return Response.json(
        { error: "Invalid request." },
        { status: 400, headers },
      );
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      return Response.json(
        { error: "Invalid request." },
        { status: 400, headers },
      );
    const { username, email, password, bandName } = input as Record<
      string,
      unknown
    >;
    try {
      const response = await fetch(`${baseUrl}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email,
          password,
          bandName,
          token: req.headers.get("authorization")?.replace(/^Bearer /, ""),
        }),
        signal: AbortSignal.timeout(15000),
      });
      return Response.json(await response.json(), {
        status: response.status,
        headers,
      });
    } catch {
      return Response.json(
        { error: "Account service unavailable. Please retry." },
        { status: 503, headers },
      );
    }
  };
}
