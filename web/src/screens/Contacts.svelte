<script lang="ts">
import type { Contact } from "@showday/schemas";
import { untrack } from "svelte";
import BottomActionBar from "../components/BottomActionBar.svelte";
import ChannelGrid from "../components/ChannelGrid.svelte";
import DetailSection from "../components/DetailSection.svelte";
import Icon from "../components/Icon.svelte";
import ListDetailLayout from "../components/ListDetailLayout.svelte";
import PhoneHeader from "../components/PhoneHeader.svelte";
import SectionLabel from "../components/SectionLabel.svelte";
import Segmented from "../components/Segmented.svelte";
import Tag from "../components/Tag.svelte";
import type { BandData } from "../lib/data.svelte";
import {
  capitalize,
  dayNumber,
  mediumDate,
  monthShort,
  normalize,
  plural,
  today,
} from "../lib/format";
import { path, router } from "../lib/router.svelte";
import { run, ui } from "../lib/ui.svelte";
import { bands } from "../storage";

let { data }: { data: BandData } = $props();
let filter = $state<"all" | "venues" | "bands" | "none">("all");
let query = $state("");
const now = today();

/** Venues and bands a contact works with, derived from gigs and other-band records. */
const rows = $derived(
  data.contacts.map((contact) => {
    const gigs = data.gigs
      .filter((g) => g.contactIds?.includes(contact.id))
      .sort((a, b) => b.date.localeCompare(a.date));
    const venues = [
      ...new Map(
        gigs
          .map((g) => data.venues.find((v) => v.id === g.venueId))
          .filter((v) => !!v)
          .map((v) => [v.id, v]),
      ).values(),
    ];
    const others = data.otherBands.filter((b) =>
      b.contactIds.includes(contact.id),
    );
    return {
      contact,
      gigs,
      venues,
      others,
      last: gigs.find((g) => g.date <= now)?.date,
    };
  }),
);
const shown = $derived(
  rows
    .filter((r) =>
      filter === "venues"
        ? r.venues.length > 0
        : filter === "bands"
          ? r.others.length > 0
          : filter === "none"
            ? !r.gigs.length
            : true,
    )
    .filter(
      (r) =>
        !query ||
        normalize(
          [
            r.contact.name,
            r.contact.email,
            r.contact.phone,
            r.contact.messenger,
            r.contact.instagram,
            ...r.venues.map((v) => v.name),
            ...r.others.map((b) => b.name),
          ].join(" "),
        ).includes(normalize(query)),
    ),
);
const idle = $derived(rows.filter((r) => !r.gigs.length).length);
const id = $derived(router.parts[0] ?? "");
const mode = $derived(router.parts[1] ?? "");
const selected = $derived(rows.find((r) => r.contact.id === id));
const editing = $derived(id === "new" || mode === "edit");
const linkedTo = (r: (typeof rows)[number]) =>
  r.venues[0]?.name ?? (r.others[0] ? `${r.others[0].name} (band)` : "");

function channels(contact: Contact) {
  const ig = contact.instagram?.replace(/^@/, "");
  return [
    {
      label: "Email",
      short: "Mail",
      verb: "Write",
      value: contact.email,
      href: contact.email && `mailto:${contact.email}`,
    },
    {
      label: "Phone",
      short: "Tel",
      verb: "Call",
      value: contact.phone,
      href: contact.phone && `tel:${contact.phone.replace(/\s/g, "")}`,
    },
    {
      label: "Messenger",
      short: "Msgr",
      verb: "Message",
      value: contact.messenger,
      href:
        contact.messenger && !/^\d+$/.test(contact.messenger)
          ? `https://m.me/${encodeURIComponent(contact.messenger)}`
          : undefined,
    },
    {
      label: "Instagram",
      short: "IG",
      verb: "DM",
      value: ig && `@${ig}`,
      href: ig && `https://ig.me/m/${encodeURIComponent(ig)}`,
    },
  ];
}

let draft = $state<Contact>({ id: "", name: "" });
// Start the draft when the form opens; later syncs don't overwrite what's being typed.
$effect(() => {
  // Track the route's record id so switching straight from editing one
  // contact to "New contact" (or to another contact) starts a fresh draft
  // instead of keeping the previous one, which would overwrite it on save.
  void id;
  if (editing)
    draft = untrack(() =>
      structuredClone(
        $state.snapshot(selected?.contact) ?? { id: "", name: "" },
      ),
    );
});
async function save(event: SubmitEvent) {
  event.preventDefault();
  // Keep the generated id on the draft, not just the saved value, so a
  // retry after a save that succeeded but failed to reload reuses it
  // instead of creating a duplicate contact.
  draft.id ||= crypto.randomUUID();
  const value: Contact = {
    ...$state.snapshot(draft),
    name: draft.name.trim(),
  };
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
  if (await run(() => bands.save("contact", data.band.id, value)))
    router.go(path("contacts", value.id), { replace: true });
}
async function remove(contact: Contact) {
  if (!confirm(`Remove ${contact.name} from your contacts?`)) return;
  if (await run(() => bands.removeContact(data.band.id, contact.id)))
    router.go("contacts", { replace: true });
}
</script>

<ListDetailLayout fill open={!!id} key={router.parts.join("/")}>
  {#snippet list()}
    <div class="pane">
      <div class="page-head">
        <div>
          <h1>Contacts</h1>
          <p>
            {plural(rows.length, "person", "people")}{idle
              ? ` · ${idle} without gigs yet`
              : ""}
          </p>
          <p class="visibility-note">
            <Icon name="lock" size={13} />Private. Contacts are only for you and
            never published.
          </p>
        </div>
        <Segmented
          label="Show"
          options={[
            { value: "all", label: "All" },
            { value: "venues", label: "Venues" },
            { value: "bands", label: "Other bands" },
            { value: "none", label: "No gigs yet" },
          ]}
          bind:value={filter}
        />
      </div>
      <div class="search-row">
        <label class="sr-only" for="contact-search">Search contacts</label>
        <input
          id="contact-search"
          class="input"
          type="search"
          placeholder="Search by name, email, handle or venue"
          bind:value={query}
        >
      </div>
      {#if ui.phone}
        <a class="other-bands" href="#/bands"
          >Other bands you share a bill with <Icon name="chevron-right" /></a
        >
      {/if}
      <div class="table-head" aria-hidden="true">
        <span>Name</span><span>Reach on</span><span>Gigs</span
        ><span>Last gig</span>
      </div>
      <ul>
        {#each shown as row (row.contact.id)}
          <li>
            <a
              class="row list-row"
              class:selected={row.contact.id === id}
              aria-current={row.contact.id === id ? "true" : undefined}
              href={`#/${path("contacts", row.contact.id)}`}
            >
              <span class="what">
                <strong>{row.contact.name}</strong>
                {#if linkedTo(row)}
                  <span class="sub ellipsis">{linkedTo(row)}</span>
                {/if}
              </span>
              <span class="reach"
                ><ChannelGrid channels={channels(row.contact)} /></span
              >
              <span class="count">{row.gigs.length}</span>
              <span class="last"
                >{row.last
                  ? `${dayNumber(row.last)} ${monthShort(row.last)}`
                  : "—"}</span
              >
            </a>
          </li>
        {:else}
          <li class="empty">
            {rows.length
              ? "No contacts match."
              : "No contacts yet. People you add to enquiries appear here."}
          </li>
        {/each}
      </ul>
    </div>
  {/snippet}
  {#snippet detail()}
    {#if editing}
      <PhoneHeader
        title={id === "new" ? "New contact" : "Edit contact"}
        onclose={() => router.back("contacts")}
      />
      <form class="edit" onsubmit={save}>
        <div class="detail-head">
          <p class="kicker">Contact</p>
          <h2>{id === "new" ? "New contact" : "Edit contact"}</h2>
        </div>
        <fieldset class="form block" disabled={ui.busy}>
          <div class="field">
            <label for="contact-name">Name</label>
            <input
              id="contact-name"
              class="input"
              required
              bind:value={draft.name}
            >
          </div>
          <div class="field-row">
            <div class="field">
              <label for="contact-email">Email</label>
              <input
                id="contact-email"
                class="input"
                type="email"
                bind:value={draft.email}
              >
            </div>
            <div class="field">
              <label for="contact-phone">Phone</label>
              <input
                id="contact-phone"
                class="input"
                type="tel"
                bind:value={draft.phone}
              >
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="contact-messenger">Messenger</label>
              <input
                id="contact-messenger"
                class="input"
                bind:value={draft.messenger}
              >
            </div>
            <div class="field">
              <label for="contact-instagram">Instagram</label>
              <input
                id="contact-instagram"
                class="input"
                bind:value={draft.instagram}
              >
            </div>
          </div>
          <div class="field">
            <label for="contact-notes">Notes</label>
            <textarea
              id="contact-notes"
              class="input"
              bind:value={draft.notes}
            ></textarea>
          </div>
        </fieldset>
        <div class="spacer"></div>
        <BottomActionBar>
          <button
            type="submit"
            class="btn btn-primary btn-wide"
            disabled={ui.busy}
          >
            Save contact <Icon name="arrow-right" stroke={2.5} />
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            onclick={() => router.back("contacts")}
          >
            Cancel
          </button>
          {#snippet end()}
            {#if selected}
              {@const linked =
                selected.gigs.length > 0 || selected.others.length > 0}
              <button
                type="button"
                class="btn btn-ghost btn-danger"
                disabled={ui.busy || linked}
                title={linked
                  ? "Linked to gigs or bands. Remove those links first."
                  : undefined}
                onclick={() => selected && remove(selected.contact)}
              >
                Remove contact
              </button>
            {/if}
          {/snippet}
        </BottomActionBar>
      </form>
    {:else if selected}
      {@const { contact, gigs, venues, others } = selected}
      {@const linked = gigs.length > 0 || others.length > 0}
      <PhoneHeader back={() => router.back("contacts")} backLabel="Contacts">
        {#snippet action()}
          <a
            class="btn btn-ghost"
            href={`#/${path("contacts", contact.id, "edit")}`}
            >Edit</a
          >
        {/snippet}
      </PhoneHeader>
      <div class="detail-head">
        <p class="kicker">
          Contact{linkedTo(selected) ? ` · ${linkedTo(selected)}` : ""}
        </p>
        <h2>{contact.name}</h2>
        <p class="visibility-note">
          <Icon name="lock" size={13} />Private. Never published.
        </p>
      </div>
      <div class="scroll">
        <ChannelGrid
          size="large"
          channels={channels(contact)}
          onadd={() => router.go(path("contacts", contact.id, "edit"))}
        />
        {#if venues.length || others.length}
          <DetailSection label="Works with">
            <span class="tags">
              {#each venues as venue (venue.id)}
                <a href={`#/${path("venues", venue.id)}`}
                  ><Tag>{venue.name}</Tag></a
                >
              {/each}
              {#each others as band (band.id)}
                <a href={`#/${path("bands", band.id)}`}
                  ><Tag>{band.name} (band)</Tag></a
                >
              {/each}
            </span>
          </DetailSection>
        {/if}
        {#if contact.notes?.trim()}
          <DetailSection label="Notes">
            <span class="pre">{contact.notes}</span>
          </DetailSection>
        {/if}
        <SectionLabel>Gigs · {gigs.length}</SectionLabel>
        <ul>
          {#each gigs as gig (gig.id)}
            <li>
              <a
                class="gig"
                href={`#/${path("bookings", "gig", data.band.id, gig.id)}`}
              >
                <strong>{mediumDate(gig.date)}</strong>
                <span class="what">
                  <strong class="ellipsis">{gig.title}</strong>
                  <span class="sub"
                    >{data.venues.find((v) => v.id === gig.venueId)?.name ??
                      gig.venue ??
                      ""}</span
                  >
                </span>
                <Tag kind={gig.status}>{capitalize(gig.status)}</Tag>
              </a>
            </li>
          {:else}
            <li class="empty">Not on a gig yet.</li>
          {/each}
        </ul>
      </div>
      <BottomActionBar>
        <a
          class="btn btn-primary btn-wide"
          href={`#/bookings/new?contact=${encodeURIComponent(contact.id)}`}
          >New gig with {contact.name.split(/\s+/)[0]}
          <Icon name="arrow-right" stroke={2.5} /></a
        >
        {#if !ui.phone}
          <a
            class="btn btn-secondary"
            href={`#/${path("contacts", contact.id, "edit")}`}
            >Edit</a
          >
        {/if}
      </BottomActionBar>
    {:else if id}
      <p class="empty">This contact isn't here any more.</p>
    {:else}
      <p class="empty">
        Choose a person to see how to reach them and what they've booked.
      </p>
    {/if}
  {/snippet}
</ListDetailLayout>

<style>
.pane {
  padding-bottom: 32px;
}
.page-head p + p {
  margin-top: 6px;
}
.search-row {
  display: flex;
  gap: 8px;
  padding: 0 var(--pad) 12px;
}
.other-bands {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0 var(--pad) 8px;
  padding: 12px 14px;
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  border: 1px solid var(--color-divider);
  color: inherit;
  font-weight: 500;
  text-decoration: none;
}
.table-head,
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 130px 48px 72px;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
}
.table-head {
  margin: 0 12px;
  padding-block: 8px;
  border-bottom: var(--rule);
}
.table-head span:nth-child(n + 3),
.count,
.last {
  text-align: right;
}
ul {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 6px;
}
.row {
  min-height: 60px;
  color: inherit;
  text-decoration: none;
}
.row:hover {
  background: var(--hover-bg);
}
.selected,
.selected:hover {
  background: var(--select-bg);
}
.what {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.what strong {
  font-size: 14px;
  font-weight: 600;
}
.sub {
  font-size: 13px;
  color: var(--muted);
}
.count {
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.last {
  font-size: 13px;
  color: var(--muted);
}
.scroll {
  flex: 1;
}
.detail-head .visibility-note {
  margin-top: 8px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tags a {
  text-decoration: none;
}
.gig {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  margin: 0 16px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  color: inherit;
  text-decoration: none;
  font-size: 13px;
}
.gig > strong {
  font-weight: 500;
  color: var(--muted);
}
.gig:hover {
  background: var(--hover-bg);
}
.block {
  padding: 18px 28px;
}
.edit {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.spacer {
  flex: 1;
}
@media (max-width: 1199px) {
  .table-head,
  .row {
    grid-template-columns: minmax(0, 1fr) 130px 40px;
  }
  .table-head span:last-child,
  .last {
    display: none;
  }
}
@media (max-width: 899px) {
  .pane {
    padding-bottom: calc(var(--tabbar) + 16px);
  }
  .table-head {
    display: none;
  }
  .row {
    grid-template-columns: minmax(0, 1fr) auto;
    margin: 0 4px;
  }
  .count {
    display: none;
  }
  .gig {
    grid-template-columns: 84px minmax(0, 1fr) auto;
    gap: 8px;
    margin: 0 4px;
  }
  .block {
    padding-inline: 16px;
  }
}
</style>
