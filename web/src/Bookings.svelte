<script lang="ts">
import {
  type Band,
  type Contact,
  type EnquirySource,
  enquirySources,
  type Gig,
  statusMoves,
  type Venue,
} from "@gigger/schemas";
import { onMount } from "svelte";
import { bands } from "./storage";

let {
  bandList,
  initialBand = "",
  onchanged,
}: {
  bandList: Band[];
  initialBand?: string;
  onchanged: () => Promise<void>;
} = $props();
let bandId = $state("");
let gigs = $state<Gig[]>([]);
let venues = $state<Venue[]>([]);
let contacts = $state<Contact[]>([]);
let screen = $state("gigs");
let detail = $state<Gig | null>(null);
let editing = $state(false);
let draft = $state<Gig | null>(null);
let venue = $state<Venue>({ id: "", name: "", address: "" });
let contact = $state<Contact>({ id: "", name: "" });
let busy = $state(false);
let error = $state("");
let loadedBand = $state("");
let extraText = $state("");
let timesText = $state("");
let amount = $state("");
let ticketUrl = $state("");
let description = $state("");
let newVenue = $state(false);
let newContact = $state(false);
let venueName = $state("");
let venueAddress = $state("");
let contactName = $state("");
let contactEmail = $state("");
let contactPhone = $state("");
let source = $state<EnquirySource>("other");
async function load() {
  const requested = bandId;
  loadedBand = "";
  const [g, v, c] = await Promise.all([
    bands.list("gig", requested),
    bands.list("venue", requested),
    bands.list("contact", requested),
  ]);
  if (requested !== bandId) return;
  gigs = g;
  venues = v;
  contacts = c;
  loadedBand = requested;
}
async function run(action: () => Promise<void>) {
  busy = true;
  error = "";
  try {
    await action();
  } catch (cause) {
    error =
      cause instanceof Error ? cause.message : "Could not save. Please retry.";
  } finally {
    busy = false;
  }
}
function switchBand() {
  detail = null;
  draft = null;
  screen = "gigs";
  gigs = [];
  venues = [];
  contacts = [];
  if (bandId) void run(load);
}
onMount(() => {
  bandId = initialBand || bandList[0]?.id || "";
  if (bandId) void run(load);
});
function edit(gig?: Gig) {
  draft = gig
    ? structuredClone($state.snapshot(gig))
    : {
        id: crypto.randomUUID(),
        title: "",
        date: "",
        contactDate: new Date().toLocaleDateString("en-CA"),
        venueId: "",
        contactIds: [],
        status: "enquiry",
        enquiryText: "",
      };
  draft.contactIds ??= [];
  draft.venueId ??= "";
  amount = typeof gig?.fee === "string" ? gig.fee : (gig?.fee?.amount ?? "");
  extraText = typeof gig?.fee === "object" ? gig.fee.extras.join("\n") : "";
  timesText = gig?.setTimes?.join(", ") ?? "";
  ticketUrl = gig?.public?.ticketUrl ?? "";
  description = gig?.public?.description ?? "";
  source = gig?.enquirySource ?? "other";
  newVenue = false;
  newContact = false;
  venueName = "";
  venueAddress = "";
  contactName = "";
  contactEmail = "";
  contactPhone = "";
  editing = true;
  screen = "gig";
}
async function submitGig(event: SubmitEvent) {
  event.preventDefault();
  if (!draft) return;
  const value = $state.snapshot(draft);
  await run(async () => {
    if (newVenue) {
      const v = {
        id: crypto.randomUUID(),
        name: venueName.trim(),
        address: venueAddress.trim(),
      };
      await bands.save("venue", bandId, v);
      value.venueId = v.id;
      venues = [...venues, v];
      newVenue = false;
      draft = { ...value };
    }
    if (newContact) {
      const c = {
        id: crypto.randomUUID(),
        name: contactName.trim(),
        ...(contactEmail.trim() ? { email: contactEmail.trim() } : {}),
        ...(contactPhone.trim() ? { phone: contactPhone.trim() } : {}),
      };
      await bands.save("contact", bandId, c);
      value.contactIds = [...(value.contactIds ?? []), c.id];
      contacts = [...contacts, c];
      newContact = false;
      draft = { ...value };
    }
    const saved: Gig = {
      ...value,
      title: value.title.trim(),
      contactIds: value.contactIds ?? [],
      enquirySource: source,
      fee: {
        ...(amount.trim() ? { amount: amount.trim() } : {}),
        extras: extraText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      },
      setTimes: timesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      public: { ...(ticketUrl ? { ticketUrl } : {}), description },
    };
    if (!saved.contactDate) delete saved.contactDate;
    if (!saved.loadIn) delete saved.loadIn;
    if (!saved.soundcheck) delete saved.soundcheck;
    if (saved.setLength === undefined) delete saved.setLength;
    await bands.save("gig", bandId, saved);
    detail = saved;
    editing = false;
    draft = null;
    await load();
    await onchanged();
  });
}
async function move(status: Gig["status"]) {
  if (!detail) return;
  const value = { ...$state.snapshot(detail), status };
  await run(async () => {
    await bands.save("gig", bandId, value);
    detail = value;
    await load();
    await onchanged();
  });
}
async function saveRecord(event: SubmitEvent, kind: "venue" | "contact") {
  event.preventDefault();
  await run(async () => {
    if (kind === "venue") {
      const value = {
        ...$state.snapshot(venue),
        id: venue.id || crypto.randomUUID(),
      };
      await bands.save("venue", bandId, value);
      venue = value;
    } else {
      const value = {
        ...$state.snapshot(contact),
        id: contact.id || crypto.randomUUID(),
      };
      for (const key of ["email", "phone", "messenger", "instagram"] as const)
        if (!value[key]) delete value[key];
      await bands.save("contact", bandId, value);
      contact = value;
    }
    await load();
    await onchanged();
  });
}
</script>

<section aria-label="Bookings">
  <h2>Bookings</h2>
  <label
    >Band<select bind:value={bandId} onchange={switchBand} disabled={busy}>
      <option value="">Choose a band</option>
      {#each bandList as band (band.id)}
        <option value={band.id}>{band.name}</option>
      {/each}
    </select></label
  >
  {#if error}
    <p role="alert">{error}</p>
  {/if}
  {#if bandId && loadedBand !== bandId && !busy}
    <button type="button" onclick={() => run(load)}>
      Retry loading bookings
    </button>
  {/if}
  {#if bandId && loadedBand === bandId}
    <nav aria-label="Booking screens">
      <button
        type="button"
        disabled={busy}
        onclick={() => {
          screen = "gigs";
          draft = null;
        }}
      >
        Gigs
      </button>
      <button type="button" disabled={busy} onclick={() => edit()}>
        New enquiry
      </button>
      <button
        type="button"
        disabled={busy}
        onclick={() => {
          screen = "venues";
          draft = null;
        }}
      >
        Venues
      </button>
      <button
        type="button"
        disabled={busy}
        onclick={() => {
          screen = "contacts";
          draft = null;
        }}
      >
        Contacts
      </button>
    </nav>
    {#if screen === "gigs"}
      <h3>Gigs</h3>
      <ul>
        {#each gigs as gig (gig.id)}
          <li>
            <button
              type="button"
              disabled={busy}
              onclick={() => {
                detail = gig;
                editing = false;
                screen = "gig";
              }}
            >
              {gig.date}
              · {gig.title} · {gig.status}
            </button>
          </li>
        {:else}
          <li>No gigs yet.</li>
        {/each}
      </ul>
    {:else if screen === "gig"}
      {#if editing && draft}
        <h3>{detail?.id === draft.id ? "Edit gig" : "New enquiry"}</h3>
        <form onsubmit={submitGig}>
          <fieldset disabled={busy}>
            <label>Title<input bind:value={draft.title} required></label>
            <label
              >Message text<textarea
                bind:value={draft.enquiryText}
              ></textarea></label
            >
            <label
              >Source<select bind:value={source}>
                {#each enquirySources as item (item)}
                  <option value={item}>{item}</option>
                {/each}
              </select></label
            >
            <label
              >Contact date<input
                type="date"
                bind:value={draft.contactDate}
              ></label
            >
            <label
              >Proposed gig date<input
                type="date"
                bind:value={draft.date}
                required
              ></label
            >
            <label
              >Venue<select
                bind:value={draft.venueId}
                required={!newVenue}
                disabled={newVenue}
              >
                <option value="">Choose venue</option>
                {#each venues as v (v.id)}
                  <option value={v.id}>{v.name}</option>
                {/each}
              </select></label
            >
            <label
              ><input type="checkbox" bind:checked={newVenue}>Create a
              venue</label
            >
            {#if newVenue}
              <label>Venue name<input bind:value={venueName} required></label
              ><label>Address<input bind:value={venueAddress} required></label>
            {/if}
            <label
              >Contacts<select multiple bind:value={draft.contactIds}>
                {#each contacts as c (c.id)}
                  <option value={c.id}>{c.name}</option>
                {/each}
              </select></label
            >
            <label
              ><input type="checkbox" bind:checked={newContact}>Create a
              contact</label
            >
            {#if newContact}
              <label
                >Contact name<input bind:value={contactName} required></label
              ><label>Email<input type="email" bind:value={contactEmail}></label
              ><label>Phone<input type="tel" bind:value={contactPhone}></label>
            {/if}
            <label>Load-in<input type="time" bind:value={draft.loadIn}></label>
            <label
              >Soundcheck<input
                type="time"
                bind:value={draft.soundcheck}
              ></label
            >
            <label
              >Set times (comma separated, HH:mm)<input
                bind:value={timesText}
              ></label
            >
            <label
              >Set length (minutes)<input
                type="number"
                min="1"
                step="1"
                bind:value={draft.setLength}
              ></label
            >
            <label>Fee (including currency)<input bind:value={amount}></label>
            <label
              >Fee extras (one per line)<textarea
                bind:value={extraText}
              ></textarea></label
            >
            <label
              >Ticket URL<input
                type="url"
                pattern="https?://.*"
                bind:value={ticketUrl}
              ></label
            >
            <label
              >Public description<textarea
                bind:value={description}
              ></textarea></label
            >
            <label
              >Private notes<textarea
                bind:value={draft.notes}
              ></textarea></label
            >
            <button type="submit">
              Save {draft.status === "enquiry" ? "enquiry" : "gig"}
            </button>
            <button
              type="button"
              onclick={() => {
                editing = false;
                screen = detail ? "gig" : "gigs";
                draft = null;
              }}
            >
              Cancel
            </button>
          </fieldset>
        </form>
      {:else if detail}
        <h3>{detail.title}</h3>
        <p>Proposed gig date: {detail.date} · {detail.status}</p>
        <p>Contact date: {detail.contactDate ?? "Not recorded"}</p>
        <p>
          Venue:
          {venues.find((v) => v.id === detail?.venueId)?.name ?? detail.venue}
        </p>
        <p>
          {venues.find((v) => v.id === detail?.venueId)?.address ??
            detail.address}
        </p>
        <p>
          Contacts:
          {(detail.contactIds ?? [])
            .map((id) => contacts.find((c) => c.id === id)?.name ?? id)
            .join(", ") || detail.contacts?.join(", ")}
        </p>
        <p>
          Enquiry ({detail.enquirySource ?? "other"}):
          {detail.enquiryText ?? ""}
        </p>
        <p>
          Load-in: {detail.loadIn ?? "—"} · Soundcheck:
          {detail.soundcheck ?? "—"}
        </p>
        <p>
          Sets: {detail.setTimes?.join(", ")} · Length:
          {detail.setLength ?? "—"}
          minutes
        </p>
        <p>
          Fee:
          {typeof detail.fee === "string" ? detail.fee : detail.fee?.amount}
          · Extras:
          {typeof detail.fee === "object" ? detail.fee.extras.join(", ") : ""}
        </p>
        <p>{detail.public?.description}</p>
        {#if detail.public?.ticketUrl}
          <p>Tickets: {detail.public.ticketUrl}</p>
        {/if}
        <p>{detail.notes}</p>
        <button
          type="button"
          disabled={busy}
          onclick={() => edit(detail ?? undefined)}
        >
          Edit gig
        </button>
        {#each statusMoves[detail.status] as status (status)}
          <button type="button" disabled={busy} onclick={() => move(status)}>
            Mark {status}
          </button>
        {/each}
      {/if}
    {:else if screen === "venues"}
      <h3>Venues</h3>
      <ul>
        {#each venues as v (v.id)}
          <li>
            <button
              type="button"
              disabled={busy}
              onclick={() => {
                venue = { ...v };
                screen = "venue";
              }}
            >
              {v.name}
            </button>
          </li>
        {:else}
          <li>No venues yet.</li>
        {/each}
      </ul>
      <button
        type="button"
        disabled={busy}
        onclick={() => {
          venue = { id: "", name: "", address: "" };
          screen = "venue";
        }}
      >
        New venue
      </button>
    {:else if screen === "venue"}
      <h3>{venue.id ? venue.name : "New venue"}</h3>
      <form onsubmit={(e) => saveRecord(e, "venue")}>
        <fieldset disabled={busy}>
          <label>Name<input required bind:value={venue.name}></label
          ><label>Address<input required bind:value={venue.address}></label
          ><button type="submit">Save venue</button>
        </fieldset>
      </form>
    {:else if screen === "contacts"}
      <h3>Contacts</h3>
      <ul>
        {#each contacts as c (c.id)}
          <li>
            <button
              type="button"
              disabled={busy}
              onclick={() => {
                contact = { ...c };
                screen = "contact";
              }}
            >
              {c.name}
            </button>
          </li>
        {:else}
          <li>No contacts yet.</li>
        {/each}
      </ul>
      <button
        type="button"
        disabled={busy}
        onclick={() => {
          contact = { id: "", name: "" };
          screen = "contact";
        }}
      >
        New contact
      </button>
    {:else if screen === "contact"}
      <h3>{contact.id ? contact.name : "New contact"}</h3>
      <form onsubmit={(e) => saveRecord(e, "contact")}>
        <fieldset disabled={busy}>
          <label>Name<input required bind:value={contact.name}></label>
          <label>Email<input type="email" bind:value={contact.email}></label>
          <label>Phone<input type="tel" bind:value={contact.phone}></label>
          <label>Messenger<input bind:value={contact.messenger}></label>
          <label>Instagram<input bind:value={contact.instagram}></label>
          <label>Notes<textarea bind:value={contact.notes}></textarea></label>
          <button type="submit">Save contact</button>
        </fieldset>
      </form>
    {/if}
  {/if}
</section>

<style>
section {
  margin-block: 2rem;
}
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block: 1rem;
}
label {
  display: grid;
  gap: 0.3rem;
  margin-block: 0.8rem;
}
input,
select,
textarea,
button {
  font: inherit;
  padding: 0.5rem;
}
textarea {
  min-height: 5rem;
}
fieldset {
  border: 0;
  padding: 0;
}
form {
  max-width: 42rem;
}
[role="alert"] {
  color: #a21b24;
}
</style>
