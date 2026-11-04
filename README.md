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

Only Caddy publishes a port, bound to localhost. The API exposes `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `/api/public/pages`, `/api/meta/*`, `/api/messages/*`, `/api/health`, `/api/items`, `/api/schemas` and the public band pages under `/b/`. Accounts, password hashes, tokens, and band data live only in Armadietto; the API keeps no user/session tables. The container-only auth hook on port 8001 uses Armadietto's existing account and authorization methods and grants only `gigger:rw`. Duplicate usernames and emails are rejected. Signup initializes the first band on the server and rolls back a new account if initial setup fails. The Armadietto image is pinned by digest and uses its original username routing and password hashing.

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

Booking fields include load-in and soundcheck times (`HH:mm`), set times, `setLength` (positive integer minutes), `fee: { amount?: string, extras: string[] }` (amount includes currency), private notes, `contactDate` (optional local date; `date` remains the proposed gig date), `enquiryText`, `enquirySource` and `public: { ticketUrl?: string, description?: string }`. Dates and times are local to the venue. Venues have an optional `city`, shown on the public page.

## Public page

Band settings have a Public page section. Choose an address (lowercase letters, numbers and hyphens; it defaults to the band name) and press Publish page. The app claims the address through `POST /api/public/pages`, which checks the storage token against the band record and keeps only `slug → username, bandId` in SQLite, so an address cannot be pointed at someone else's storage. The band record stores the `slug` and the publishing browser's `locale`.

Once a band has a slug, saving a gig, moving its status or marking it played writes a public copy to `/public/gigger/<slug>/gigs/<gigId>` for confirmed and played gigs, and removes it otherwise (for example when cancelled). The copy holds only the date, first set time as start, venue name, city, ticket URL and public description. The module writes band name and locale to `/public/gigger/<slug>/page`; the API obtains the current public gig records through a narrowly scoped internal storage endpoint. Each gig is stored independently, so concurrent changes to different gigs do not overwrite a shared index. A public removal that cannot be confirmed is queued and retried after sync; the app shows a notice while removal is pending. `publishBand(bandId, previousSlug)` rewrites every copy after the address changes and clears the old address.

The API serves `/b/<slug>` (upcoming gigs first, past gigs below, dates and times in the band's locale), `/b/<slug>/gigs.json`, `/b/<slug>/gigs.ics` (Europe/Prague time; all-day events when no start time is set) and `/b/<slug>/export.zip`, a static bundle of the page, JSON and calendar that the Export static page button downloads. Everything rendered is rebuilt from an allow-list of public fields, so fees, earnings, contacts, notes and survey data never appear even if a stored document carried them. Caddy routes `/b/*` to the API. Changing a venue's name or city updates the public copy the next time each gig is saved. Legacy gigs with free-text venue, address, contacts and fee remain readable; the editor uses linked records for new saves.

The header band picker also filters Bookings; choose All bands for a combined gig list grouped by status, with the band and venue on every row. Opening a gig from that list selects its band. Enquiry forms have collapsible Enquiry, When, Where, Who, Money and Public sections, labelled creation switches and tap-to-select contacts. Empty booking details are hidden. Venue details list gigs played there.

The Venues and Contacts screens list records and open their details for editing. Invalid status changes show “This gig changed somewhere else, reload to see the latest”; the gig date/status line stays visible, and Reload latest refreshes the record and any open edit form.

Other bands you share a bill with are reusable `otherBand` records with `name`, `contactIds` and optional `notes`. Gigs link to them through `otherBandIds`; links and contacts must exist within the same managed band, matching venue/contact scoping. In the Who section, tap existing bands or create a new band inline. Use Other bands to edit a record and link contacts, or open a band from a gig's Playing with list. Updating the band's name or contact links applies wherever that record is reused. These bands do not appear in the managed-band picker.

## Inbox

Messages are ActivityStreams-shaped records (`channel`, `direction`, `conversation`, `bandId`, `actor`, `target`, `object.content`, `object.attachment`, `published`) stored in the account's remoteStorage at `/gigger/conversations/<conversationId>/<yyyy-mm>/<messageId>`, with copied attachments under `.../<yyyy-mm>/files/`. `/gigger/conversations/index` keeps one entry per conversation with the contact, the Page or Instagram account it runs through, the last inbound and outbound times and a preview; the server updates it with `If-Match` and re-reads on a 412. The web app only reads these records; `conversations()` and `messages(conversationId)` on the shared module do that. Conversation IDs are `<channel>-<bandId>-<peer id>`, with email addresses base64url-encoded, so a Page moved to another band starts separate threads.

To receive Messenger and Instagram messages, set `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_CONFIG_ID` (a Facebook Login for Business configuration) and `TOKEN_KEY` (`openssl rand -hex 32`; Page and storage tokens are stored AES-256-GCM encrypted with it; connections made before this key existed are dropped at startup and must be reconnected) in `.env` and point the Meta app's webhook at `/api/meta/webhook` with the same verify token; deliveries are checked against `X-Hub-Signature-256`. Set the app's deauthorize callback to `/api/meta/deauthorize` and its data-deletion callback to `/api/meta/data-deletion`: both verify Meta's `signed_request` and drop every Page connection of that Facebook user, and data deletion answers with a confirmation code and a status URL as App Review requires. Messages already saved in the band's own storage belong to the band and are not touched. All Graph API calls, including the browser's Facebook SDK, use the version in `graphVersion` (`api/src/meta.ts`, currently v26.0). In band settings, press Connect Facebook Page: the browser runs Facebook Login for Business, the API swaps the result for a long-lived Page token, keeps it in SQLite together with a dedicated storage token for the account, and subscribes the app to `messages` and `message_echoes`. Disconnect page unsubscribes and revokes the storage token, and only reports success once both are done; switching to another Page releases the old one first, and a Page can be connected to one band at a time. Webhook events, including echoes of replies sent from Facebook itself (echoes of this app's own replies are skipped), are stored as regular messages and attachments are copied into storage; if storage is unavailable the webhook answers 500 so Meta redelivers, and repeats are deduplicated by message ID. Connect, disconnect and reply require a token that can write to the band.

The Inbox groups conversations by the contact whose Messenger, Instagram or email field matches the sender, or by sender otherwise. Open a conversation to read the thread and reply with one box for every channel. Meta replies are allowed within 24 hours of the contact's last message; with `META_HUMAN_AGENT=1` (the app must hold Meta's Human Agent permission) the window is 7 days, the reply is sent with the `HUMAN_AGENT` tag after the first 24 hours and the Inbox says so above the Send button. A channel whose Sockethub platform is not loaded fails with "<Channel> isn't set up on this server yet." in the reply box; `api/test/sender.test.ts` runs the real sender against a Sockethub stub to keep that path working. Live updates come over `GET /api/messages/events?ticket=…`, where the single-use ticket is issued by `POST /api/messages/ticket` with the storage token and expires after a minute, so no token travels in a URL; `POST /api/messages/reply` saves the outgoing message, then hands it to a channel sender built on a headless `@sockethub/client` (one Sockethub platform per channel, named after the channel). Meta channels only accept replies within 24 hours of the contact's last message; the box is disabled with the reason and the API enforces the same rule. A reply that cannot be delivered stays in the thread marked as not delivered. `GET /api/messages/events` is a server-sent events stream that tells open tabs to sync when a message arrives. From a conversation, create a gig prefilled with the enquiry text, source and contact, or open the gig already linked to it (`conversationId` on the gig).

## Browser tests

Run the real forms against the Compose app (use a disposable stack: browser tests create accounts and records):

```sh
bunx playwright install chromium webkit
make up
bun run test:e2e
```

Set `E2E_BASE_URL` when the stack uses another port, for example `E2E_BASE_URL=http://localhost:18086 bun run test:e2e`. Tests run in desktop Chromium and mobile WebKit, create independent accounts, and use the real account API and remoteStorage service without mocked form submissions. Coverage includes signup validation, band and gig currencies, booking drafts and required fields, survey cancellation, earnings calculations and persistence, venue/earnings separation, gig-sheet print styles, and publishing the public page. `bun test` continues to run unit and storage tests separately.

CI runs the browser suite after starting its fresh Compose stack. Failures retain screenshots and Playwright traces in the `browser-test-results` artifact for seven days. See [Playwright's trace options](https://playwright.dev/docs/test-use-options#recording-options) for inspecting failures. This checks browser print styles, not a physical printer.
