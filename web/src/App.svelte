<script lang="ts">
import { onMount } from "svelte";
import BandPicker from "./components/BandPicker.svelte";
import Icon from "./components/Icon.svelte";
import Sidebar from "./components/Sidebar.svelte";
import TabBar from "./components/TabBar.svelte";
import { meta } from "./lib/account.svelte";
import { data } from "./lib/data.svelte";
import { inboxItems } from "./lib/inbox";
import { connectMessageStream } from "./lib/message-stream.svelte";
import { threads } from "./lib/messages.svelte";
import { router } from "./lib/router.svelte";
import {
  run,
  staleMessage,
  syncTroubleMessage,
  ui,
  watchSession,
} from "./lib/ui.svelte";
import Auth from "./screens/Auth.svelte";
import Band from "./screens/Band.svelte";
import Bookings from "./screens/Bookings.svelte";
import Contacts from "./screens/Contacts.svelte";
import Inbox from "./screens/Inbox.svelte";
import OtherBands from "./screens/OtherBands.svelte";
import Settings from "./screens/Settings.svelte";
import Venues from "./screens/Venues.svelte";
import {
  bands,
  logout,
  onTokenRejected,
  reconnectSession,
  storage,
} from "./storage";

let signedIn = $state(false);
let loading = $state(true);
let userAddress = $state("");
let tokenRejected = $state(false);
let reconnectPassword = $state("");
let reconnectBusy = $state(false);
let reconnectError = $state("");

const toSort = $derived(
  inboxItems(
    data.conversations,
    data.inView.map((b) => b.band.id),
    data.inView.flatMap((b) => b.gigs),
    data.inView.flatMap((b) => b.triage),
  ).filter((i) => i.state === "toSort").length,
);
const nav = $derived([
  {
    id: "bookings",
    label: "Gigs",
    href: "#/bookings",
    icon: "calendar" as const,
  },
  {
    id: "inbox",
    label: "Inbox",
    href: "#/inbox",
    icon: "inbox" as const,
    count: toSort,
    countLabel: "to sort",
  },
  {
    id: "contacts",
    label: "Contacts",
    href: "#/contacts",
    icon: "users" as const,
  },
  { id: "venues", label: "Venues", href: "#/venues", icon: "map-pin" as const },
  { id: "bands", label: "Other bands", href: "#/bands", icon: "disc" as const },
  { id: "band", label: "Your band", href: "#/band", icon: "music" as const },
]);
const footerNav = [
  {
    id: "settings",
    label: "Settings",
    href: "#/settings",
    icon: "settings" as const,
  },
];
const tabs = $derived([
  {
    id: "bookings",
    label: "Gigs",
    href: "#/bookings",
    icon: "calendar" as const,
  },
  {
    id: "inbox",
    label: "Inbox",
    href: "#/inbox",
    icon: "inbox" as const,
    count: toSort,
  },
  {
    id: "contacts",
    label: "Contacts",
    href: "#/contacts",
    icon: "users" as const,
  },
  { id: "venues", label: "Venues", href: "#/venues", icon: "map-pin" as const },
  { id: "band", label: "Band", href: "#/band", icon: "music" as const },
]);
const titles: Record<string, string> = {
  inbox: "Inbox",
  bookings: "Gigs",
  contacts: "Contacts",
  venues: "Venues",
  bands: "Other bands",
  band: "Your band",
  settings: "Settings",
};
// Other bands sits under Contacts on a phone.
const activeTab = $derived(
  router.screen === "bands"
    ? "contacts"
    : router.screen === "settings"
      ? "band"
      : router.screen,
);
/** A phone shows a record on its own screen, with its own header and no tab bar. */
const phoneDetail = $derived(
  router.screen === "band"
    ? router.parts[0] === "member"
    : router.parts.length > 0,
);
const newHref = $derived(
  router.screen === "bookings" || router.screen === "inbox"
    ? "#/bookings/new"
    : router.screen === "venues"
      ? "#/venues/new"
      : router.screen === "contacts"
        ? "#/contacts/new"
        : router.screen === "bands"
          ? "#/bands/new"
          : "",
);
const newLabel = $derived(
  router.screen === "venues"
    ? "New venue"
    : router.screen === "contacts"
      ? "New contact"
      : router.screen === "bands"
        ? "New band"
        : "New gig",
);
const needsBand = $derived(
  ["venues", "contacts", "bands"].includes(router.screen),
);

async function load() {
  try {
    await data.load();
    await threads.refresh();
  } catch {
    ui.error = "Could not load your bands. Please retry.";
  }
}
function resetSession() {
  signedIn = false;
  ui.busy = false;
  ui.error = "";
  loading = false;
  userAddress = "";
  data.reset();
  threads.reset();
  // Ending a session clears the URL with replaceState, which fires no
  // hashchange, so without this the router would keep showing whatever record
  // was open when the session ended.
  router.read();
}
onMount(() => {
  const unwatchToken = onTokenRejected((rejected) => {
    tokenRejected = rejected;
    if (!rejected) {
      reconnectPassword = "";
      reconnectError = "";
    }
  });
  const unwatchSession = watchSession(resetSession);
  storage.on("ready", () => {
    loading = false;
  });
  storage.on("connected", () => {
    signedIn = true;
    loading = false;
    ui.error = "";
    ui.notice = "";
    userAddress = storage.remote.userAddress;
    if (location.pathname !== "/")
      history.replaceState(null, "", `/${location.hash}`);
    void load();
    void meta.load();
  });
  storage.on("disconnected", resetSession);
  let changed = false;
  storage.scope("/showday/").on("change", () => {
    changed = true;
  });
  storage.on("sync-done", (event) => {
    if ((event as { completed?: boolean }).completed && signedIn)
      void bands
        .retryPublicDeletes()
        .then(() => data.load())
        .catch(() => {});
    // One refresh per sync, not one per synced document; drafts live in the forms.
    if (changed && signedIn && !ui.busy) {
      changed = false;
      void load();
    }
  });
  return () => {
    unwatchToken();
    unwatchSession();
    storage.removeEventListener("disconnected", resetSession);
    storage.stopSync();
  };
});

async function submitReconnect(event: SubmitEvent) {
  event.preventDefault();
  if (!userAddress.endsWith(`@${location.host}`)) return;
  const username = decodeURIComponent(
    userAddress.slice(0, userAddress.lastIndexOf("@")),
  );
  reconnectBusy = true;
  reconnectError = "";
  try {
    await reconnectSession({ username, password: reconnectPassword });
    reconnectPassword = "";
    await load();
  } catch (cause) {
    reconnectError =
      cause instanceof Error
        ? cause.message
        : "Could not log in. Please retry.";
  } finally {
    reconnectBusy = false;
  }
}

// One stream per account; it only says "sync now". Reopened whenever the band it is checked against changes.
$effect(() => {
  const streamBand = data.bandId || data.all[0]?.band.id;
  if (!signedIn || !streamBand) return;
  const { userAddress, token } = storage.remote;
  if (!userAddress.endsWith(`@${location.host}`) || !token) return;
  const username = decodeURIComponent(
    userAddress.slice(0, userAddress.lastIndexOf("@")),
  );
  let alive = true;
  const stop = connectMessageStream({
    username,
    bandId: streamBand,
    token,
    aborted: () => !alive,
  });
  return () => {
    alive = false;
    stop();
  };
});
function choose(bandId: string) {
  data.choose(bandId);
  // A record from the previous band no longer belongs in the pane.
  if (needsBand && router.parts.length)
    router.go(router.screen, { replace: true });
}
</script>

<svelte:head>
  <meta name="description" content="Your bands, members and gigs in one place.">
</svelte:head>

{#if !signedIn}
  <Auth status={ui.notice || (loading ? "Loading…" : "")} onsignedin={load} />
{:else}
  <div class="shell" class:phone-detail={phoneDetail}>
    {#if ui.phone}
      <header class="phone-top no-print">
        <div class="phone-picker">
          <BandPicker bands={data.all} value={data.bandId} onchange={choose} />
        </div>
        <a
          class="btn btn-icon btn-ghost"
          href="#/settings"
          aria-label="Settings"
          ><Icon name="settings" size={20} /></a
        >
        {#if newHref &&
          ((router.screen !== "contacts" &&
            router.screen !== "venues" &&
            router.screen !== "bands") ||
            data.current)}
          <a class="btn btn-icon new-btn" href={newHref} aria-label={newLabel}
            ><Icon name="plus" size={20} stroke={2.5} /></a
          >
        {/if}
      </header>
    {:else}
      <Sidebar items={nav} footerItems={footerNav} active={router.screen}>
        {#snippet picker()}
          <BandPicker bands={data.all} value={data.bandId} onchange={choose} />
        {/snippet}
        {#snippet account()}
          <span class="avatar" aria-hidden="true"
            >{userAddress.slice(0, 1).toUpperCase()}</span
          >
          <span class="user ellipsis" title={userAddress}>{userAddress}</span>
          <a
            class="logout btn btn-icon btn-ghost"
            href="/login"
            aria-label="Log out"
            title="Log out"
            onclick={(event) => {
              event.preventDefault();
              logout();
            }}
            ><Icon name="log-out" size={17} /></a
          >
        {/snippet}
      </Sidebar>
    {/if}

    <div class="content">
      {#if !ui.phone}
        <header class="page-bar no-print">
          <h1>{titles[router.screen]}</h1>
          {#if newHref &&
            (router.screen === "bookings" ||
              router.screen === "inbox" ||
              data.current)}
            <a class="btn btn-primary" href={newHref}
              ><Icon name="plus" stroke={2.5} />{newLabel}</a
            >
          {/if}
        </header>
      {/if}
      {#if ui.error}
        <p class="notice error no-print" role="alert">
          {ui.error}
          {#if ui.error === staleMessage}
            <button
              type="button"
              class="btn btn-secondary"
              disabled={ui.busy}
              onclick={() => run(async () => {})}
            >
              Reload latest
            </button>
          {/if}
          <button
            type="button"
            class="btn btn-ghost dismiss"
            onclick={() => (ui.error = "")}
          >
            Dismiss
          </button>
        </p>
      {/if}
      {#if tokenRejected}
        <form class="notice reconnect no-print" onsubmit={submitReconnect}>
          <p role="status">
            Your session ended. Log in again to sync — unsynced changes on this
            device are kept until then.
          </p>
          <label class="sr-only" for="reconnect-password">Password</label>
          <input
            id="reconnect-password"
            class="input"
            type="password"
            autocomplete="current-password"
            bind:value={reconnectPassword}
            required
            disabled={reconnectBusy}
          >
          <button
            type="submit"
            class="btn btn-secondary"
            disabled={reconnectBusy || !reconnectPassword}
          >
            Log in again
          </button>
          {#if reconnectError}
            <p class="error" role="alert">{reconnectError}</p>
          {/if}
        </form>
      {/if}
      {#if ui.syncTrouble}
        <p class="notice no-print" role="status">{syncTroubleMessage}</p>
      {/if}
      {#if data.pendingPublicDeletes}
        <p class="notice no-print" role="status">
          A public gig removal is waiting to sync. It may remain visible until
          you reconnect.
        </p>
      {/if}

      <main>
        {#if !data.loaded}
          <p class="empty">Loading your bands…</p>
        {:else if router.screen === "band"}
          <Band />
        {:else if router.screen === "settings"}
          <Settings />
        {:else if needsBand && !data.current}
          <div class="page-head">
            <div>
              <h1>
                {router.screen === "venues"
                  ? "Venues"
                  : router.screen === "contacts"
                    ? "Contacts"
                    : "Other bands"}
              </h1>
              <p>Each band keeps its own. Choose one to see them.</p>
            </div>
          </div>
          <ul class="choose">
            {#each data.all as item (item.band.id)}
              <li>
                <button
                  type="button"
                  class="btn btn-secondary btn-wide"
                  onclick={() => data.choose(item.band.id)}
                >
                  {item.band.name} <Icon name="arrow-right" />
                </button>
              </li>
            {:else}
              <li class="empty">
                Create a band on the <a href="#/band">Band page</a> first.
              </li>
            {/each}
          </ul>
        {:else if router.screen === "venues" && data.current}
          <Venues data={data.current} />
        {:else if router.screen === "contacts" && data.current}
          <Contacts data={data.current} />
        {:else if router.screen === "bands" && data.current}
          <OtherBands data={data.current} />
        {:else if router.screen === "inbox"}
          <Inbox humanAgent={meta.config?.humanAgent ?? false} />
        {:else}
          <Bookings />
        {/if}
      </main>
    </div>

    {#if ui.phone && !phoneDetail}
      <TabBar items={tabs} active={activeTab} />
    {/if}
  </div>
{/if}

<style>
.shell {
  display: grid;
  grid-template-columns: var(--sidebar) minmax(0, 1fr);
  height: 100dvh;
}
.content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--color-surface);
}
main {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.page-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--topbar);
  flex: none;
  padding: 0 var(--pad);
  border-bottom: var(--rule);
}
.page-bar h1 {
  margin: 0;
  font-size: 17px;
  letter-spacing: -0.01em;
}
.page-bar .btn {
  margin-left: auto;
}
@media (max-width: 899px) {
  .shell {
    display: block;
    height: auto;
    min-height: 100dvh;
  }
  .content {
    background: var(--color-bg);
  }
  main {
    overflow: visible;
  }
}
.phone-top {
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 60px;
  padding: 0 12px;
  background: var(--color-bg);
  border-bottom: var(--rule);
}
.phone-detail .phone-top {
  display: none;
}
.phone-picker {
  display: flex;
  flex: 1;
  min-width: 0;
  margin-right: 4px;
}
.phone-picker :global(.picker) {
  border-color: transparent;
  box-shadow: none;
  background: transparent;
  padding-left: 0;
  width: auto;
  max-width: 100%;
}
.phone-picker :global(.shown) {
  font-size: 16px;
}
.new-btn {
  border-radius: 12px;
  background: var(--color-accent-100);
  color: var(--color-accent-700);
}
.new-btn:hover {
  background: var(--color-accent-200);
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--color-sunken);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}
.user {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--muted);
}
.logout {
  width: 32px;
  height: 32px;
  min-height: 32px;
}
.notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.reconnect {
  padding: 12px var(--pad);
  border-bottom: var(--rule);
  align-items: flex-end;
}
.reconnect .input {
  min-width: 12rem;
}
.dismiss {
  margin-left: auto;
}
.choose {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 480px;
  padding: 24px;
}
@media print {
  /* Only the gig sheet prints. */
  .shell {
    display: block;
    height: auto;
  }
  .shell > :global(:not(.content)),
  .content > :global(:not(main)),
  main > :global(:not(.gig-sheet)) {
    display: none;
  }
  main {
    overflow: visible;
  }
}
</style>
