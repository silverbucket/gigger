import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { authHandler } from "../src/auth";
import { openDatabase } from "../src/db";
import { handler } from "../src/server";

const { createAuthHandler } = createRequire(import.meta.url)(
  "../../armadietto/auth.cjs",
);

test("signup, login, duplicate email and logout through the API without an account database", async () => {
  const users = new Map<
    string,
    { email: string; password: string; token?: string }
  >();
  const records = new Map();
  const store = {
    readAuth: async (email: string) => users.get(email),
    findUserByEmail: async (email: string) =>
      [...users.values()].some((user) => user.email === email),
    createUser: async ({
      username,
      email,
      password,
    }: {
      username: string;
      email: string;
      password: string;
    }) => users.set(username, { email, password }),
    authenticate: async ({
      username,
      password,
    }: {
      username: string;
      password: string;
    }) => {
      if (users.get(username)?.password !== password) throw new Error("Denied");
    },
    authorize: async (client: string, email: string, permissions: unknown) => {
      expect(client).toBe("http://localhost:8080");
      expect(permissions).toEqual({ gigger: ["r", "w"] });
      const token = crypto.randomUUID();
      const user = users.get(email);
      if (!user) throw new Error("Missing user");
      user.token = token;
      return token;
    },
    revokeAccess: async (email: string, token: string) => {
      const user = users.get(email);
      if (user?.token === token) delete user.token;
    },
    put: async (email: string, path: string, _type: string, body: Buffer) => {
      records.set(email + path, JSON.parse(body.toString()));
      return { created: true };
    },
    removeUser: async (email: string) => users.delete(email),
  };
  const internal = createAuthHandler(store, "http://localhost:8080");
  const backend = Bun.serve({
    port: 0,
    async fetch(req) {
      const result = await internal(
        new URL(req.url).pathname.slice(1),
        await req.json(),
      );
      return Response.json(result.body, { status: result.status });
    },
  });
  const db = openDatabase(":memory:");
  const request = handler(db, authHandler(backend.url.origin));
  const post = (action: string, body: unknown, headers = {}) =>
    request(
      new Request(`http://localhost:8080/auth/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );
  try {
    const credentials = {
      username: "Sam",
      email: "Sam+band@Example.com",
      password: "password123",
      bandName: "The Testers",
      currency: "czk",
    };
    const signup = await post("signup", credentials);
    expect(signup.status).toBe(201);
    expect(signup.headers.get("cache-control")).toBe("no-store");
    const session = await signup.json();
    expect(session.username).toBe("sam");
    expect(session.token).toBeString();
    expect([...records.values()][0].name).toBe("The Testers");
    expect([...records.values()][0].currency).toBe("CZK");
    expect([...records.keys()][0]).toMatch(/^sam\/gigger\/bands\/[^/]+\/band$/);
    expect(
      (
        await post("signup", {
          ...credentials,
          username: "different",
          email: "sam+band@example.com",
        })
      ).status,
    ).toBe(409);
    expect(
      (await post("login", { ...credentials, password: "incorrect" })).status,
    ).toBe(401);
    expect(
      (await post("login", { ...credentials, username: "nobody" })).status,
    ).toBe(401);
    const login = await post("login", credentials);
    expect(login.status).toBe(200);
    const loggedIn = await login.json();
    expect(
      (
        await post(
          "logout",
          { username: session.username },
          { Authorization: `Bearer ${loggedIn.token}` },
        )
      ).status,
    ).toBe(200);
    expect(users.get(session.username)?.token).toBeUndefined();
    expect(
      (await post("signup", { ...credentials, username: "../escape" })).status,
    ).toBe(400);
    expect(
      (await post("signup", { ...credentials, password: "short" })).status,
    ).toBe(400);
    expect(
      (await post("signup", { ...credentials, bandName: " " })).status,
    ).toBe(400);
    expect(
      (await post("signup", { ...credentials, currency: "EURO" })).status,
    ).toBe(400);
    expect(
      (
        await post("login", credentials, {
          Origin: "https://unrelated.example",
        })
      ).status,
    ).toBe(403);
    const concurrent = await Promise.all([
      post("signup", {
        ...credentials,
        username: "race1",
        email: "race@example.com",
      }),
      post("signup", {
        ...credentials,
        username: "race2",
        email: "race@example.com",
      }),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const originalPut = store.put;
    store.put = async () => {
      throw new Error("Disk unavailable");
    };
    await expect(
      internal("signup", {
        username: "rollback",
        email: "rollback@example.com",
        password: "password123",
        bandName: "Band",
      }),
    ).rejects.toThrow("Disk unavailable");
    expect(users.has("rollback")).toBe(false);
    store.put = originalPut;
    expect(
      db.query("SELECT name FROM sqlite_master WHERE type='table'").all(),
    ).toEqual([{ name: "items" }]);
  } finally {
    backend.stop(true);
    db.close();
  }
});
