<script lang="ts">
import { onMount } from "svelte";
import BandPicker from "./components/BandPicker.svelte";
import Icon from "./components/Icon.svelte";
import TabBar from "./components/TabBar.svelte";
import TopBar from "./components/TopBar.svelte";
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
  { id: "bookings", label: "Bookings", href: "#/bookings", count: toSort },
  { id: "venues", label: "Venues", href: "#/venues" },
  { id: "contacts", label: "Contacts", href: "#/contacts" },
  { id: "bands", label: "Other bands", href: "#/bands" },
  { id: "band", label: "Band", href: "#/band" },
  { id: "settings", label: "Settings", href: "#/settings" },
]);
const tabs = $derived([
  { id: "bookings", label: "Bookings", href: "#/bookings", count: toSort },
  { id: "contacts", label: "Contacts", href: "#/contacts" },
  { id: "venues", label: "Venues", href: "#/venues" },
  { id: "band", label: "Band", href: "#/band" },
  { id: "settings", label: "Settings", href: "#/settings" },
]);
// Other bands sits under Contacts on a phone.
const activeTab = $derived(
  router.screen === "bands" ? "contacts" : router.screen,
);
/** A phone shows a record on its own screen, with its own header and no tab bar. */
const phoneDetail = $derived(
  router.screen === "band"
    ? router.parts[0] === "member"
    : router.parts.length > 0,
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
        <a class="brand" href="#/bookings"
          ><span class="mark" aria-hidden="true"></span>Showday</a
        >
        <div class="phone-picker">
          <BandPicker bands={data.all} value={data.bandId} onchange={choose} />
        </div>
        {#if router.screen === "bookings"}
          <a class="btn btn-icon" href="#/bookings/new" aria-label="New enquiry"
            ><Icon name="plus" size={20} stroke={2.5} /></a
          >
        {/if}
      </header>
    {:else}
      <TopBar items={nav} active={router.screen}>
        {#snippet picker()}
          <BandPicker bands={data.all} value={data.bandId} onchange={choose} />
        {/snippet}
        {#snippet account()}
          <span class="user muted">{userAddress}</span>
          <a
            class="logout"
            href="/login"
            onclick={(event) => {
              event.preventDefault();
              logout();
            }}
            >Log out</a
          >
        {/snippet}
        {#snippet action()}
          {#if router.screen === "bookings"}
            <a class="btn btn-primary" href="#/bookings/new"
              ><Icon name="plus" stroke={2.5} />
              New enquiry</a
            >
          {:else if router.screen === "venues" && data.current}
            <a class="btn btn-secondary" href="#/venues/new"
              ><Icon name="plus" />
              New venue</a
            >
          {:else if router.screen === "contacts" && data.current}
            <a class="btn btn-secondary" href="#/contacts/new"
              ><Icon name="plus" />
              New contact</a
            >
          {:else if router.screen === "bands" && data.current}
            <a class="btn btn-secondary" href="#/bands/new"
              ><Icon name="plus" />
              New band</a
            >
          {/if}
        {/snippet}
      </TopBar>
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
        A public gig removal is waiting to sync. It may remain visible until you
        reconnect.
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
      {:else}
        <Bookings humanAgent={meta.config?.humanAgent ?? false} />
      {/if}
    </main>

    {#if ui.phone && !phoneDetail}
      <TabBar items={tabs} active={activeTab} />
    {/if}
  </div>
{/if}

<style>
.shell {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}
main {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
@media (max-width: 899px) {
  .shell {
    display: block;
    height: auto;
    min-height: 100dvh;
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
  gap: 12px;
  height: 56px;
  padding: 0 8px 0 16px;
  background: var(--color-bg);
  border-bottom: var(--rule-2);
}
.phone-detail .phone-top {
  display: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 800;
  font-size: 19px;
  color: inherit;
  text-decoration: none;
}
.mark {
  width: 12px;
  height: 12px;
  background: var(--color-accent);
}
.phone-picker {
  display: flex;
  justify-content: flex-end;
  margin-left: auto;
  min-width: 0;
  height: 44px;
}
.user {
  font-size: 13px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.logout {
  font-size: 13px;
  color: var(--color-text);
}
.notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.reconnect {
  padding: 12px 28px;
  border-bottom: var(--rule-2);
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
  .shell > :global(:not(main)),
  main > :global(:not(.gig-sheet)) {
    display: none;
  }
  main {
    overflow: visible;
  }
}
</style>
