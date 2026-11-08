# Showday

A Bun workspace with a Svelte 5/Vite web app, a TypeScript API using `Bun.serve` and `bun:sqlite`, and shared remoteStorage schemas. Caddy proxies the built web app, API, local Armadietto, and Sockethub with Redis.

## Run locally

Install Docker with Compose, start the Docker daemon, then run:

```sh
cp .env.example .env
make up
make seed
```

Open [http://localhost:8080](http://localhost:8080). Change `PORT` in `.env` if needed. The first build downloads Sockethub source and can take several minutes. `make seed` adds the original example API item and is safe to repeat.

All worktrees use the shared Compose project name `showday`. Run `make down` before switching worktrees, then `make up` in the worktree you want to run. `make seed` and plain `docker compose` commands use the same stack and data volumes. Older stacks named after individual worktrees need a one-time shutdown; their data volumes remain separate. An explicit `-p` flag or `COMPOSE_PROJECT_NAME` overrides the shared name.

Sign up at `/signup` with a username, email, password, and band name. Signup creates your account and first band, then opens the app. Log in at `/login` with your username and password. Bare usernames use this site's account service; an explicit `username@host` uses that host's standard authorization flow. Sessions survive reloads. Log out from the header to clear the browser session immediately and notify other open Showday tabs to log out too. Logging in or signing up right after a logout waits for the local cache to finish clearing; if that takes longer than 30 seconds (another tab holding it open, say), the form asks you to try again. A cache whose clearing was cut short by a reload or a closed tab is cleared on the next start before anyone can log in. Local token revocation runs in the background; logout does not wait for pending changes to sync. If the server rejects the session's token (revoked, expired, or issued for another scope), the app returns to the login screen with "Please log in again." and keeps the local cache: changes that had not synced yet go up once the same account logs in again, while logging in with a different account clears them first. A `username@host` address for a different account asks before clearing them, because that host checks the login only after the page has left; saying no keeps them. Failed syncs retry quietly; after two minutes of failures a status line says that changes are not syncing, and it stays until a sync gets through.

On the Band & public page screen, use New band to create bands, switch between them, and add members with just a name. Email address, phone number and Messenger handle are optional; when a new member's name matches a contact, the app offers to copy the contact's details. The private account owner acts as the band leader and can edit or remove members.

Only Caddy publishes a port, bound to localhost. The API exposes `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout`, `/api/public/pages`, `/api/meta/*`, `/api/messages/*`, `/api/health`, `/api/items`, `/api/schemas` and the public band pages under `/b/`. Accounts, password hashes, tokens, and band data live only in Armadietto; the API keeps no user/session tables. The container-only auth hook on port 8001 uses Armadietto's existing account and authorization methods and grants `showday:rw`. Duplicate usernames and emails are rejected. Signup initializes the first band on the server under `/showday/` and rolls back a new account if initial setup fails. The Armadietto image is pinned by digest and uses its original username routing and password hashing.

Root WebFinger discovery and `/storage/storage/*` still provide remoteStorage access. Authorization/assets routes remain available for standard clients. The app has no storage connection widget or vendor-specific account pages. Sockethub uses `/sockethub`. SQLite retains the starter API items only.

`make down` stops the stack without deleting server data. Armadietto and SQLite persist in named Docker volumes. Delete them only with an explicit `docker compose down -v`. This HTTP setup with app signup is for local development. Deployment needs HTTPS and appropriate access controls. The Armadietto image supports Linux amd64; other architectures need Docker emulation.

## Develop without Docker

For day-to-day work on features and design, skip Compose:

```sh
bun install --frozen-lockfile
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) and log in as `demo` / `demodemo`. `dev/index.ts` starts Vite with hot module reload and proxies `/api`, `/b`, `/storage` and `/.well-known` the way the Caddyfile does; the API runs natively under `bun --watch`, so server edits restart it in well under a second; `dev/storage.ts` replaces the Armadietto container with an in-memory remoteStorage server and the same account hook (`armadietto/auth.cjs`), saved to `.dev/storage.json` so accounts and records survive restarts; the LibreTranslate stub from `test/` answers translations. On the first start `dev/seed.ts` creates the demo account with members, venues, contacts and gigs in every status. Sign up for more accounts as usual.

What the dev stack does not run: Sockethub (replies and mailbox watchers fail with a visible error, so use `make up-test` for channel work), Caddy and real Armadietto (the fake implements the remoteStorage spec the app uses, with ETags, conditional requests, folder listings and public reads, but no OAuth page, so `username@host` logins against it do not work). Ports are `DEV_WEB_PORT` 5173, `DEV_API_PORT` 3700, `DEV_STORAGE_PORT` 8700, `DEV_AUTH_PORT` 8701 and `DEV_TRANSLATE_PORT` 5700; none clash with the Compose stack, so both can run at once. Delete `.dev/` to start from scratch, or set `DEV_SEED=0` to skip the demo account.

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

`bun run format` applies the single root Biome configuration, including Svelte markup. Tests use the root `bunfig.toml`. CI runs these checks and the full Compose/proxy smoke test. For UI development, run `bun run dev` (see Develop without Docker); use the Compose origin to test real Armadietto authorization and Sockethub behavior. Set `APP_ORIGIN` to the exact public origin when using a hostname other than localhost.

## Shared data module

`@showday/schemas` exports the `Showday` remoteStorage module, JSON schemas and TypeScript types for band, member, gig, venue, contact and otherBand. Both web and API import this package. The web uses remoteStorage.js pinned to `2.0.0-beta.10`, claims `showday:rw`, and caches `/showday/` for offline use.

Records are private and scoped to a band:

- `/showday/bands/<bandId>/band`
- `/showday/bands/<bandId>/members/<memberId>`
- `/showday/bands/<bandId>/gigs/<gigId>`
- `/showday/bands/<bandId>/venues/<venueId>`
- `/showday/bands/<bandId>/surveys/<gigId>`
- `/showday/bands/<bandId>/triages/<conversationId>` (a conversation marked “Not a booking”)
- `/showday/bands/<bandId>/contacts/<contactId>`
- `/showday/bands/<bandId>/otherBands/<otherBandId>`


The module provides `save(kind, bandId, record)`, `bands()`, and `list(kind, bandId)`. IDs accept letters, numbers, underscores and hyphens. Gigs link to a venue with `venueId` and contacts with `contactIds`; linked records must exist within the same band. Venues have a name and address. Contacts have a name and optional email, phone, Messenger, Instagram and notes.

Use Gigs (or New gig anywhere) to choose a band and create a new gig: paste the message, explicitly choose its required source (Messenger, Instagram, email or other; no default), contact date, proposed gig date and venue. Contact date defaults to today for new enquiries and can be edited independently of the proposed gig date. Existing venues and contacts can be selected or created inline. Enquiries start with status `enquiry`. Open a gig to edit booking details or move its status: enquiry → offered → confirmed → played. Enquiry, offered and confirmed can also move to cancelled. Played and cancelled are terminal. The module rejects invalid status changes; saving edits without changing status is allowed. Status buttons use `moveGigStatus(bandId, gigId, status)` to update the latest stored gig without replacing synced booking details. Booking lists and open gig details refresh after sync while edit drafts are preserved.

Booking fields include load-in and soundcheck times (`HH:mm`), set times, `setLength` (positive integer minutes), `fee: { amount?: string, extras: string[] }` (amount includes currency), private notes, `contactDate` (optional local date; `date` remains the proposed gig date), `enquiryText`, `enquirySource` and `public: { ticketUrl?: string, description?: string }`. Dates and times are local to the venue. Venues have an optional `city`, shown on the public page. Gigs can also hold `availability` (member ID → `yes`, `no` or `maybe`, where `maybe` means asked with no reply yet; members without an entry were not asked), and `sheetSentAt`/`sheetSentTo` for the last gig sheet sent. Venue surveys have an optional `attendance` (people on the night).

## Public page

Band settings have a Public page section. Choose an address (lowercase letters, numbers and hyphens; it defaults to the band name) and press Publish page. The app claims the address through `POST /api/public/pages`, which checks the storage token against the band record and keeps only `slug → username, bandId` in SQLite, so an address cannot be pointed at someone else's storage. The band record stores the `slug` and the publishing browser's `locale`.

Once a band has a slug, saving a gig, moving its status or marking it played writes a public copy to `/public/showday/<slug>/gigs/<gigId>` for confirmed and played gigs, and removes it otherwise (for example when cancelled). The copy holds only the date, first set time as start, venue name, city, ticket URL and public description. The module writes band name and locale to `/public/showday/<slug>/page`; the API obtains the current public gig records through a narrowly scoped internal storage endpoint. Each gig is stored independently, so concurrent changes to different gigs do not overwrite a shared index. A public removal that cannot be confirmed is queued and retried after sync; the app shows a notice while removal is pending. `publishBand(bandId, previousSlug)` rewrites every copy after the address changes and clears the old address.

The API serves `/b/<slug>` (upcoming gigs first, past gigs below, dates and times in the band's locale), `/b/<slug>/gigs.json`, `/b/<slug>/gigs.ics` (Europe/Prague time; all-day events when no start time is set) and `/b/<slug>/export.zip`, a static bundle of the page, JSON and calendar that the Export static page button downloads. Everything rendered is rebuilt from an allow-list of public fields, so fees, earnings, contacts, notes and survey data never appear even if a stored document carried them. Caddy routes `/b/*` to the API. Changing a venue's name or city updates the public copy the next time each gig is saved. Legacy gigs with free-text venue, address, contacts and fee remain readable; the editor uses linked records for new saves.

## Screens

The interface follows the design rules in `DESIGN.md`, in light and dark. On a desktop a sidebar holds the band picker and the sections (Gigs, Inbox, Contacts, Venues, Other bands, Your band, Settings), and every record screen is a list with a detail pane beside it; on a phone the list and the record are separate screens with a bottom tab bar (Gigs, Inbox, Contacts, Venues, Band) and Settings behind the top-bar icon. The open record is in the address (`#/bookings/gig/<bandId>/<gigId>`, `#/inbox/<conversationId>`, `#/venues/<id>`, …), so reloads and the back button keep your place. Old `#/bookings/message/<id>` links open the conversation in the Inbox.

- **Gigs**: the next gig as a card with its times, then gigs by month (date tile, title, venue, status, how many members are in, fee or take-home), showing upcoming gigs by default with Past (played, cancelled and past-dated) one tap away, and searchable. A List/Board switch shows the same gigs as one column per status. The band picker filters everything; All bands combines the bands' gigs and messages.
- **Inbox**: every conversation, filtered To sort (the default, with a count in the nav), Booked (linked to a gig), Set aside (not a booking or discarded) or All; a search looks through all of them. A conversation opens as a chat thread, oldest first, with the reply box pinned underneath. Beside it (above it on a phone) sit the linked gig (status, date, venue, times, fee, who's in) and the contact (how to reach them, notes, other gigs together); a conversation still to sort shows what was read from the message with Add as gig, Not a booking and Discard.
- **Gig**: status steps, times, band availability (tap a member to cycle not asked → available → can't make it → no reply; on a phone use In, Out and Ask, which opens the member's email, SMS or Messenger with the question), where, who, money (marked Private), enquiry, public text and notes. Send to members emails the gig sheet (on a phone, the share sheet) and records when and to whom (`sheetSentAt`, `sheetSentTo`). Print prints only the gig sheet. Status moves follow `statusMoves`; Cancel gig asks first.
- **Gig form**: source, dates, title and venue up front; When, Who, Money (Private), Public page (Public) and Message and notes (Private) fold away and open by themselves when a field inside is invalid. Venues, contacts and other bands are picked with a search box that ranks matches (accent-insensitive) and always ends with “Create … as new”.
- **Mark played**: one long form, the room (rating, capacity, attendance, setting, play again, PA, stage notes) then the money, with the total and take-home in a bar that stays on screen.
- **Venues**: survey averages in the list (rating, usual capacity, would return, gigs); the venue shows four stat cells, the capacities reported, every survey with its tags and notes, and the gigs played there.
- **Contacts**: private to you and never published; how to reach each person (email, phone, Messenger, Instagram), the venues and bands they work with, notes and gigs. A contact linked to gigs or other bands can't be removed until those links go.
- **Band & public page**: members, the public page, currency, Messenger/Instagram and email connections, your bands and Log out.

Invalid status changes show “This gig changed somewhere else, reload to see the latest” with a Reload latest button. Edit forms keep what you typed while other changes sync in.

### Design system

`web/src/styles/theme.css` holds the light and dark tokens and shared component classes; `web/src/styles/app.css` adds app-wide layout rules on top. Screens are built from the components in `web/src/components/`: Sidebar, TabBar, BandPicker, PhoneHeader, ListDetailLayout, SectionLabel, DetailSection, LedgerRow, MessageRow, ChannelIcon, StatusSteps, StatCells, AvailabilityCells, ChannelGrid, Rating, Segmented, Typeahead (with its create row), BottomActionBar, Tag and Icon (Lucide paths). Follow `DESIGN.md` for new screens, and add a component here before using a new pattern.

Other bands you share a bill with are reusable `otherBand` records with `name`, `contactIds` and optional `notes`. Gigs link to them through `otherBandIds`; links and contacts must exist within the same managed band, matching venue/contact scoping. In the Who section, tap existing bands or create a new band inline. Use Other bands to edit a record and link contacts, or open a band from a gig's Playing with list. Updating the band's name or contact links applies wherever that record is reused. These bands do not appear in the managed-band picker.

## Inbox

Messages are ActivityStreams-shaped records (`channel`, `direction`, `conversation`, `bandId`, `actor`, `target`, `object.content`, `object.attachment`, `published`) stored in the account's remoteStorage at `/showday/conversations/<conversationId>/<yyyy-mm>/<messageId>`, with copied attachments under `.../<yyyy-mm>/files/`. `/showday/conversations/index` keeps one entry per conversation with the contact, the Page or Instagram account it runs through, the last inbound and outbound times and a preview; the server updates it with `If-Match` and re-reads on a 412. The web app only reads these records; `conversations()` and `messages(conversationId)` on the shared module do that. Conversation IDs are `<channel>-<bandId>-<peer id>`, with email addresses base64url-encoded, so a Page moved to another band starts separate threads.

To receive Messenger and Instagram messages, set `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_CONFIG_ID` (a Facebook Login for Business configuration) and `TOKEN_KEY` (`openssl rand -hex 32`; Page and storage tokens are stored AES-256-GCM encrypted with it; connections made before this key existed are dropped at startup and must be reconnected) in `.env` and point the Meta app's webhook at `/api/meta/webhook` with the same verify token; deliveries are checked against `X-Hub-Signature-256`. Set the app's deauthorize callback to `/api/meta/deauthorize` and its data-deletion callback to `/api/meta/data-deletion`: both verify Meta's `signed_request` and drop every Page connection of that Facebook user, and data deletion answers with a confirmation code and a status URL as App Review requires. Messages already saved in the band's own storage belong to the band and are not touched. All Graph API calls, including the browser's Facebook SDK, use the version in `graphVersion` (`api/src/meta.ts`, currently v26.0). In band settings, press Connect Facebook Page: the browser runs Facebook Login for Business, the API swaps the result for a long-lived Page token, keeps it in SQLite together with a dedicated storage token for the account, and subscribes the app to `messages` and `message_echoes`. Disconnect page unsubscribes and revokes the storage token, and only reports success once both are done; switching to another Page releases the old one first, and a Page can be connected to one band at a time. Webhook events, including echoes of replies sent from Facebook itself (echoes of this app's own replies are skipped), are stored as regular messages and attachments are copied into storage; if storage is unavailable the webhook answers 500 so Meta redelivers, and repeats are deduplicated by message ID. Connect, disconnect and reply require a token that can write to the band.

Messages arrive in the Inbox under **To sort**. A sender is linked to a contact automatically only when their handle or email matches exactly (“Matched by Instagram handle”); otherwise the app ranks contacts with similar names, or offers a new contact started from the sender's profile. The date, a known or new venue, a fee, the number of sets and start or door times are read from the message text (English and Czech dates and months, € / Kč / $ / £ amounts) and filled in for you to check; Add as gig saves straight away when the date, venue and contact are clear (the gig then shows beside the conversation), and opens the full form otherwise. Not a booking is a reviewed decision you keep; a newer message from the sender puts it back to sort. Conversations that became gigs stay under Booked, and reviewed ones under Set aside. Discard hides mail that does not belong; you can view discarded messages or restore them, and they are removed after 30 days. Open a conversation to read the thread and reply with one box for every channel. Meta replies are allowed within 24 hours of the contact's last message; with `META_HUMAN_AGENT=1` (the app must hold Meta's Human Agent permission) the window is 7 days, the reply is sent with the `HUMAN_AGENT` tag after the first 24 hours and the Inbox says so above the Send button. A channel whose Sockethub platform is not loaded fails with "<Channel> isn't set up on this server yet." in the reply box; `api/test/sender.test.ts` runs the real sender against a Sockethub stub to keep that path working. Live updates come over `GET /api/messages/events?ticket=…`, where the single-use ticket is issued by `POST /api/messages/ticket` with the storage token and expires after a minute, so no token travels in a URL; `POST /api/messages/reply` saves the outgoing message, then hands it to a channel sender built on a headless `@sockethub/client` (one Sockethub platform per channel, named after the channel). Meta channels only accept replies within 24 hours of the contact's last message; the box is disabled with the reason and the API enforces the same rule. A reply that cannot be delivered stays in the thread marked as not delivered. `GET /api/messages/events` is a server-sent events stream that tells open tabs to sync when a message arrives. From a conversation, create a gig prefilled from the message, or open the gig already linked to it (`conversationId` on the gig).

### Email

Each band can add a mail account in band settings: address, display name, incoming (IMAP) and outgoing (SMTP) servers with ports, login and password. The API stores everything as one AES-256-GCM blob with `TOKEN_KEY` (`PUT /api/email/account`; `GET` returns it without the password; `DELETE` removes it and revokes the storage token that was minted for it). Replies go out through Sockethub's email platform with the SMTP settings as credentials, addressed to the contact, with `Re:` the enquiry's subject and `In-Reply-To`/`References` headers so they thread in the contact's mail client; the index keeps the subject, Message-ID and references of the contact's latest email for that. Implicit TLS is used on ports 465 and 993, STARTTLS elsewhere; Sockethub refuses plain text and untrusted certificates. Leave the IMAP server empty for a send-only account.

With an IMAP server the API runs one mailbox watcher per band (`api/src/mailbox.ts`): a dedicated Sockethub session that sends `credentials`, `connect` and `watch` on `INBOX`, stores each posted mail as an incoming message (plain text, or text derived from HTML; attachments stay in the mailbox and are counted in the message), and saves the folder cursor after every batch so a restart resumes where it stopped. Mail from the band's own address is ignored. A dropped connection, a Sockethub restart or a storage failure ends the session and it reconnects with exponential backoff (2 s doubling to 5 min, reset after a session that lasted a minute); a cursor the server rejects is dropped and watching resumes from new mail. Sign-in and server problems are shown in band settings. Watchers start with the API process and restart when the settings change.

Sockethub failure reasons are translated for the reply box: `meta:messaging-window-closed` explains the 24-hour and 7-day human-agent rules, and `email:` reasons say what to check.

## Browser tests

Run the real forms against the Compose app (use a disposable stack: browser tests create accounts and records):

```sh
bunx playwright install chromium webkit
make up
bun run test:e2e
```

Set `E2E_BASE_URL` when the stack uses another port, for example `E2E_BASE_URL=http://localhost:18086 bun run test:e2e`. Tests run in desktop Chromium and mobile WebKit, create independent accounts, and use the real account API and remoteStorage service without mocked form submissions. Coverage includes signup validation, band and gig currencies, booking drafts and required fields, survey cancellation, earnings calculations and persistence, venue/earnings separation, gig-sheet print styles, and publishing the public page. `bun test` continues to run unit and storage tests separately.

CI runs the browser suite after starting its fresh Compose stack. Failures retain screenshots and Playwright traces in the `browser-test-results` artifact for seven days. See [Playwright's trace options](https://playwright.dev/docs/test-use-options#recording-options) for inspecting failures. This checks browser print styles, not a physical printer.

### Sockethub adapter and integration test

Meta replies require Sockethub's Messenger and Instagram platforms. The adapter
passes `token` and the shared Graph API version as credentials, and maps a
manual `HUMAN_AGENT` reply to `object.humanAgent`. Instagram uses Facebook Login:
its credentials include `login: "facebook"` and the linked Page ID, while the
message actor remains the Instagram account ID. `docker-compose.yml` builds
Sockethub from the commit that merged [Sockethub #1353](https://github.com/sockethub/sockethub/pull/1353)
together with the email platform; its default platform list includes all three.

`make up-test` starts the stack with `docker-compose.test.yml`: a Mailpit sink
(`http://localhost:8025`) with a self-signed STARTTLS certificate from
`scripts/mail-certs.sh`, trusted by the Sockethub container, and a Sockethub
configuration (`test/sockethub.config.json`) that allows private mail server
addresses. Then

```sh
MAIL_TEST_URL=http://localhost:8080 MAILPIT_URL=http://localhost:8025 bun test api/test/messages.integration.test.ts
```

creates an account, stores mail settings pointing at the sink, replies to a
seeded email enquiry through the real API and Sockethub container, and checks
the delivered subject, sender name and threading headers in Mailpit. Mailpit has
no IMAP, so the watcher is covered by `api/test/mailbox.test.ts` against a
Sockethub stub instead. CI runs both.
