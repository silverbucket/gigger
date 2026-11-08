import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// Dev server only: stand in for Caddy's routing (see Caddyfile and dev/index.ts).
const api = process.env.SHOWDAY_API_URL ?? "http://127.0.0.1:3700";
const storage = process.env.SHOWDAY_STORAGE_URL ?? "http://127.0.0.1:8700";

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      "/api": { target: api, rewrite: (path) => path.replace(/^\/api/, "") },
      "/b": { target: api },
      "/storage": { target: storage },
      "/.well-known": {
        target: storage,
        rewrite: (path) => `/storage${path}`,
      },
    },
  },
});
