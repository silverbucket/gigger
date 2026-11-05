import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemas } from "@gigger/schemas";
import { openDatabase } from "../src/db";
import { seed } from "../src/seed";
import { handler } from "../src/server";

test("seed persists once and Bun HTTP routes preserve the API", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gigger-"));
  const path = join(dir, "test.sqlite");
  const initial = openDatabase(path);
  seed(initial);
  seed(initial);
  initial.close();
  const db = openDatabase(path);
  const server = Bun.serve({ port: 0, fetch: handler(db) });
  try {
    expect(await (await fetch(new URL("/items", server.url))).json()).toEqual([
      { id: 1, name: "Welcome to Showday" },
    ]);
    expect(await (await fetch(new URL("/health", server.url))).json()).toEqual({
      status: "ok",
    });
    expect(await (await fetch(new URL("/schemas", server.url))).json()).toEqual(
      schemas,
    );
    expect((await fetch(new URL("/missing", server.url))).status).toBe(404);
    expect(
      (await fetch(new URL("/items", server.url), { method: "POST" })).status,
    ).toBe(404);
  } finally {
    server.stop(true);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
