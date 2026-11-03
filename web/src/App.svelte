<script lang="ts">
import {
  type Band,
  type Contact,
  currencyForLocale,
  formatFee,
  type Gig,
  groupGigs,
  type Member,
  slugify,
  slugPattern,
  type Venue,
} from "@gigger/schemas";
import { onMount } from "svelte";
import Bookings from "./Bookings.svelte";
import {
  bands,
  connectSession,
  ensureSessionReady,
  logout,
  onSessionLogout,
  storage,
} from "./storage";

type Summary = {
  band: Band;
  members: Member[];
  gigs: Gig[];
  venues: Venue[];
  contacts: Contact[];
};
let summaries = $state<Summary[]>([]);
let selected = $state("");
let openedGig = $state("");
let bandName = $state("");
let bandCurrency = $state(currencyForLocale(navigator.language));
let memberName = $state("");
let editingMember = $state("");
let creatingBand = $state(false);
let phone = $state("");
let memberEmail = $state("");
let messenger = $state("");
let mode = $state(location.pathname === "/signup" ? "signup" : "login");
let email = $state("");
let username = $state("");
let password = $state("");
let signedIn = $state(false);
let status = $state("Loading…");
let error = $state("");
let ready = $state(false);
let busy = $state(false);
let current = $derived(summaries.find((item) => item.band.id === selected));
// An unsaved currency edit survives reloads from saves and syncs; once saved
// or when another band is shown, the field follows the stored currency again.
let currencyDraft = $state<{ bandId: string; text: string } | null>(null);
let currencyText = $derived(
  currencyDraft && currencyDraft.bandId === current?.band.id
    ? currencyDraft.text
    : (current?.band.currency ?? "EUR"),
);
let slugDraft = $state<{ bandId: string; text: string } | null>(null);
let slugText = $derived(
  slugDraft && slugDraft.bandId === current?.band.id
    ? slugDraft.text
    : (current?.band.slug ?? slugify(current?.band.name ?? "")),
);
let pageUrl = $derived(
  current?.band.slug ? `${location.origin}/b/${current.band.slug}` : "",
);

async function publishPage(event: SubmitEvent) {
  event.preventDefault();
  const band = current?.band;
  if (!band) return;
  const slug = slugText.trim();
  busy = true;
  error = "";
  try {
    const { userAddress, token } = storage.remote;
    if (!userAddress.endsWith(`@${location.host}`))
      throw new Error("Public pages are available for accounts on this site.");
    const username = decodeURIComponent(
      userAddress.slice(0, userAddress.lastIndexOf("@")),
    );
    const response = await fetch("/api/public/pages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ username, bandId: band.id, slug }),
    });
    if (!response.ok)
      throw new Error(
        (await response.json()).error ??
          "Could not publish the page. Please retry.",
      );
    await bands.save("band", band.id, {
      ...band,
      slug,
      locale: navigator.language,
    });
    await bands.publishBand(band.id, band.slug);
    slugDraft = null;
    await load();
  } catch (cause) {
    error =
      cause instanceof Error
        ? cause.message
        : "Could not publish the page. Please retry.";
  } finally {
    busy = false;
  }
}

async function load() {
  const token = storage.remote.token;
  const loaded = await Promise.all(
    (await bands.bands()).map(async (band) => ({
      band,
      members: await bands.list("member", band.id),
      gigs: await bands.list("gig", band.id),
      venues: await bands.list("venue", band.id),
      contacts: await bands.list("contact", band.id),
    })),
  );
  if (signedIn && token === storage.remote.token) summaries = loaded;
}
async function save(action: () => Promise<void>) {
  busy = true;
  error = "";
  try {
    await action();
    await load();
  } catch {
    error = "Could not save changes. Please retry.";
  } finally {
    busy = false;
  }
}
function createBand(event: SubmitEvent) {
  event.preventDefault();
  if (!bandName.trim()) {
    error = "Enter a band name.";
    return;
  }
  void save(async () => {
    const band = {
      id: crypto.randomUUID(),
      name: bandName.trim(),
      currency: bandCurrency.toUpperCase(),
    };
    await bands.save("band", band.id, band);
    selected = band.id;
    bandName = "";
    creatingBand = false;
  });
}
function saveMember(event: SubmitEvent) {
  event.preventDefault();
  if (!selected || !memberName.trim()) {
    error = "Enter a member name.";
    return;
  }
  void save(async () => {
    await bands.save("member", selected, {
      id: editingMember || crypto.randomUUID(),
      name: memberName.trim(),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(memberEmail.trim() ? { email: memberEmail.trim() } : {}),
      ...(messenger.trim() ? { messenger: messenger.trim() } : {}),
    });
    resetMember();
  });
}
function resetMember() {
  editingMember = "";
  memberName = "";
  phone = "";
  memberEmail = "";
  messenger = "";
}
function editMember(member: Member) {
  editingMember = member.id;
  memberName = member.name;
  phone = member.phone ?? "";
  memberEmail = member.email ?? "";
  messenger = member.messenger ?? "";
}
function removeMember(member: Member) {
  if (!confirm(`Remove ${member.name} from this band?`)) return;
  void save(async () => {
    await bands.removeMember(selected, member.id);
    if (editingMember === member.id) resetMember();
  });
}
async function authenticate(event: SubmitEvent) {
  event.preventDefault();
  busy = true;
  error = "";
  try {
    ensureSessionReady();
    if (mode === "login" && username.trim().includes("@")) {
      password = "";
      storage.connect(username.trim());
      return;
    }
    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        email,
        password,
        ...(mode === "signup"
          ? { bandName, currency: bandCurrency.toUpperCase() }
          : {}),
      }),
    });
    const session = await response.json();
    if (!response.ok)
      throw new Error(session.error ?? "Could not log in. Please retry.");
    password = "";
    await connectSession(session.username, session.token);
    bandName = "";
    history.replaceState(null, "", "/");
    await load();
  } catch (cause) {
    error =
      cause instanceof Error
        ? cause.message
        : "Could not log in. Please retry.";
  } finally {
    busy = false;
  }
}
function resetSession() {
  signedIn = false;
  ready = false;
  busy = false;
  error = "";
  status = "";
  summaries = [];
  selected = "";
  mode = "login";
  creatingBand = false;
  bandName = "";
  password = "";
  openedGig = "";
  resetMember();
}
function logOut(event: MouseEvent) {
  event.preventDefault();
  logout();
}
onMount(() => {
  const unsubscribeLogout = onSessionLogout(resetSession);
  const refresh = () => {
    if (signedIn)
      void load().catch(() => {
        error = "Could not load your bands. Please retry.";
      });
  };
  storage.on("ready", () => {
    ready = true;
    status = "";
  });
  storage.on("connected", () => {
    signedIn = true;
    status = "";
    history.replaceState(null, "", "/");
    refresh();
  });
  storage.on("error", () => {
    error =
      "Could not save or load changes. Please check your connection and try again.";
  });
  storage.on("disconnected", resetSession);
  let changed = false;
  storage.scope("/gigger/").on("change", () => {
    changed = true;
  });
  storage.on("sync-done", () => {
    if (changed) {
      changed = false;
      refresh();
    }
  });
  return () => {
    unsubscribeLogout();
    storage.removeEventListener("disconnected", resetSession);
    storage.stopSync();
  };
});
</script>

<svelte:head
  ><meta
    name="description"
    content="Your bands, members and gigs in one place."
  ></svelte:head
>
<main>
  <header>
    <p class="eyebrow">Keep the band together</p>
    <h1>Gigger</h1>
    <p>Book it, plan it, play it, post it.</p>
    {#if signedIn}
      <a class="logout" href="/login" onclick={logOut}>Log out</a>
    {/if}
  </header>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  {#if status}
    <p role="status">{status}</p>
  {/if}
  {#if !signedIn}
    <section aria-labelledby="auth-title">
      <h2 id="auth-title">
        {mode === "signup" ? "Create your account" : "Log in"}
      </h2>
      <form onsubmit={authenticate}>
        <label
          >Username<input
            autocomplete="username"
            bind:value={username}
            required
            maxlength="254"
            pattern={mode === "signup"
              ? "[a-zA-Z0-9][a-zA-Z0-9._\\-]{1,63}"
              : undefined}
          ></label
        >
        {#if mode === "signup"}
          <label
            >Email<input
              type="email"
              autocomplete="email"
              bind:value={email}
              required
              maxlength="254"
            ></label
          >
        {/if}
        {#if mode === "signup" || !username.includes("@")}
          <label
            >Password<input
              type="password"
              autocomplete={mode === "signup"
                ? "new-password"
                : "current-password"}
              bind:value={password}
              required
              minlength={mode === "signup" ? 8 : 1}
              maxlength="1024"
            ></label
          >
        {/if}
        {#if mode === "signup"}
          <label
            >Band name<input
              bind:value={bandName}
              required
              maxlength="200"
            ></label
          >
        {/if}
        <button type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "signup" ? "Sign up" : "Log in"}
        </button>
      </form>
      <p>
        {#if mode === "signup"}
          Already have an account? <a href="/login">Log in</a>
        {:else}
          New to Gigger? <a href="/signup">Create an account</a>
        {/if}
      </p>
    </section>
  {:else}
    <nav aria-label="Bands">
      <label
        >View band<select
          bind:value={selected}
          onchange={() => {
            resetMember();
            openedGig = "";
          }}
        >
          <option value="">All bands</option>
          {#each summaries as { band } (band.id)}
            <option value={band.id}>{band.name}</option>
          {/each}
        </select></label
      >
      <button
        type="button"
        aria-expanded={creatingBand}
        aria-controls="new-band"
        onclick={() => {
          creatingBand = !creatingBand;
        }}
      >
        + New band
      </button>
    </nav>
    {#if creatingBand}
      <section id="new-band" aria-labelledby="create-title">
        <h2 id="create-title">Create a band</h2>
        <form onsubmit={createBand}>
          <label>Band name<input bind:value={bandName} required></label>
          <label
            >Currency<input
              bind:value={bandCurrency}
              required
              pattern={"[A-Za-z]{3}"}
              maxlength="3"
            ></label
          ><button type="submit" disabled={!ready || busy}>Create band</button>
        </form>
      </section>
    {/if}
    {#if current}
      <section>
        <h2>{current.band.name}</h2>
        <form
          onsubmit={(event) => {
            event.preventDefault();
            const band = current.band;
            void save(async () => {
              await bands.save("band", band.id, {
                ...band,
                currency: currencyText.toUpperCase(),
              });
              currencyDraft = null;
            });
          }}
        >
          <label
            >Band currency<input
              name="currency"
              value={currencyText}
              oninput={(event) => {
                currencyDraft = {
                  bandId: current.band.id,
                  text: event.currentTarget.value,
                };
              }}
              pattern={"[A-Za-z]{3}"}
              maxlength="3"
              required
            ></label
          >
          <button type="submit" disabled={busy}>Save currency</button>
        </form>
        <h3>Public page</h3>
        {#if pageUrl}
          <p>
            Fans can see your confirmed and played gigs at
            <a href={pageUrl}>{pageUrl}</a>
          </p>
          <p>
            <a
              class="button"
              href={`/b/${current.band.slug}/export.zip`}
              download
              >Export static page</a
            >
            Downloads a zip with the page, its JSON and a calendar file to host
            anywhere.
          </p>
        {:else}
          <p>
            Publish a page of your confirmed gigs: date, start time, venue,
            city, ticket link and public description. Fees, contacts, notes and
            earnings stay private.
          </p>
        {/if}
        <form onsubmit={publishPage}>
          <label
            >Page address
            <span class="prefix"
              ><span aria-hidden="true">{location.origin}/b/</span>
              <input
                name="slug"
                value={slugText}
                oninput={(event) => {
                  slugDraft = {
                    bandId: current.band.id,
                    text: event.currentTarget.value,
                  };
                }}
                pattern={slugPattern.slice(1, -1)}
                maxlength="60"
                required
              ></span
            ></label
          >
          <button type="submit" disabled={!ready || busy}>
            {current.band.slug ? "Save address" : "Publish page"}
          </button>
        </form>
        <h3>Members</h3>
        <ul>
          {#each current.members as member (member.id)}
            <li>
              <strong>{member.name}</strong>
              {#if member.phone || member.email || member.messenger}
                —
                {[member.phone, member.email, member.messenger]
                  .filter(Boolean)
                  .join(" · ")}
              {/if}
              <button
                type="button"
                class="text-button"
                disabled={busy}
                onclick={() => editMember(member)}
              >
                Edit<span class="sr-only"> {member.name}</span>
              </button>
              <button
                type="button"
                class="text-button"
                disabled={busy}
                onclick={() => removeMember(member)}
              >
                Remove<span class="sr-only"> {member.name}</span>
              </button>
            </li>
          {:else}
            <li>No members yet.</li>
          {/each}
        </ul>
        <h3>{editingMember ? "Edit member" : "Add a member"}</h3>
        <p>Only a name is required. Contact details are optional.</p>
        <form onsubmit={saveMember}>
          <label>Name<input bind:value={memberName} required></label
          ><label
            >Email address<input type="email" bind:value={memberEmail}></label
          ><label>Phone number<input type="tel" bind:value={phone}></label
          ><label>Messenger handle<input bind:value={messenger}></label
          ><button type="submit" disabled={!ready || busy}>
            {editingMember ? "Save member" : "Add member"}
          </button>
          {#if editingMember}
            <button type="button" onclick={resetMember}>Cancel</button>
          {/if}
        </form>
      </section>
    {/if}
    {#key selected}
      <Bookings
        {summaries}
        bandId={selected}
        initialGigId={openedGig}
        onopen={(bandId, gigId) => {
          openedGig = gigId;
          selected = bandId;
        }}
        onchanged={load}
      />
    {/key}
    <section aria-labelledby="overview-title">
      <h2 id="overview-title">
        {current ? current.band.name : "All bands"}
        overview
      </h2>
      {#each summaries.filter(
        (item) => !selected || item.band.id === selected,
      ) as summary (summary.band.id)}
        <article>
          <h3>
            <button
              type="button"
              class="band"
              onclick={() => {
                selected = summary.band.id;
                openedGig = "";
                resetMember();
              }}
            >
              {summary.band.name}
            </button>
          </h3>
          {#each groupGigs(summary.gigs) as group (group.status)}
            <h4 class="status">{group.status}</h4>
            <ul>
              {#each group.gigs as gig (gig.id)}
                <li>
                  <strong>{gig.title}</strong>
                  · <time datetime={gig.date}>{gig.date}</time> ·
                  {summary.venues.find((venue) => venue.id === gig.venueId)
                    ?.name ?? gig.venue}
                  <details>
                    <summary>Gig details</summary>
                    <p>
                      {summary.venues.find((venue) => venue.id === gig.venueId)
                        ?.address ?? gig.address}
                    </p>
                    {#if gig.contactIds?.length || gig.contacts?.length}
                      <p>
                        Contacts:
                        {gig.contactIds
                          ?.map(
                            (id) =>
                              summary.contacts.find(
                                (contact) => contact.id === id,
                              )?.name ?? id,
                          )
                          .join(" · ") ?? gig.contacts?.join(" · ")}
                      </p>
                    {/if}
                    {#if gig.loadIn}
                      <p>Load-in: {gig.loadIn}</p>
                    {/if}
                    {#if gig.soundcheck}
                      <p>Soundcheck: {gig.soundcheck}</p>
                    {/if}
                    {#if gig.setTimes?.length}
                      <p>Set times: {gig.setTimes.join(", ")}</p>
                    {/if}
                    {#if formatFee(gig.fee, summary.band.currency ?? "EUR")}
                      <p>
                        Fee:
                        {formatFee(
                          gig.fee,
                          summary.band.currency ?? "EUR",
                          navigator.language,
                        )}
                      </p>
                    {/if}
                    {#if gig.notes}
                      <p>{gig.notes}</p>
                    {/if}
                  </details>
                </li>
              {/each}
            </ul>
          {:else}
            <p>No gigs yet.</p>
          {/each}
        </article>
      {:else}
        <p>Create your first band to get started.</p>
      {/each}
    </section>
  {/if}
</main>
<style>
.logout {
  position: absolute;
  top: 2rem;
  right: 0;
  font-size: 0.875rem;
}
.text-button {
  background: transparent;
  color: #205b43;
  border: 0;
  padding: 0.3rem 0.5rem;
  text-decoration: underline;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
nav {
  display: flex;
  gap: 1rem;
  align-items: end;
  flex-wrap: wrap;
}

.status {
  text-transform: capitalize;
}
:global(body) {
  margin: 0;
  background: #f5f4ef;
  color: #202d29;
  font:
    16px / 1.5 system-ui,
    sans-serif;
}
main {
  max-width: 960px;
  margin: auto;
  padding: 2rem 1rem 4rem;
}
header {
  position: relative;
  padding: 2rem 0;
}
h1 {
  font-size: clamp(3rem, 10vw, 5rem);
  line-height: 1;
  margin: 0.3rem 0;
}
.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.15em;
  font-size: 0.8rem;
}
section,
nav {
  background: white;
  padding: 1.5rem;
  margin: 1rem 0;
  border: 1px solid #d4ddd7;
  border-radius: 12px;
}
h2 {
  margin-top: 0;
}
form {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: end;
}
label {
  display: grid;
  gap: 0.4rem;
  flex: 1;
  min-width: 160px;
}
input,
select,
button,
.button {
  font: inherit;
  border: 1px solid #82958a;
  border-radius: 6px;
  padding: 0.65rem;
}
button,
.button {
  background: #205b43;
  color: white;
  cursor: pointer;
}
.button {
  display: inline-block;
  text-decoration: none;
  margin-right: 0.5rem;
}
.prefix {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  color: #4e5f58;
  overflow-wrap: anywhere;
}
.prefix input {
  flex: 1;
  min-width: 8rem;
  max-width: 100%;
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
a {
  color: #205b43;
}
article {
  border-top: 1px solid #d4ddd7;
}
.band {
  background: transparent;
  color: #205b43;
  padding: 0.2rem;
  text-decoration: underline;
}
.error {
  color: #902a20;
  padding: 1rem;
  border: 1px solid;
}
:global(:focus-visible) {
  outline: 3px solid #c18716;
  outline-offset: 3px;
}
@media print {
  :global(body:has(.gig-sheet)) {
    background: white;
  }
  main:has(:global(.gig-sheet)) > :not(:has(:global(.gig-sheet))) {
    display: none;
  }
  main {
    padding: 0;
  }
}
</style>
