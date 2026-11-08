/** Minimal LibreTranslate-shaped stub for local tests and CI. */
const port = Number(process.env.PORT ?? 5000);
Bun.serve({
  hostname: "0.0.0.0",
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health")
      return Response.json({ status: "ok" });
    if (req.method !== "POST" || url.pathname !== "/translate")
      return new Response("Not found", { status: 404 });
    let body: {
      q?: string;
      source?: string;
      target?: string;
    };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const text = typeof body.q === "string" ? body.q : "";
    const target = body.target === "cs" ? "cs" : "en";
    const translated =
      target === "cs" ? `Česky: ${text}` : `In English: ${text}`;
    return Response.json({ translatedText: translated });
  },
});
