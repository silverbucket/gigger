<script lang="ts">
import type { Contact, EnquirySource } from "@showday/schemas";
import { enquirySources, type Gig, type OtherBand } from "@showday/schemas";
import { untrack } from "svelte";
import BottomActionBar from "../components/BottomActionBar.svelte";
import Icon from "../components/Icon.svelte";
import PhoneHeader from "../components/PhoneHeader.svelte";
import Segmented from "../components/Segmented.svelte";
import Tag from "../components/Tag.svelte";
import Typeahead, { type Option, rank } from "../components/Typeahead.svelte";
import { type BandData, data as store } from "../lib/data.svelte";
import { today } from "../lib/format";
import { channelName } from "../lib/inbox";
import type { Prefill } from "../lib/messages.svelte";
import { ui } from "../lib/ui.svelte";
import { bands } from "../storage";

let {
  data,
  gig,
  prefill,
  onsaved,
  oncancel,
}: {
  data: BandData;
  /** The gig being edited; a new enquiry when absent. */
  gig?: Gig;
  prefill?: Prefill;
  onsaved: (gigId: string) => void;
  oncancel: () => void;
} = $props();

// The form is a draft: later syncs don't overwrite what's being typed.
const initial = untrack(() => $state.snapshot(gig));
const start: Prefill = untrack(() => $state.snapshot(prefill)) ?? {};
const extracted = start.extracted ?? {};
const bandId = untrack(() => data.band.id);
const currency = untrack(() => data.band.currency ?? "EUR");

let draft = $state<Gig>(
  initial
    ? structuredClone(initial)
    : {
        id: crypto.randomUUID(),
        title: start.title ?? "",
        date: extracted.date ?? "",
        contactDate: today(),
        venueId: extracted.venueId ?? "",
        contactIds: start.contactId ? [start.contactId] : [],
        status: "enquiry",
        enquiryText: start.enquiryText ?? "",
        ...(start.conversationId
          ? { conversationId: start.conversationId }
          : {}),
        ...(extracted.start ? { setTimes: [extracted.start] } : {}),
        notes: noteFromMessage(),
      },
);
draft.contactIds ??= [];
draft.otherBandIds ??= [];
draft.venueId ??= "";
let source = $state<EnquirySource | undefined>(
  initial?.enquirySource ?? start.source,
);
let timesText = $state(draft.setTimes?.join(", ") ?? "");
const previousFee =
  typeof initial?.fee === "string" ? initial.fee : initial?.fee?.amount;
let amount = $state<number | undefined>(
  typeof previousFee === "number" ? previousFee : extracted.fee?.amount,
);
// Legacy free-text fees stay as written until an amount replaces them.
const legacyFee = typeof previousFee === "string" ? previousFee.trim() : "";
let feeCurrency = $state(
  (typeof initial?.fee === "object" ? initial.fee.currency : undefined) ??
    extracted.fee?.currency ??
    currency,
);
let extraText = $state(
  typeof initial?.fee === "object" ? initial.fee.extras.join("\n") : "",
);
let ticketUrl = $state(initial?.public?.ticketUrl ?? "");
let description = $state(initial?.public?.description ?? "");

// Venue: pick one, or create it inline.
let venueQuery = $state(
  untrack(() => data.venues.find((v) => v.id === draft.venueId)?.name ?? ""),
);
let newVenue = $state(!!extracted.newVenue && !initial);
let venueName = $state(extracted.newVenue ?? "");
let venueAddress = $state("");
let venueCity = $state("");
const venueOptions = $derived(
  rank(
    data.venues,
    venueQuery,
    (v) => v.name,
    (v) => `${v.city ?? ""} ${v.address}`,
  ).map((v) => ({ id: v.id, label: v.name, sub: v.city || v.address })),
);
const pickedVenue = $derived(data.venues.find((v) => v.id === draft.venueId));

// Contacts: picked ones, plus new ones saved together with the gig.
let pendingContacts = $state<Contact[]>(
  start.newContact && !start.contactId
    ? [{ ...start.newContact, id: crypto.randomUUID() }]
    : [],
);
let contactQuery = $state("");
let creatingContact = $state<Contact | null>(null);
const contactOptions = $derived.by((): Option[] => {
  const chosen = new Set(draft.contactIds);
  const available = data.contacts.filter((c) => !chosen.has(c.id));
  if (!contactQuery.trim() && start.suggestions?.length)
    return start.suggestions
      .filter((s) => !chosen.has(s.contact.id))
      .map((s) => ({
        id: s.contact.id,
        label: s.contact.name,
        sub:
          s.contact.email ??
          s.contact.phone ??
          s.contact.instagram ??
          s.contact.messenger,
        badge: s.reason,
      }));
  return rank(
    available,
    contactQuery,
    (c) => c.name,
    (c) => [c.email, c.phone, c.messenger, c.instagram].join(" "),
  ).map((c) => ({
    id: c.id,
    label: c.name,
    sub: c.email ?? c.phone ?? c.instagram ?? c.messenger,
  }));
});
const fromMessage = !!start.conversationId && !initial;
const contactUnresolved = $derived(
  fromMessage && !draft.contactIds?.length && !pendingContacts.length,
);

// Other bands on the bill.
let bandQuery = $state("");
let pendingBands = $state<OtherBand[]>([]);
const bandOptions = $derived(
  rank(
    data.otherBands.filter((b) => !draft.otherBandIds?.includes(b.id)),
    bandQuery,
    (b) => b.name,
  ).map((b) => ({ id: b.id, label: b.name })),
);

let error = $state("");
let saving = $state(false);
const isEdit = !!initial;

function noteFromMessage() {
  const found = [
    extracted.sets
      ? `${extracted.sets} ${extracted.sets === 1 ? "set" : "sets"}`
      : "",
    extracted.doors ? `doors ${extracted.doors}` : "",
  ].filter(Boolean);
  return found.length ? `From the message: ${found.join(" · ")}` : "";
}
function addContact(id: string) {
  draft.contactIds = [...(draft.contactIds ?? []), id];
  contactQuery = "";
}
function startContact(name: string) {
  creatingContact = { id: "", name };
  contactQuery = "";
}
function addPendingContact() {
  if (!creatingContact?.name.trim()) return;
  pendingContacts = [
    ...pendingContacts,
    { ...$state.snapshot(creatingContact), id: crypto.randomUUID() },
  ];
  creatingContact = null;
}
function contactLabel(id: string) {
  return data.contacts.find((c) => c.id === id)?.name ?? id;
}
const clean = (contact: Contact) => {
  const value: Contact = { ...contact, name: contact.name.trim() };
  for (const key of [
    "email",
    "phone",
    "messenger",
    "instagram",
    "notes",
  ] as const) {
    value[key] = value[key]?.trim();
    if (!value[key]) delete value[key];
  }
  return value;
};

async function submit(event: SubmitEvent) {
  event.preventDefault();
  error = "";
  if (!newVenue && !draft.venueId) {
    error = "Choose a venue from the suggestions, or create a new one.";
    return;
  }
  const enquirySource = source;
  if (!enquirySource) {
    error = "Choose where the enquiry came from.";
    return;
  }
  if (creatingContact?.name.trim()) addPendingContact();
  saving = true;
  ui.busy = true;
  const value = $state.snapshot(draft);
  try {
    if (newVenue) {
      const venue = {
        id: crypto.randomUUID(),
        name: venueName.trim(),
        address: venueAddress.trim(),
        ...(venueCity.trim() ? { city: venueCity.trim() } : {}),
      };
      await bands.save("venue", bandId, venue);
      value.venueId = venue.id;
      // Keep the draft consistent if a later step fails, so a retry doesn't duplicate it.
      draft.venueId = venue.id;
      venueQuery = venue.name;
      newVenue = false;
    }
    for (const contact of $state.snapshot(pendingContacts)) {
      await bands.save("contact", bandId, clean(contact));
      value.contactIds = [...(value.contactIds ?? []), contact.id];
      draft.contactIds = value.contactIds;
      pendingContacts = pendingContacts.filter((c) => c.id !== contact.id);
    }
    for (const band of $state.snapshot(pendingBands)) {
      await bands.save("otherBand", bandId, band);
      value.otherBandIds = [...(value.otherBandIds ?? []), band.id];
      draft.otherBandIds = value.otherBandIds;
      pendingBands = pendingBands.filter((b) => b.id !== band.id);
    }
    const saved: Gig = {
      ...value,
      title: value.title.trim(),
      contactIds: value.contactIds ?? [],
      enquirySource,
      fee: {
        ...(amount !== undefined && amount !== null
          ? { amount, currency: feeCurrency.toUpperCase() }
          : legacyFee
            ? { amount: legacyFee }
            : {}),
        extras: extraText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      },
      setTimes: timesText
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      public: { ...(ticketUrl ? { ticketUrl } : {}), description },
    };
    if (!saved.contactDate) delete saved.contactDate;
    if (!saved.loadIn) delete saved.loadIn;
    if (!saved.soundcheck) delete saved.soundcheck;
    if (saved.setLength === undefined || saved.setLength === null)
      delete saved.setLength;
    if (!saved.otherBandIds?.length) delete saved.otherBandIds;
    await bands.save("gig", bandId, saved);
    await store.load();
    onsaved(saved.id);
  } catch (cause) {
    error =
      cause instanceof Error && cause.message
        ? cause.message
        : "Could not save. Please retry.";
  } finally {
    saving = false;
    ui.busy = false;
  }
}
</script>

<PhoneHeader title={isEdit ? "Edit gig" : "New gig"} onclose={oncancel} />

<form
  class="gig-form"
  onsubmit={submit}
  oninvalidcapture={(event) => {
    const section = (event.target as HTMLElement).closest("details");
    if (section) section.open = true;
  }}
>
  <div class="detail-head head">
    <p class="kicker">
      {fromMessage
        ? "From this message"
        : isEdit
          ? data.band.name
          : `New for ${data.band.name}`}
    </p>
    <h2>{isEdit ? "Edit gig" : "New gig"}</h2>
    <p class="visibility-note">
      <Icon name="globe" size={13} />Once your public page is published, it
      lists confirmed and played gigs with date, time, venue, city, tickets and
      description. Everything else is private.
    </p>
    <button
      type="button"
      class="btn btn-icon close"
      aria-label="Close"
      onclick={oncancel}
    >
      <Icon name="x" size={20} />
    </button>
  </div>

  <fieldset disabled={saving}>
    {#if fromMessage && start.enquiryText}
      <div class="quote-block">
        <p class="small-label">{start.from}</p>
        <p class="quote pre">“{start.enquiryText.trim()}”</p>
      </div>
    {/if}

    <div class="block form">
      {#if fromMessage}
        <div class="field">
          <span class="field-label">Contact</span>
          {#if draft.contactIds?.length}
            {@const contact = data.contacts.find(
              (c) => c.id === draft.contactIds?.[0],
            )}
            <div class="picked">
              <div>
                <strong>{contact?.name ?? draft.contactIds[0]}</strong>
                <span class="muted">
                  {[
                    contact?.instagram &&
                      `@${contact.instagram.replace(/^@/, "")}`,
                    contact?.email,
                    contact?.phone,
                    contact?.messenger,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {#if start.contactReason &&
                  draft.contactIds[0] === start.contactId}
                  <span class="reason"
                    ><Icon name="check" size={12} stroke={3} />
                    {start.contactReason}</span
                  >
                {/if}
              </div>
              <button
                type="button"
                class="btn btn-ghost"
                onclick={() => {
                  draft.contactIds = [];
                }}
              >
                Change
              </button>
            </div>
          {:else if pendingContacts.length}
            <div class="picked new">
              <div class="picked-head">
                <strong>New contact</strong>
                <span class="tag tag-accent">No match</span>
              </div>
              <div class="field">
                <label for="new-contact-name"
                  >Name · from
                  {start.source ? channelName[start.source] : "the"}
                  profile</label
                >
                <input
                  id="new-contact-name"
                  class="input"
                  bind:value={pendingContacts[0].name}
                  required
                >
              </div>
              {#if start.source === "email"}
                <div class="field">
                  <label for="new-contact-handle">Email</label>
                  <input
                    id="new-contact-handle"
                    class="input"
                    type="email"
                    bind:value={pendingContacts[0].email}
                  >
                </div>
              {:else if start.source === "instagram"}
                <div class="field">
                  <label for="new-contact-handle">Instagram handle</label>
                  <input
                    id="new-contact-handle"
                    class="input"
                    bind:value={pendingContacts[0].instagram}
                  >
                </div>
              {:else if start.source === "messenger"}
                <div class="field">
                  <label for="new-contact-handle">Messenger</label>
                  <input
                    id="new-contact-handle"
                    class="input"
                    bind:value={pendingContacts[0].messenger}
                  >
                </div>
              {/if}
              <button
                type="button"
                class="btn btn-ghost link"
                onclick={() => {
                  pendingContacts = [];
                }}
              >
                Not new? Link to an existing contact
              </button>
            </div>
          {:else}
            <Typeahead
              label={start.suggestions?.length
                ? `${start.suggestions.length} possible ${start.suggestions.length === 1 ? "contact" : "contacts"}: search or choose`
                : "Search contacts"}
              bind:query={contactQuery}
              options={contactOptions}
              placeholder={`Search ${data.contacts.length} contacts`}
              createLabel={() => "New contact from sender"}
              oncreate={() => {
                if (start.newContact)
                  pendingContacts = [
                    { ...start.newContact, id: crypto.randomUUID() },
                  ];
              }}
              onselect={addContact}
              focusOnMount={contactUnresolved && !!start.suggestions?.length}
            />
            {#if start.suggestions?.length}
              <ul class="suggest">
                {#each contactOptions.slice(0, 5) as option (option.id)}
                  <li>
                    <button type="button" onclick={() => addContact(option.id)}>
                      <span
                        ><strong>{option.label}</strong>
                        {#if option.sub}
                          <span class="muted"> · {option.sub}</span>
                        {/if}</span
                      >
                      {#if option.badge}
                        <span class="tag tag-accent">{option.badge}</span>
                      {/if}
                    </button>
                  </li>
                {/each}
                {#if start.newContact}
                  <li>
                    <button
                      type="button"
                      class="create"
                      onclick={() => {
                        if (start.newContact)
                          pendingContacts = [
                            { ...start.newContact, id: crypto.randomUUID() },
                          ];
                      }}
                    >
                      + New contact from sender
                      <span class="muted">{start.newContact.name}</span>
                    </button>
                  </li>
                {/if}
              </ul>
            {/if}
          {/if}
        </div>
      {/if}

      <div class="field">
        <span class="field-label"
          >Where did it come from? <span class="required">Required</span></span
        >
        <Segmented
          label="Source"
          options={enquirySources.map((s) => ({
            value: s,
            label: channelName[s],
          }))}
          bind:value={source}
          columns={ui.phone ? 2 : 4}
          required
        />
      </div>
      <div class="field-row">
        <div class="field">
          <label for="gig-contact-date">Contacted</label>
          <input
            id="gig-contact-date"
            class="input"
            type="date"
            bind:value={draft.contactDate}
          >
        </div>
        <div class="field">
          <label for="gig-date">Proposed gig date</label>
          <input
            id="gig-date"
            class="input"
            type="date"
            bind:value={draft.date}
            required
          >
        </div>
      </div>
      <div class="field">
        <div class="label-row">
          <label for="gig-title">Title</label>
          <Tag kind="private">Private</Tag>
        </div>
        <input id="gig-title" class="input" bind:value={draft.title} required>
      </div>
      {#if !newVenue}
        <Typeahead
          label="Venue"
          bind:query={venueQuery}
          options={venueOptions}
          placeholder="Type a venue name"
          required={!draft.venueId}
          createLabel={(q) => `Create “${q}” as a new venue`}
          oncreate={(q) => {
            newVenue = true;
            venueName = q;
            draft.venueId = "";
          }}
          onselect={(id) => {
            draft.venueId = id;
            venueQuery = data.venues.find((v) => v.id === id)?.name ?? "";
          }}
          hint={pickedVenue
            ? [pickedVenue.address, pickedVenue.city].filter(Boolean).join(", ")
            : venueQuery.trim()
              ? "Choose a venue from the suggestions."
              : undefined}
        />
      {:else}
        <fieldset class="nested">
          <legend class="nested-head">
            <strong>New venue</strong>
            <button
              type="button"
              class="btn btn-ghost"
              onclick={() => {
                newVenue = false;
              }}
            >
              Choose existing
            </button>
          </legend>
          <div class="field">
            <label for="venue-name">Venue name</label>
            <input
              id="venue-name"
              class="input"
              bind:value={venueName}
              required
            >
          </div>
          <div class="field">
            <label for="venue-address">Address</label>
            <input
              id="venue-address"
              class="input"
              bind:value={venueAddress}
              required
            >
          </div>
          <div class="field">
            <label for="venue-city">City</label>
            <input id="venue-city" class="input" bind:value={venueCity}>
          </div>
        </fieldset>
      {/if}
      {#if fromMessage}
        <p class="field-hint">
          Filled in from the message. Check before saving.
        </p>
      {/if}
    </div>

    <details>
      <summary>
        <strong>When</strong> <span>load-in, soundcheck, sets</span>
        <Icon name="chevron-down" />
      </summary>
      <div class="form inner">
        <div class="field-row">
          <div class="field">
            <label for="gig-load-in">Load-in</label>
            <input
              id="gig-load-in"
              class="input"
              type="time"
              bind:value={draft.loadIn}
            >
          </div>
          <div class="field">
            <label for="gig-soundcheck">Soundcheck</label>
            <input
              id="gig-soundcheck"
              class="input"
              type="time"
              bind:value={draft.soundcheck}
            >
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="gig-sets">Set times (HH:mm, comma separated)</label>
            <input
              id="gig-sets"
              class="input"
              bind:value={timesText}
              placeholder="21:00, 22:15"
              pattern={"\\s*([01][0-9]|2[0-3]):[0-5][0-9](\\s*[,\\s]\\s*([01][0-9]|2[0-3]):[0-5][0-9])*\\s*"}
            >
          </div>
          <div class="field">
            <label for="gig-set-length">Set length (minutes)</label>
            <input
              id="gig-set-length"
              class="input"
              type="number"
              min="1"
              step="1"
              bind:value={draft.setLength}
            >
          </div>
        </div>
      </div>
    </details>

    <details>
      <summary>
        <strong>Who</strong> <span>contacts and other bands on the bill</span>
        <Icon name="chevron-down" />
      </summary>
      <div class="form inner">
        {#if !fromMessage || draft.contactIds?.length || pendingContacts.length}
          <div class="field">
            <span class="field-label">Contacts for this gig</span>
            {#if draft.contactIds?.length || pendingContacts.length}
              <ul class="chips" aria-label="Contacts for this gig">
                {#each draft.contactIds ?? [] as id (id)}
                  <li>
                    {contactLabel(id)}
                    <button
                      type="button"
                      class="chip-remove"
                      aria-label={`Remove ${contactLabel(id)}`}
                      onclick={() => {
                        draft.contactIds = (draft.contactIds ?? []).filter(
                          (c) => c !== id,
                        );
                      }}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </li>
                {/each}
                {#each pendingContacts as contact (contact.id)}
                  <li class="new">
                    New: {contact.name}
                    <button
                      type="button"
                      class="chip-remove"
                      aria-label={`Remove ${contact.name}`}
                      onclick={() => {
                        pendingContacts = pendingContacts.filter(
                          (c) => c.id !== contact.id,
                        );
                      }}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
          {#if creatingContact}
            <fieldset class="nested">
              <legend class="nested-head">
                <strong>New contact</strong>
                <span class="muted">Only a name is required</span>
              </legend>
              <div class="field">
                <label for="contact-name">Contact name</label>
                <input
                  id="contact-name"
                  class="input"
                  bind:value={creatingContact.name}
                >
              </div>
              <div class="field-row">
                <div class="field">
                  <label for="contact-email">Email</label>
                  <input
                    id="contact-email"
                    class="input"
                    type="email"
                    bind:value={creatingContact.email}
                  >
                </div>
                <div class="field">
                  <label for="contact-phone">Phone</label>
                  <input
                    id="contact-phone"
                    class="input"
                    type="tel"
                    bind:value={creatingContact.phone}
                  >
                </div>
              </div>
              <div class="field-row">
                <div class="field">
                  <label for="contact-messenger">Messenger</label>
                  <input
                    id="contact-messenger"
                    class="input"
                    bind:value={creatingContact.messenger}
                  >
                </div>
                <div class="field">
                  <label for="contact-instagram">Instagram</label>
                  <input
                    id="contact-instagram"
                    class="input"
                    bind:value={creatingContact.instagram}
                  >
                </div>
              </div>
              <div class="row-actions">
                <button
                  type="button"
                  class="btn btn-secondary"
                  onclick={addPendingContact}
                >
                  <Icon name="plus" />
                  Add and select
                </button>
                <button
                  type="button"
                  class="btn btn-ghost"
                  onclick={() => {
                    creatingContact = null;
                  }}
                >
                  Cancel
                </button>
              </div>
            </fieldset>
          {:else}
            <Typeahead
              label="Add a contact"
              bind:query={contactQuery}
              options={contactOptions}
              placeholder={`Search ${data.contacts.length} contacts`}
              createLabel={(q) => `Create “${q}” as a new contact`}
              oncreate={startContact}
              onselect={addContact}
            />
          {/if}
        {/if}
        <div class="field">
          <span class="field-label">Other bands on the bill</span>
          {#if draft.otherBandIds?.length || pendingBands.length}
            <ul class="chips" aria-label="Other bands playing">
              {#each draft.otherBandIds ?? [] as id (id)}
                {@const band = data.otherBands.find((b) => b.id === id)}
                <li>
                  {band?.name ?? id}
                  <button
                    type="button"
                    class="chip-remove"
                    aria-label={`Remove ${band?.name ?? id}`}
                    onclick={() => {
                      draft.otherBandIds = (draft.otherBandIds ?? []).filter(
                        (b) => b !== id,
                      );
                    }}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </li>
              {/each}
              {#each pendingBands as band (band.id)}
                <li class="new">
                  New: {band.name}
                  <button
                    type="button"
                    class="chip-remove"
                    aria-label={`Remove ${band.name}`}
                    onclick={() => {
                      pendingBands = pendingBands.filter(
                        (b) => b.id !== band.id,
                      );
                    }}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <Typeahead
          label="Add a band"
          bind:query={bandQuery}
          options={bandOptions}
          placeholder="Type a band name"
          createLabel={(q) => `Create “${q}” as a new band`}
          oncreate={(name) => {
            pendingBands = [
              ...pendingBands,
              { id: crypto.randomUUID(), name, contactIds: [] },
            ];
            bandQuery = "";
          }}
          onselect={(id) => {
            draft.otherBandIds = [...(draft.otherBandIds ?? []), id];
            bandQuery = "";
          }}
        />
      </div>
    </details>

    <details>
      <summary>
        <strong>Money</strong> <span>fee and extras</span>
        <Tag kind="private">Private</Tag>
        <Icon name="chevron-down" />
      </summary>
      <div class="form inner">
        {#if legacyFee}
          <p class="field-hint">
            Current fee: {legacyFee}. Enter an amount to replace it.
          </p>
        {/if}
        <div class="field-row">
          <div class="field">
            <label for="gig-fee">Fee</label>
            <input
              id="gig-fee"
              class="input"
              type="number"
              min="0"
              step="0.01"
              bind:value={amount}
            >
          </div>
          <div class="field">
            <label for="gig-fee-currency">Fee currency</label>
            <input
              id="gig-fee-currency"
              class="input"
              bind:value={feeCurrency}
              required={amount !== undefined && amount !== null}
              pattern={"[A-Za-z]{3}"}
              maxlength="3"
            >
          </div>
        </div>
        <div class="field">
          <label for="gig-extras">Fee extras (one per line)</label>
          <textarea
            id="gig-extras"
            class="input"
            bind:value={extraText}
            placeholder="Dinner&#10;Two drinks each"
          ></textarea>
        </div>
      </div>
    </details>

    <details>
      <summary>
        <strong>Public page</strong> <span>ticket link, description</span>
        <Tag kind="public">Public</Tag>
        <Icon name="chevron-down" />
      </summary>
      <div class="form inner">
        <p class="field-hint first">
          Shown on your public page once the gig is confirmed.
        </p>
        <div class="field">
          <label for="gig-ticket">Ticket URL</label>
          <input
            id="gig-ticket"
            class="input"
            type="url"
            pattern="https?://.*"
            bind:value={ticketUrl}
          >
        </div>
        <div class="field">
          <label for="gig-description">Public description</label>
          <textarea
            id="gig-description"
            class="input"
            bind:value={description}
          ></textarea>
        </div>
      </div>
    </details>

    <details>
      <summary>
        <strong>Message and notes</strong>
        <span>enquiry text, your notes</span>
        <Tag kind="private">Private</Tag>
        <Icon name="chevron-down" />
      </summary>
      <div class="form inner">
        <div class="field">
          <label for="gig-message">Message text</label>
          <textarea
            id="gig-message"
            class="input"
            bind:value={draft.enquiryText}
            placeholder="Paste the message"
          ></textarea>
        </div>
        <div class="field">
          <label for="gig-notes">Notes</label>
          <textarea
            id="gig-notes"
            class="input"
            bind:value={draft.notes}
          ></textarea>
        </div>
      </div>
    </details>
  </fieldset>

  <div class="spacer"></div>
  {#if error}
    <p class="notice error" role="alert">{error}</p>
  {/if}
  <BottomActionBar>
    <button type="submit" class="btn btn-primary btn-wide" disabled={saving}>
      {saving
        ? "Saving…"
        : isEdit
          ? "Save gig"
          : pendingContacts.length && fromMessage
            ? "Save contact and gig"
            : "Save gig"}
      <Icon name="arrow-right" stroke={2.5} />
    </button>
    <button
      type="button"
      class="btn btn-secondary"
      disabled={saving}
      onclick={oncancel}
    >
      Cancel
    </button>
  </BottomActionBar>
</form>

<style>
.gig-form {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.head {
  position: relative;
  padding-right: 72px;
}
.head .visibility-note {
  margin-top: 8px;
}
.close {
  position: absolute;
  top: 18px;
  right: 20px;
}
.block {
  padding: 20px 28px;
  border-bottom: var(--rule);
}
.quote-block {
  margin: 16px 28px 0;
  padding: 14px 16px;
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
}
.quote-block p {
  margin: 0;
}
.quote-block .quote {
  margin-top: 6px;
  font-size: 14px;
  max-height: 8.5em;
  overflow: auto;
}
details {
  margin: 12px 28px 0;
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}
details[open] {
  box-shadow: var(--shadow-sm);
}
summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 10px 16px;
  cursor: pointer;
  list-style: none;
  font-size: 14px;
}
summary strong {
  font-weight: 600;
}
summary::-webkit-details-marker {
  display: none;
}
summary > span {
  font-size: 13px;
  color: var(--muted);
}
summary > :global(svg) {
  margin-left: auto;
  color: var(--faint);
  transition: transform 150ms ease;
}
details[open] summary > :global(svg) {
  transform: rotate(180deg);
}
summary :global(.tag) {
  margin-left: auto;
}
summary :global(.tag) + :global(svg) {
  margin-left: 0;
}
.inner {
  padding: 4px 16px 18px;
}
.first {
  margin-top: 0;
}
.nested {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
}
.nested-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  float: left;
  font-size: 14px;
}
.picked {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}
.picked > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  min-width: 0;
}
.picked strong {
  font-size: 15px;
  font-weight: 600;
}
.picked.new {
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  background: var(--color-surface-2);
}
.picked > .picked-head {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}
.reason {
  align-self: flex-start;
  display: inline-flex;
  gap: 4px;
  align-items: center;
  margin-top: 4px;
  padding: 2px 8px;
  font-size: 12px;
  border-radius: var(--radius-pill);
  background: var(--tone-confirmed-bg);
  color: var(--tone-confirmed-fg);
}
.link {
  align-self: flex-start;
  padding-inline: 0;
}
.suggest {
  margin-top: 8px;
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--color-surface);
}
.suggest button {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 48px;
  padding: 8px 12px;
  border: 0;
  border-bottom: var(--rule);
  background: transparent;
  text-align: left;
  font-size: 14px;
}
.suggest li:last-child button {
  border-bottom: 0;
}
.suggest button:hover {
  background: var(--hover-bg);
}
.suggest .create {
  color: var(--color-accent-700);
  font-weight: 600;
  justify-content: flex-start;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chips li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px 3px 10px;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-pill);
  background: var(--color-accent-100);
  color: var(--color-accent-700);
}
.chips li.new {
  background: var(--tone-offered-bg);
  color: var(--tone-offered-fg);
}
.chip-remove {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
}
.chip-remove:hover {
  background: rgb(0 0 0 / 0.06);
}
.row-actions {
  display: flex;
  gap: 8px;
}
.spacer {
  flex: 1;
  min-height: 24px;
}
@media (max-width: 899px) {
  .head {
    padding: 12px var(--pad);
  }
  .head .kicker,
  .head h2 {
    display: none;
  }
  .head .visibility-note {
    margin-top: 0;
  }
  .close {
    display: none;
  }
  .block {
    padding-inline: var(--pad);
  }
  .quote-block,
  details {
    margin-inline: var(--pad);
  }
}
</style>
