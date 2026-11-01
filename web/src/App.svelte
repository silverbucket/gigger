<script lang="ts">
import { type Band, type Gig, groupGigs, type Member } from "@gigger/schemas";
import { onMount } from "svelte";
import { bands, connectSession, logout, storage } from "./storage";

type Summary = { band: Band; members: Member[]; gigs: Gig[] };
let summaries = $state<Summary[]>([]);
let selected = $state("");
let bandName = $state("");
let memberName = $state("");
let phone = $state("");
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

async function load() {
  summaries = await Promise.all(
    (await bands.bands()).map(async (band) => ({
      band,
      members: await bands.list("member", band.id),
      gigs: await bands.list("gig", band.id),
    })),
  );
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
    const band = { id: crypto.randomUUID(), name: bandName.trim() };
    await bands.save("band", band.id, band);
    selected = band.id;
    bandName = "";
  });
}
function addMember(event: SubmitEvent) {
  event.preventDefault();
  if (!selected || !memberName.trim() || (!phone.trim() && !messenger.trim())) {
    error = "Enter a name and a phone number or Messenger handle.";
    return;
  }
  void save(async () => {
    await bands.save("member", selected, {
      id: crypto.randomUUID(),
      name: memberName.trim(),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(messenger.trim() ? { messenger: messenger.trim() } : {}),
    });
    memberName = "";
    phone = "";
    messenger = "";
  });
}
async function authenticate(event: SubmitEvent) {
  event.preventDefault();
  busy = true;
  error = "";
  try {
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
        ...(mode === "signup" ? { bandName } : {}),
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
async function logOut() {
  busy = true;
  error = "";
  try {
    await logout();
  } catch (cause) {
    error =
      cause instanceof Error
        ? cause.message
        : "Could not log out. Please retry.";
  } finally {
    busy = false;
  }
}
onMount(() => {
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
  storage.on("disconnected", () => {
    signedIn = false;
    summaries = [];
    selected = "";
  });
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
    <p>One place for every band you play with.</p>
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
              ? "[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}"
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
        <button type="submit" disabled={!ready || busy}>
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
    <button type="button" onclick={logOut} disabled={busy}>Log out</button>
    <nav aria-label="Bands">
      <label
        >View band<select bind:value={selected}>
          <option value="">All bands</option>
          {#each summaries as { band } (band.id)}
            <option value={band.id}>{band.name}</option>
          {/each}
        </select></label
      >
    </nav>
    <section aria-labelledby="create-title">
      <h2 id="create-title">Create a band</h2>
      <form onsubmit={createBand}>
        <label>Band name<input bind:value={bandName} required></label
        ><button type="submit" disabled={!ready || busy}>Create band</button>
      </form>
    </section>
    {#if current}
      <section>
        <h2>{current.band.name}</h2>
        <h3>Members</h3>
        <ul>
          {#each current.members as member (member.id)}
            <li>
              <strong>{member.name}</strong>
              — {[member.phone, member.messenger].filter(Boolean).join(" · ")}
            </li>
          {:else}
            <li>No members yet.</li>
          {/each}
        </ul>
        <h3>Add a member</h3>
        <p>A name and at least one way to reach them.</p>
        <form onsubmit={addMember}>
          <label>Name<input bind:value={memberName} required></label
          ><label>Phone number<input type="tel" bind:value={phone}></label
          ><label>Messenger handle<input bind:value={messenger}></label
          ><button type="submit" disabled={!ready || busy}>Add member</button>
        </form>
      </section>
    {/if}
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
                  · <time datetime={gig.date}>{gig.date}</time> · {gig.venue}
                  <details>
                    <summary>Gig details</summary>
                    <p>{gig.address}</p>
                    {#if gig.contacts.length}
                      <p>Contacts: {gig.contacts.join(" · ")}</p>
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
                    {#if gig.fee}
                      <p>Fee: {gig.fee}</p>
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
button {
  font: inherit;
  border: 1px solid #82958a;
  border-radius: 6px;
  padding: 0.65rem;
}
button {
  background: #205b43;
  color: white;
  cursor: pointer;
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
</style>
