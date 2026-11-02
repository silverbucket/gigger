<script lang="ts">
import {
  type Contact,
  type Earnings,
  type EnquirySource,
  enquirySources,
  formatFee,
  formatMoney,
  type Gig,
  type OtherBand,
  statusMoves,
  type Venue,
  type VenueSurvey,
  venueAverages,
} from "@gigger/schemas";
import { onMount } from "svelte";
import {
  type BookingSummary,
  groupBookings,
  playedAtVenue,
} from "./booking-list";
import GigSheet from "./GigSheet.svelte";
import PlayedForm from "./PlayedForm.svelte";
import { bands, storage } from "./storage";

let {
  summaries,
  bandId,
  initialGigId = "",
  onopen,
  onchanged,
}: {
  summaries: BookingSummary[];
  bandId: string;
  initialGigId?: string;
  onopen: (bandId: string, gigId: string) => void;
  onchanged: () => Promise<void>;
} = $props();
let groups = $derived(groupBookings(summaries, bandId));
let gigs = $state<Gig[]>([]);
let venues = $state<Venue[]>([]);
let contacts = $state<Contact[]>([]);
let otherBands = $state<OtherBand[]>([]);
let otherBand = $state<OtherBand>({ id: "", name: "", contactIds: [] });
let newOtherBand = $state(false);
let otherBandName = $state("");
let otherBandContactIds = $state<string[]>([]);
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
let amount = $state<number>();
let feeCurrency = $state("");
let bandCurrency = $derived(
  summaries.find((s) => s.band.id === bandId)?.band.currency ?? "EUR",
);
let ticketUrl = $state("");
let description = $state("");
let newVenue = $state(false);
let newContact = $state(false);
let venueName = $state("");
let venueAddress = $state("");
let contactName = $state("");
let contactEmail = $state("");
let contactPhone = $state("");
let source = $state<EnquirySource | "">("");
let syncedChanges = false;
async function load() {
  const requested = bandId;
  const [g, v, c, b] = await Promise.all([
    bands.list("gig", requested),
    bands.list("venue", requested),
    bands.list("contact", requested),
    bands.list("otherBand", requested),
  ]);
  if (requested !== bandId) return;
  gigs = g;
  venues = v;
  contacts = c;
  otherBands = b;
  loadedBand = requested;
  if (detail) detail = g.find((gig) => gig.id === detail?.id) ?? null;
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
    refreshSynced();
  }
}
function refreshSynced() {
  if (!syncedChanges || busy || !bandId) return;
  syncedChanges = false;
  void load().catch(() => {
    error = "Could not refresh bookings. Please retry.";
    syncedChanges = true;
  });
}
onMount(() => {
  if (bandId)
    void run(async () => {
      await load();
      if (initialGigId) {
        detail = gigs.find((gig) => gig.id === initialGigId) ?? null;
        if (detail) screen = "gig";
      }
    });
  const scope = storage.scope("/gigger/");
  const changed = () => {
    syncedChanges = true;
  };
  scope.on("change", changed);
  storage.on("sync-done", refreshSynced);
  return () => {
    scope.removeEventListener("change", changed);
    storage.removeEventListener("sync-done", refreshSynced);
  };
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
  draft.otherBandIds ??= [];
  newOtherBand = false;
  otherBandName = "";
  otherBandContactIds = [];
  draft.venueId ??= "";
  const legacyAmount =
    typeof gig?.fee === "string" ? gig.fee : gig?.fee?.amount;
  amount =
    typeof legacyAmount === "number"
      ? legacyAmount
      : Number.parseFloat(legacyAmount ?? "") || undefined;
  feeCurrency =
    (typeof gig?.fee === "object" ? gig.fee.currency : undefined) ??
    bandCurrency;
  extraText = typeof gig?.fee === "object" ? gig.fee.extras.join("\n") : "";
  timesText = gig?.setTimes?.join(", ") ?? "";
  ticketUrl = gig?.public?.ticketUrl ?? "";
  description = gig?.public?.description ?? "";
  source = gig?.enquirySource ?? "";
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
  const enquirySource = source;
  if (!enquirySource) {
    error = "Choose an enquiry source.";
    return;
  }
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
    if (newOtherBand) {
      const b: OtherBand = {
        id: crypto.randomUUID(),
        name: otherBandName.trim(),
        contactIds: [...otherBandContactIds],
      };
      await bands.save("otherBand", bandId, b);
      value.otherBandIds = [...(value.otherBandIds ?? []), b.id];
      otherBands = [...otherBands, b];
      newOtherBand = false;
      draft = { ...value };
    }
    const saved: Gig = {
      ...value,
      title: value.title.trim(),
      contactIds: value.contactIds ?? [],
      enquirySource,
      fee: {
        ...(amount !== undefined
          ? { amount, currency: feeCurrency.toUpperCase() }
          : {}),
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
async function reloadLatest() {
  await load();
  if (editing && detail && draft?.id === detail.id) edit(detail);
  await onchanged();
}
async function move(status: Gig["status"]) {
  if (!detail) return;
  const gigId = detail.id;
  await run(async () => {
    detail = await bands.moveGigStatus(bandId, gigId, status);
    await load();
    await onchanged();
  });
}
async function savePlayed(survey: VenueSurvey, earnings: Earnings) {
  if (!detail) return;
  const gigId = detail.id;
  await run(async () => {
    detail = await bands.markPlayed(bandId, gigId, survey, earnings);
    screen = "gig";
    await load();
    await onchanged();
  });
}
async function saveRecord(
  event: SubmitEvent,
  kind: "venue" | "contact" | "otherBand",
) {
  event.preventDefault();
  await run(async () => {
    if (kind === "venue") {
      const value = {
        ...$state.snapshot(venue),
        id: venue.id || crypto.randomUUID(),
      };
      await bands.save("venue", bandId, value);
      venue = value;
    } else if (kind === "otherBand") {
      const value = {
        ...$state.snapshot(otherBand),
        id: otherBand.id || crypto.randomUUID(),
        name: otherBand.name.trim(),
      };
      await bands.save("otherBand", bandId, value);
      otherBand = value;
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
  {#if error}
    <p role="alert">{error}</p>
    {#if bandId}
      <button type="button" disabled={busy} onclick={() => run(reloadLatest)}>
        Reload latest
      </button>
    {/if}
  {/if}
  {#if bandId && loadedBand !== bandId && !busy}
    <button type="button" onclick={() => run(load)}>
      Retry loading bookings
    </button>
  {/if}
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
    <button
      type="button"
      disabled={busy || !bandId || loadedBand !== bandId}
      onclick={() => edit()}
    >
      New enquiry
    </button>
    <button
      type="button"
      disabled={busy || !bandId || loadedBand !== bandId}
      onclick={() => {
        screen = "venues";
        draft = null;
      }}
    >
      Venues
    </button>
    <button
      type="button"
      disabled={busy || !bandId || loadedBand !== bandId}
      onclick={() => {
        screen = "contacts";
        draft = null;
      }}
    >
      Contacts
    </button>
    <button
      type="button"
      disabled={busy || !bandId || loadedBand !== bandId}
      onclick={() => {
        screen = "otherBands";
        draft = null;
      }}
    >
      Other bands
    </button>
  </nav>
  {#if !bandId}
    <p>Choose a band above to add an enquiry or manage venues and contacts.</p>
  {/if}
  {#if screen === "sheet" && detail}
    <GigSheet
      gig={detail}
      bandName={summaries.find((s) => s.band.id === bandId)?.band.name ?? ""}
      currency={bandCurrency}
      venue={venues.find((v) => v.id === detail?.venueId)}
      contacts={contacts.filter((c) => detail?.contactIds?.includes(c.id))}
      onback={() => {
        screen = "gig";
      }}
    />
  {:else if screen === "played" && detail}
    <PlayedForm
      gig={detail}
      currency={bandCurrency}
      {busy}
      oncancel={() => {
        screen = "gig";
      }}
      onsave={savePlayed}
    />
  {:else if screen === "gigs"}
    <h3>Gigs</h3>
    {#each groups as group (group.status)}
      <h4 class="status">{group.status}</h4>
      <ul>
        {#each group.rows as row (`${row.band.id}/${row.gig.id}`)}
          <li>
            <button
              type="button"
              disabled={busy}
              onclick={() => {
                if (!bandId) onopen(row.band.id, row.gig.id);
                else {
                  detail = row.gig;
                  editing = false;
                  screen = "gig";
                }
              }}
            >
              <time datetime={row.gig.date}>{row.gig.date}</time>
              · {row.gig.title} · {row.band.name}
              {#if row.venueName}
                · {row.venueName}
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p>No gigs yet.</p>
    {/each}
  {:else if screen === "gig"}
    {#if detail || draft}
      <p class="gig-status">
        Proposed gig date: {detail?.date || draft?.date || "Not set"} ·
        {detail?.status ?? draft?.status}
      </p>
    {/if}
    {#if editing && draft}
      <h3>{detail?.id === draft.id ? "Edit gig" : "New enquiry"}</h3>
      <form
        onsubmit={submitGig}
        oninvalidcapture={(event) => {
          const input = event.target as HTMLElement;
          const section = input.closest("details");
          if (section) section.open = true;
        }}
      >
        <fieldset disabled={busy}>
          <details open>
            <summary>Enquiry</summary>
            <label>Title<input bind:value={draft.title} required></label>
            <label
              >Message text<textarea
                bind:value={draft.enquiryText}
              ></textarea></label
            >
            <label
              >Source<select bind:value={source} required>
                <option value="" disabled>Choose a source</option>
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
              >Private notes<textarea
                bind:value={draft.notes}
              ></textarea></label
            >
          </details>
          <details open>
            <summary>When</summary>
            <label
              >Proposed gig date<input
                type="date"
                bind:value={draft.date}
                required
              ></label
            >
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
          </details>
          <details open>
            <summary>Where</summary>
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
            <label class="toggle"
              ><input
                type="checkbox"
                role="switch"
                aria-checked={newVenue}
                bind:checked={newVenue}
                aria-controls="create-venue-fields"
              >Create a new venue</label
            >
            {#if newVenue}
              <div id="create-venue-fields">
                <label>Venue name<input bind:value={venueName} required></label>
                <label>Address<input bind:value={venueAddress} required></label>
              </div>
            {/if}
          </details>
          <details>
            <summary>Who</summary>
            <fieldset>
              <legend>Other bands playing — tap to add or remove</legend>
              {#each otherBands as b (b.id)}
                <label class="toggle"
                  ><input
                    type="checkbox"
                    value={b.id}
                    bind:group={draft.otherBandIds}
                  >{b.name}</label
                >
              {:else}
                <p>No other bands yet.</p>
              {/each}
            </fieldset>
            <label class="toggle"
              ><input
                type="checkbox"
                role="switch"
                aria-checked={newOtherBand}
                bind:checked={newOtherBand}
                aria-controls="create-other-band-fields"
              >Create a new band</label
            >
            {#if newOtherBand}
              <div id="create-other-band-fields">
                <label
                  >Band name<input bind:value={otherBandName} required></label
                >
                <fieldset>
                  <legend>Contacts in this band</legend>
                  {#each contacts as c (c.id)}
                    <label class="toggle"
                      ><input
                        type="checkbox"
                        value={c.id}
                        bind:group={otherBandContactIds}
                      >{c.name}</label
                    >
                  {:else}
                    <p>
                      Add contacts from the Contacts screen to link them to this
                      band.
                    </p>
                  {/each}
                </fieldset>
              </div>
            {/if}
            <fieldset class="contact-options">
              <legend>Contacts — tap to add or remove</legend>
              {#each contacts as c (c.id)}
                <label class="toggle"
                  ><input
                    type="checkbox"
                    value={c.id}
                    bind:group={draft.contactIds}
                  >{c.name}</label
                >
              {:else}
                <p>No contacts yet.</p>
              {/each}
            </fieldset>
            <label class="toggle"
              ><input
                type="checkbox"
                role="switch"
                aria-checked={newContact}
                bind:checked={newContact}
                aria-controls="create-contact-fields"
              >Create a new contact</label
            >
            {#if newContact}
              <div id="create-contact-fields">
                <label
                  >Contact name<input bind:value={contactName} required></label
                >
                <label
                  >Email<input type="email" bind:value={contactEmail}></label
                >
                <label>Phone<input type="tel" bind:value={contactPhone}></label>
              </div>
            {/if}
          </details>
          <details>
            <summary>Money</summary>
            <label
              >Fee<input
                type="number"
                min="0"
                step="0.01"
                bind:value={amount}
              ></label
            >
            <label
              >Fee currency<input
                bind:value={feeCurrency}
                required={amount !== undefined}
                pattern={"[A-Za-z]{3}"}
                maxlength="3"
              ></label
            >
            <label
              >Fee extras (one per line)<textarea
                bind:value={extraText}
              ></textarea></label
            >
          </details>
          <details>
            <summary>Public</summary>
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
          </details>
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
      {@const gigVenue = venues.find((v) => v.id === detail?.venueId)}
      {@const gigContacts =
        (detail.contactIds ?? [])
          .map((id) => contacts.find((c) => c.id === id)?.name ?? id)
          .join(", ") || detail.contacts?.join(", ")}
      {@const feeText = formatFee(detail.fee, bandCurrency, navigator.language)}
      <h3>{detail.title}</h3>
      <button
        type="button"
        onclick={() => {
          screen = "sheet";
        }}
      >
        View gig sheet
      </button>
      {#if detail.status === "played" && detail.earnings}
        <p>
          <strong
            >Your band took home:
            {formatMoney(
              detail.earnings.takeHome,
              detail.earnings.currency,
              navigator.language,
            )}</strong
          >
        </p>
        <p>Private, only you can see this</p>
      {/if}
      {#if detail.otherBandIds?.length}
        <h4>Playing with</h4>
        <ul>
          {#each detail.otherBandIds as id (id)}
            {@const b = otherBands.find((b) => b.id === id)}
            <li>
              <button
                type="button"
                disabled={busy || !b}
                onclick={() => {
                  if (b) {
                    otherBand = structuredClone($state.snapshot(b));
                    screen = "otherBand";
                  }
                }}
              >
                {b?.name ?? id}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if detail.contactDate}
        <p>Contact date: {detail.contactDate}</p>
      {/if}
      {#if gigVenue?.name || detail.venue}
        <p>Venue: {gigVenue?.name ?? detail.venue}</p>
      {/if}
      {#if gigVenue?.address || detail.address}
        <p>{gigVenue?.address ?? detail.address}</p>
      {/if}
      {#if gigContacts}
        <p>Contacts: {gigContacts}</p>
      {/if}
      {#if detail.enquirySource}
        <p>Source: {detail.enquirySource}</p>
      {/if}
      {#if detail.enquiryText?.trim()}
        <p>Enquiry: {detail.enquiryText}</p>
      {/if}
      {#if detail.loadIn}
        <p>Load-in: {detail.loadIn}</p>
      {/if}
      {#if detail.soundcheck}
        <p>Soundcheck: {detail.soundcheck}</p>
      {/if}
      {#if detail.setTimes?.length}
        <p>Sets: {detail.setTimes.join(", ")}</p>
      {/if}
      {#if detail.setLength}
        <p>Set length: {detail.setLength} minutes</p>
      {/if}
      {#if feeText}
        <p>Fee: {feeText}</p>
      {/if}
      {#if typeof detail.fee === "object" && detail.fee.extras.length}
        <p>Extras: {detail.fee.extras.join(", ")}</p>
      {/if}
      {#if detail.public?.description?.trim()}
        <p>{detail.public.description}</p>
      {/if}
      {#if detail.public?.ticketUrl}
        <p>
          Tickets:
          <a href={detail.public.ticketUrl}>{detail.public.ticketUrl}</a>
        </p>
      {/if}
      {#if detail.notes?.trim()}
        <p>{detail.notes}</p>
      {/if}
      <button
        type="button"
        disabled={busy}
        onclick={() => edit(detail ?? undefined)}
      >
        Edit gig
      </button>
      {#each statusMoves[detail.status] as status (status)}
        <button
          type="button"
          disabled={busy}
          onclick={() => {
            if (status === "played") screen = "played";
            else void move(status);
          }}
        >
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
        <label>Name<input required bind:value={venue.name}></label>
        <label>Address<input required bind:value={venue.address}></label>
        <button type="submit">Save venue</button>
      </fieldset>
    </form>
    {#if venue.id}
      {@const surveys = venues.find((v) => v.id === venue.id)?.surveys ?? []}
      {@const averages = venueAverages(surveys)}
      <h4>Venue surveys</h4>
      <p>Saved in your account; sharing with other bands comes later.</p>
      {#if averages}
        <p>
          Average rating: {averages.rating.toFixed(1)} / 5 · Most common
          capacity: {averages.capacities.join(" / ")} · Venue provided PA:
          {averages.paProvided}
          of {averages.count} surveys ({Math.round(
            (averages.paProvided / averages.count) * 100,
          )}%)
        </p>
        {#each [...surveys].sort((a, b) =>
          b.date.localeCompare(a.date),
        ) as survey (survey.gigId)}
          <article>
            <h5>{survey.date} · {survey.rating} / 5</h5>
            <p>
              Capacity: {survey.capacity} · {survey.setting} · PA: {survey.pa}
            </p>
            {#if survey.stageNotes?.trim()}
              <p>{survey.stageNotes}</p>
            {/if}
            <p>Would play again: {survey.playAgain ? "Yes" : "No"}</p>
          </article>
        {/each}
      {:else}
        <p>No surveys yet.</p>
      {/if}
      <h4>Gigs played here</h4>
      <ul>
        {#each playedAtVenue(
          gigs,
          venues.find((v) => v.id === venue.id) ?? venue,
        ) as gig (gig.id)}
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
              · {gig.title}
            </button>
          </li>
        {:else}
          <li>No gigs played here yet.</li>
        {/each}
      </ul>
    {/if}
  {:else if screen === "otherBands"}
    <h3>Other bands</h3>
    <p>Reusable bands you share a bill with.</p>
    <ul>
      {#each otherBands as b (b.id)}
        <li>
          <button
            type="button"
            disabled={busy}
            onclick={() => {
              otherBand = structuredClone($state.snapshot(b));
              screen = "otherBand";
            }}
          >
            {b.name}
          </button>
        </li>
      {:else}
        <li>No other bands yet.</li>
      {/each}
    </ul>
    <button
      type="button"
      disabled={busy}
      onclick={() => {
        otherBand = { id: "", name: "", contactIds: [] };
        screen = "otherBand";
      }}
    >
      New band
    </button>
  {:else if screen === "otherBand"}
    <h3>{otherBand.id ? otherBand.name : "New band"}</h3>
    <form onsubmit={(e) => saveRecord(e, "otherBand")}>
      <fieldset disabled={busy}>
        <label>Band name<input required bind:value={otherBand.name}></label>
        <fieldset>
          <legend>Contacts in this band — tap to add or remove</legend>
          {#each contacts as c (c.id)}
            <label class="toggle"
              ><input
                type="checkbox"
                value={c.id}
                bind:group={otherBand.contactIds}
              >{c.name}</label
            >
          {:else}
            <p>No contacts yet. Add one from the Contacts screen.</p>
          {/each}
        </fieldset>
        <label>Notes<textarea bind:value={otherBand.notes}></textarea></label>
        <button type="submit">Save band</button>
      </fieldset>
    </form>
    {#if otherBand.contactIds.length}
      <h4>Band contacts</h4>
      <ul>
        {#each otherBand.contactIds as id (id)}
          {@const c = contacts.find((c) => c.id === id)}
          <li>
            {#if c}
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
              {#if c.email}
                · {c.email}
              {/if}
              {#if c.phone}
                · {c.phone}
              {/if}
              {#if c.messenger}
                · {c.messenger}
              {/if}
              {#if c.instagram}
                · {c.instagram}
              {/if}
            {:else}
              {id}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
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
  min-height: 44px;
  box-sizing: border-box;
  max-width: 100%;
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
details {
  border-bottom: 1px solid #ccc;
  padding-block: 0.8rem;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem;
  cursor: pointer;
}
.toggle input {
  width: 1.2rem;
  height: 1.2rem;
}
.status {
  text-transform: capitalize;
}
.gig-status {
  position: sticky;
  top: 0;
  background: white;
  padding-block: 0.7rem;
  z-index: 1;
}
@media print {
  section:has(:global(.gig-sheet)) > :not(:global(.gig-sheet)) {
    display: none;
  }
  section:has(:global(.gig-sheet)) {
    margin: 0;
    padding: 0;
    border: 0;
  }
}
</style>
