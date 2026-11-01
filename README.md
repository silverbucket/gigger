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

Create bands, switch between them, and add members with a name and a phone number or Messenger handle. The all-bands overview lists gigs grouped by status, with upcoming confirmed gigs first. Data is saved locally in the browser first. To sync, create an account at `/storage/`, then enter `username@localhost:8080` in Gigger's Connect form (use your configured host and port). Authorize the `gigger` scope on Armadietto. Disconnect clears this browser's connected storage cache; wait for sync before disconnecting if you have local changes.

Only Caddy publishes a port, bound to localhost. Root WebFinger discovery proxies to Armadietto; storage and OAuth endpoints are under `/storage/`. Sockethub uses `/sockethub`. The API exposes `/api/health`, `/api/items`, and `/api/schemas`. Band data belongs to remoteStorage; the API does not copy private band/member data into SQLite.

`make down` stops the stack without deleting server data. Armadietto and SQLite persist in named Docker volumes. Delete them only with an explicit `docker compose down -v`. This HTTP setup with open signup is for local development. Deployment needs HTTPS and appropriate access controls. The Armadietto image supports Linux amd64; other architectures need Docker emulation.

## Workspace commands

Install Bun 1.4.2, then:

```sh
bun install --frozen-lockfile
bun run lint
bun run check
bun test
bun run build
```

`bun run format` applies the single root Biome configuration, including Svelte markup. Tests use the root `bunfig.toml`. CI runs these checks and the full Compose/proxy smoke test. For UI development, run `bun run --filter @gigger/web dev`; use the Compose origin to test local storage discovery and OAuth.

## Shared data module

`@gigger/schemas` exports the `Gigger` remoteStorage module, JSON schemas and TypeScript types for band, member, gig and venue. Both web and API import this package. The web uses remoteStorage.js pinned to `2.0.0-beta.10`, claims `gigger:rw`, and caches `/gigger/` for offline use.

Records are private and scoped to a band:

- `/gigger/bands/<bandId>/band`
- `/gigger/bands/<bandId>/members/<memberId>`
- `/gigger/bands/<bandId>/gigs/<gigId>`
- `/gigger/bands/<bandId>/venues/<venueId>`

The module provides `save(kind, bandId, record)`, `bands()`, and `list(kind, bandId)`. IDs accept letters, numbers, underscores and hyphens. Gigs have a title, venue name, address, contacts (free-text strings), local date (`YYYY-MM-DD`), and status (`enquiry`, `offered`, `confirmed`, `played`, `cancelled`). Optional booking details are load-in and soundcheck times (`HH:mm`), set times (an array of `HH:mm`), fee (text including currency), and notes. Dates and times are local to the venue. Gig/venue editing screens are outside this change; these records can be written by clients using the shared module.
