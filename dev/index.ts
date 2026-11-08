/**
 * `bun run dev`: the whole app without Docker. Vite serves the web app with
 * hot reload and proxies to the API, which runs under `bun --watch`; accounts
 * and records live in the in-memory storage from `./storage.ts`, saved to
 * `.dev/`; translation is the test stub. Sockethub is not started, so
 * replies are recorded as not delivered.
 */
import { mkdirSync } from "node:fs";
import { demoAccount, seedDemo } from "./seed";
import { startDevStorage } from "./storage";

const root = new URL("..", import.meta.url).pathname;
const port = {
  web: Number(process.env.DEV_WEB_PORT ?? 5173),
  api: Number(process.env.DEV_API_PORT ?? 3700),
  storage: Number(process.env.DEV_STORAGE_PORT ?? 8700),
  auth: Number(process.env.DEV_AUTH_PORT ?? 8701),
  translate: Number(process.env.DEV_TRANSLATE_PORT ?? 5700),
};
const appOrigin = `http://localhost:${port.web}`;
mkdirSync(`${root}.dev`, { recursive: true });

const storage = startDevStorage({
  file: `${root}.dev/storage.json`,
  storagePort: port.storage,
  authPort: port.auth,
  appOrigin,
});
const seeded =
  process.env.DEV_SEED === "0"
    ? false
    : await seedDemo(storage.store, appOrigin);

const children: ReturnType<typeof Bun.spawn>[] = [];
const spawn = (cmd: string[], env: Record<string, string>, cwd = root) => {
  const child = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  children.push(child);
  return child;
};
spawn(["bun", "test/translate-stub.ts"], { PORT: `${port.translate}` });
spawn(["bun", "--watch", "api/src/server.ts"], {
  PORT: `${port.api}`,
  DATABASE_PATH: `${root}.dev/showday.sqlite`,
  ARMADIETTO_URL: storage.storageUrl,
  ARMADIETTO_AUTH_URL: storage.authUrl,
  APP_ORIGIN: appOrigin,
  SOCKETHUB_URL: process.env.SOCKETHUB_URL ?? "http://127.0.0.1:10550",
  LIBRETRANSLATE_URL: `http://127.0.0.1:${port.translate}`,
  // Any 32-byte hex key; only encrypts settings in the local SQLite file.
  TOKEN_KEY:
    process.env.TOKEN_KEY ??
    "5d41402abc4b2a76b9719d911017c592a3f0d6e1b8c47a2f9e0b1c3d5e7f9a1b",
});
spawn(
  ["bun", "run", "dev", "--", "--port", `${port.web}`, "--strictPort"],
  {
    SHOWDAY_API_URL: `http://127.0.0.1:${port.api}`,
    SHOWDAY_STORAGE_URL: storage.storageUrl,
  },
  `${root}web`,
);

console.log(`
Showday dev
  app       ${appOrigin}
  api       http://127.0.0.1:${port.api}
  storage   ${storage.storageUrl} (saved to .dev/storage.json)
  login     ${demoAccount.username} / ${demoAccount.password}${seeded ? " (demo data created)" : ""}
`);

const shutdown = () => {
  for (const child of children) child.kill();
  storage.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// If a child dies, bring the rest down so the failure is obvious.
for (const child of children)
  void child.exited.then((code) => {
    if (code !== 0 && code !== null) {
      console.error(`a dev process exited with ${code}`);
      shutdown();
    }
  });
