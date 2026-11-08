import { expect, test } from "bun:test";

/** Runs against `make up-test`: real API container, auth, Armadietto, and translate-stub. */
const base = process.env.AUTH_TEST_URL;

test.skipIf(!base)(
  "translate proxies cs to en through the test stack",
  async () => {
    const username = `tr-${crypto.randomUUID()}`;
    const password = crypto.randomUUID();
    const signup = await fetch(`${base}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        email: `${username}@example.com`,
        bandName: "Integration Band",
        currency: "CZK",
      }),
    });
    expect(signup.status).toBe(201);
    const { token } = await signup.json();
    const translate = (body: unknown) =>
      fetch(`${base}/translate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    const invalid = await translate({
      username,
      body: "",
      target: "en",
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe("Invalid request.");
    const csBody = "Dobrý den, hledáme termín koncertu.";
    const ok = await translate({
      username,
      subject: "Nabídka",
      body: csBody,
      target: "en",
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      subject: `In English: Nabídka`,
      body: `In English: ${csBody}`,
    });
  },
  30000,
);
