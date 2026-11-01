# Gigger

A Bun workspace with a Svelte 5/Vite web app, a TypeScript API using `Bun.serve` and `bun:sqlite`, and shared remoteStorage schemas. Caddy proxies the built web app, API, local Armadietto, and Sockethub with Redis.

## Run locally

Install Docker with Compose, start the Docker daemon, then run:

```sh
cp .env.example .env
make up
make seed
```

Open [http://localhost:8080](http://localhost:8080). Change `PORT` in `.env` if needed. The first build downloads Sockethub source and can take several minutes. `make seed` adds the original example API item and is safe to repeat.

Sign up at `/signup` with a username, email, password, and band name. Signup creates your account and first band, then opens the app. Log in at `/login` with your username and password. Bare usernames use this site's account service; an explicit `username@host` uses that host's standard authorization flow. Sessions survive reloads. Log out from the app to revoke a local session and clear its browser cache after changes finish saving.

Create bands, switch between them, and add members with a name and a phone number or Messenger handle. The all-bands overview lists gigs grouped by status, with upcoming confirmed gigs first.

Only Caddy publishes a port, bound to localhost. The API exposes `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `/api/health`, `/api/items`, and `/api/schemas`. Accounts, password hashes, tokens, and band data live only in Armadietto; the API keeps no user/session tables. The container-only auth hook on port 8001 uses Armadietto's existing account and authorization methods and grants only `gigger:rw`. Duplicate usernames and emails are rejected. Signup initializes the first band on the server and rolls back a new account if initial setup fails. The Armadietto image is pinned by digest and uses its original username routing and password hashing.

Root WebFinger discovery and `/storage/storage/*` still provide remoteStorage access. Authorization/assets routes remain available for standard clients. The app has no storage connection widget or vendor-specific account pages. Sockethub uses `/sockethub`. SQLite retains the starter API items only.

`make down` stops the stack without deleting server data. Armadietto and SQLite persist in named Docker volumes. Delete them only with an explicit `docker compose down -v`. This HTTP setup with app signup is for local development. Deployment needs HTTPS and appropriate access controls. The Armadietto image supports Linux amd64; other architectures need Docker emulation.

## Workspace commands

Install Bun 1.4.2, then:

```sh
bun install --frozen-lockfile
bun run lint
bun run check
bun test
bun run build
```

After `make up`, run the real account integration test with:

```sh
AUTH_TEST_URL=http://localhost:8080/api bun test api/test/auth.integration.test.ts
```

This creates disposable test accounts in the local data volume. CI runs it against its own fresh Compose stack.

`bun run format` applies the single root Biome configuration, including Svelte markup. Tests use the root `bunfig.toml`. CI runs these checks and the full Compose/proxy smoke test. For UI development, run `bun run --filter @gigger/web dev`; use the Compose origin to test account and authorization behavior. Set `APP_ORIGIN` to the exact public origin when using a hostname other than localhost.

## Shared data module

`@gigger/schemas` exports the `Gigger` remoteStorage module, JSON schemas and TypeScript types for band, member, gig and venue. Both web and API import this package. The web uses remoteStorage.js pinned to `2.0.0-beta.10`, claims `gigger:rw`, and caches `/gigger/` for offline use.

Records are private and scoped to a band:

- `/gigger/bands/<bandId>/band`
- `/gigger/bands/<bandId>/members/<memberId>`
- `/gigger/bands/<bandId>/gigs/<gigId>`
- `/gigger/bands/<bandId>/venues/<venueId>`

The module provides `save(kind, bandId, record)`, `bands()`, and `list(kind, bandId)`. IDs accept letters, numbers, underscores and hyphens. Gigs have a title, venue name, address, contacts (free-text strings), local date (`YYYY-MM-DD`), and status (`enquiry`, `offered`, `confirmed`, `played`, `cancelled`). Optional booking details are load-in and soundcheck times (`HH:mm`), set times (an array of `HH:mm`), fee (text including currency), and notes. Dates and times are local to the venue. Gig/venue editing screens are outside this change; these records can be written by clients using the shared module.
