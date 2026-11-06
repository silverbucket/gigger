import { expect, test } from "bun:test";

const base = process.env.AUTH_TEST_URL;

test.skipIf(!base)(
  "real account signup, duplicate rejection, login, scoped access and logout",
  async () => {
    const username = `signup-${crypto.randomUUID()}`;
    const email = `signup+${crypto.randomUUID()}@example.com`;
    const password = crypto.randomUUID();
    const credentials = {
      username,
      email,
      password,
      bandName: "Integration Band",
      currency: "CZK",
    };
    const post = (action: string, body: unknown, token?: string) =>
      fetch(`${base}/auth/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    const signup = await post("signup", credentials);
    expect(signup.status).toBe(201);
    const session = await signup.json();
    expect(session.username).toBe(username);
    expect((await post("signup", credentials)).status).toBe(409);
    expect(
      (
        await post("signup", {
          ...credentials,
          username: `other-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(409);
    expect(
      (await post("login", { ...credentials, password: "wrong" })).status,
    ).toBe(401);
    const login = await post("login", { username, password });
    expect(login.status).toBe(200);
    const { token } = await login.json();
    const origin = new URL(base ?? "").origin;
    const address = `${encodeURIComponent(username)}@${new URL(origin).host}`;
    const discovery = await (
      await fetch(
        `${origin}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${address}`)}`,
      )
    ).json();
    const storageUrl = discovery.links[0].href;
    expect(storageUrl).toBe(
      `${origin}/storage/storage/${encodeURIComponent(username)}`,
    );
    const headers = { Authorization: `Bearer ${token}` };
    const listing = await fetch(`${storageUrl}/showday/bands/`, { headers });
    expect(listing.status).toBe(200);
    const folders = Object.keys((await listing.json()).items);
    expect(folders).toHaveLength(1);
    const band = await (
      await fetch(`${storageUrl}/showday/bands/${folders[0]}band`, { headers })
    ).json();
    expect(band.name).toBe("Integration Band");
    expect(band.currency).toBe("CZK");
    expect((await fetch(`${storageUrl}/other/`, { headers })).status).toBe(403);
    expect((await fetch(`${storageUrl}/showday/`)).status).toBe(403);
    expect((await post("logout", { username }, token)).status).toBe(200);
    expect((await fetch(`${storageUrl}/showday/`, { headers })).status).toBe(
      403,
    );
    expect((await post("logout", { username }, session.token)).status).toBe(
      200,
    );
  },
  30000,
);
