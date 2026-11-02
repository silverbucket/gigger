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

All worktrees use the shared Compose project name `gigger`. Run `make down` before switching worktrees, then `make up` in the worktree you want to run. `make seed` and plain `docker compose` commands use the same stack and data volumes. Older stacks named after individual worktrees need a one-time shutdown; their data volumes remain separate. An explicit `-p` flag or `COMPOSE_PROJECT_NAME` overrides the shared name.

Sign up at `/signup` with a username, email, password, and band name. Signup creates your account and first band, then opens the app. Log in at `/login` with your username and password. Bare usernames use this site's account service; an explicit `username@host` uses that host's standard authorization flow. Sessions survive reloads. Log out from the header to clear the browser session immediately and notify other open Gigger tabs to log out too. The login button remains available during local cache cleanup; if cleanup is blocked, it reports that storage is still clearing and can be retried after closing other tabs. Local token revocation runs in the background; logout does not wait for pending changes to sync.

Use “+ New band” to create bands, switch between them, and add members with just a name. Email address, phone number and Messenger handle are optional. The private account owner acts as the band leader and can edit or remove members. The all-bands overview lists gigs grouped by status, with upcoming confirmed gigs first.

Only Caddy publishes a port, bound to localhost. The API exposes `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `/api/health`, `/api/items`, and `/api/schemas`. Accounts, password hashes, tokens, and band data live only in Armadietto; the API keeps no user/session tables. The container-only auth hook on port 8001 uses Armadietto's existing account and authorization methods and grants only `gigger:rw`. Duplicate usernames and emails are rejected. Signup initializes the first band on the server and rolls back a new account if initial setup fails. The Armadietto image is pinned by digest and uses its original username routing and password hashing.

Root WebFinger discovery and `/storage/storage/*` still provide remoteStorage access. Authorization/assets routes remain available for standard clients. The app has no storage connection widget or vendor-specific account pages. Sockethub uses `/sockethub`. SQLite retains the starter API items only.

`make down` stops the stack without deleting server data. Armadietto and SQLite persist in named Docker volumes. Delete them only with an explicit `docker compose down -v`. This HTTP setup with app signup is for local development. Deployment needs HTTPS and appropriate access controls. The Armadietto image supports Linux amd64; other architectures need Docker emulation.

## Workspace commands

Install Bun 1.4.4, then:

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

`@gigger/schemas` exports the `Gigger` remoteStorage module, JSON schemas and TypeScript types for band, member, gig, venue, contact and otherBand. Both web and API import this package. The web uses remoteStorage.js pinned to `2.0.0-beta.10`, claims `gigger:rw`, and caches `/gigger/` for offline use.

Records are private and scoped to a band:

- `/gigger/bands/<bandId>/band`
- `/gigger/bands/<bandId>/members/<memberId>`
- `/gigger/bands/<bandId>/gigs/<gigId>`
- `/gigger/bands/<bandId>/venues/<venueId>`
- `/gigger/bands/<bandId>/contacts/<contactId>`
- `/gigger/bands/<bandId>/otherBands/<otherBandId>`

The module provides `save(kind, bandId, record)`, `bands()`, and `list(kind, bandId)`. IDs accept letters, numbers, underscores and hyphens. Gigs link to a venue with `venueId` and contacts with `contactIds`; linked records must exist within the same band. Venues have a name and address. Contacts have a name and optional email, phone, Messenger, Instagram and notes.

Use Bookings to choose a band and create a new enquiry: paste the message, explicitly choose its required source (Messenger, Instagram, email or other; no default), contact date, proposed gig date and venue. Contact date defaults to today for new enquiries and can be edited independently of the proposed gig date. Existing venues and contacts can be selected or created inline. Enquiries start with status `enquiry`. Open a gig to edit booking details or move its status: enquiry → offered → confirmed → played. Enquiry, offered and confirmed can also move to cancelled. Played and cancelled are terminal. The module rejects invalid status changes; saving edits without changing status is allowed. Status buttons use `moveGigStatus(bandId, gigId, status)` to update the latest stored gig without replacing synced booking details. Booking lists and open gig details refresh after sync while edit drafts are preserved.

Booking fields include load-in and soundcheck times (`HH:mm`), set times, `setLength` (positive integer minutes), `fee: { amount?: string, extras: string[] }` (amount includes currency), private notes, `contactDate` (optional local date; `date` remains the proposed gig date), `enquiryText`, `enquirySource` and `public: { ticketUrl?: string, description?: string }`. The public fields describe event information but remain in private storage; they are not published. Dates and times are local to the venue. Legacy gigs with free-text venue, address, contacts and fee remain readable; the editor uses linked records for new saves.

The header band picker also filters Bookings; choose All bands for a combined gig list grouped by status, with the band and venue on every row. Opening a gig from that list selects its band. Enquiry forms have collapsible Enquiry, When, Where, Who, Money and Public sections, labelled creation switches and tap-to-select contacts. Empty booking details are hidden. Venue details list gigs played there.

The Venues and Contacts screens list records and open their details for editing. Invalid status changes show “This gig changed somewhere else, reload to see the latest”; the gig date/status line stays visible, and Reload latest refreshes the record and any open edit form.

Other bands you share a bill with are reusable `otherBand` records with `name`, `contactIds` and optional `notes`. Gigs link to them through `otherBandIds`; links and contacts must exist within the same managed band, matching venue/contact scoping. In the Who section, tap existing bands or create a new band inline. Use Other bands to edit a record and link contacts, or open a band from a gig's Playing with list. Updating the band's name or contact links applies wherever that record is reused. These bands do not appear in the managed-band picker.

## Browser tests

Run the real forms against the Compose app (use a disposable stack: browser tests create accounts and records):

```sh
bunx playwright install chromium webkit
make up
bun run test:e2e
```

Set `E2E_BASE_URL` when the stack uses another port, for example `E2E_BASE_URL=http://localhost:18086 bun run test:e2e`. Tests run in desktop Chromium and mobile WebKit, create independent accounts, and use the real account API and remoteStorage service without mocked form submissions. Coverage includes signup validation, band and gig currencies, booking drafts and required fields, survey cancellation, earnings calculations and persistence, venue/earnings separation, and gig-sheet print styles. `bun test` continues to run unit and storage tests separately.

CI runs the browser suite after starting its fresh Compose stack. Failures retain screenshots and Playwright traces in the `browser-test-results` artifact for seven days. See [Playwright's trace options](https://playwright.dev/docs/test-use-options#recording-options) for inspecting failures. This checks browser print styles, not a physical printer.
