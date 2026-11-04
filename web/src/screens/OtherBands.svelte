<script lang="ts">
import type { OtherBand } from "@gigger/schemas";
import { untrack } from "svelte";
import BottomActionBar from "../components/BottomActionBar.svelte";
import DetailSection from "../components/DetailSection.svelte";
import Icon from "../components/Icon.svelte";
import ListDetailLayout from "../components/ListDetailLayout.svelte";
import PhoneHeader from "../components/PhoneHeader.svelte";
import SectionLabel from "../components/SectionLabel.svelte";
import Tag from "../components/Tag.svelte";
import Typeahead, { rank } from "../components/Typeahead.svelte";
import type { BandData } from "../lib/data.svelte";
import { capitalize, mediumDate, normalize, plural } from "../lib/format";
import { path, router } from "../lib/router.svelte";
import { run, ui } from "../lib/ui.svelte";
import { bands } from "../storage";

let { data }: { data: BandData } = $props();
let query = $state("");
const rows = $derived(
  data.otherBands.map((band) => ({
    band,
    gigs: data.gigs
      .filter((g) => g.otherBandIds?.includes(band.id))
      .sort((a, b) => b.date.localeCompare(a.date)),
  })),
);
const shown = $derived(
  rows.filter(
    (r) => !query || normalize(r.band.name).includes(normalize(query)),
  ),
);
const id = $derived(router.parts[0] ?? "");
const mode = $derived(router.parts[1] ?? "");
const selected = $derived(rows.find((r) => r.band.id === id));
const editing = $derived(id === "new" || mode === "edit");
const contactName = (contactId: string) =>
  data.contacts.find((c) => c.id === contactId)?.name ?? contactId;

let draft = $state<OtherBand>({ id: "", name: "", contactIds: [] });
let contactQuery = $state("");
const options = $derived(
  rank(
    data.contacts.filter((c) => !draft.contactIds.includes(c.id)),
    contactQuery,
    (c) => c.name,
    (c) => [c.email, c.phone, c.messenger, c.instagram].join(" "),
  ).map((c) => ({ id: c.id, label: c.name, sub: c.email ?? c.phone })),
);
$effect(() => {
  // Track the route's record id so switching straight from editing one band
  // to "New band" (or to another band) starts a fresh draft instead of
  // keeping the previous one, which would overwrite it on save.
  void id;
  if (editing)
    draft = untrack(() =>
      structuredClone(
        $state.snapshot(selected?.band) ?? { id: "", name: "", contactIds: [] },
      ),
    );
});
async function save(event: SubmitEvent) {
  event.preventDefault();
  // Keep the generated id on the draft, not just the saved value, so a
  // retry after a save that succeeded but failed to reload reuses it
  // instead of creating a duplicate band.
  draft.id ||= crypto.randomUUID();
  const value = {
    ...$state.snapshot(draft),
    name: draft.name.trim(),
  };
  if (await run(() => bands.save("otherBand", data.band.id, value)))
    router.go(path("bands", value.id), { replace: true });
}
</script>

<ListDetailLayout open={!!id} key={router.parts.join("/")}>
  {#snippet list()}
    <div class="pane">
      <div class="page-head">
        <div>
          <h1>Other bands</h1>
          <p>{plural(rows.length, "band")} you share a bill with</p>
        </div>
        {#if ui.phone}
          <a class="btn btn-secondary" href="#/bands/new"
            ><Icon name="plus" />
            New band</a
          >
        {/if}
      </div>
      <div class="search-row">
        <label class="sr-only" for="band-search">Search bands</label>
        <input
          id="band-search"
          class="input"
          type="search"
          placeholder="Search bands"
          bind:value={query}
        >
      </div>
      <ul>
        {#each shown as row (row.band.id)}
          <li>
            <a
              class="row"
              class:selected={row.band.id === id}
              aria-current={row.band.id === id ? "true" : undefined}
              href={`#/${path("bands", row.band.id)}`}
            >
              <span class="what">
                <strong>{row.band.name}</strong>
                <span class="sub ellipsis">
                  {row.band.contactIds.map(contactName).join(", ") ||
                    "No contacts yet"}
                </span>
              </span>
              <span class="count">{plural(row.gigs.length, "gig")}</span>
            </a>
          </li>
        {:else}
          <li class="empty">
            {rows.length
              ? "No bands match."
              : "No other bands yet. Add them in a gig's Who section."}
          </li>
        {/each}
      </ul>
    </div>
  {/snippet}
  {#snippet detail()}
    {#if editing}
      <PhoneHeader
        title={id === "new" ? "New band" : "Edit band"}
        onclose={() => router.back("bands")}
      />
      <form class="edit" onsubmit={save}>
        <div class="detail-head">
          <p class="kicker">Other band</p>
          <h2>{id === "new" ? "New band" : "Edit band"}</h2>
        </div>
        <fieldset class="form block" disabled={ui.busy}>
          <div class="field">
            <label for="other-name">Band name</label>
            <input
              id="other-name"
              class="input"
              required
              bind:value={draft.name}
            >
          </div>
          <div class="field">
            <span class="field-label">Contacts in this band</span>
            {#if draft.contactIds.length}
              <ul class="chips" aria-label="Contacts in this band">
                {#each draft.contactIds as contactId (contactId)}
                  <li>
                    {contactName(contactId)}
                    <button
                      type="button"
                      class="chip-remove"
                      aria-label={`Remove ${contactName(contactId)}`}
                      onclick={() => {
                        draft.contactIds = draft.contactIds.filter(
                          (c) => c !== contactId,
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
            label="Add a contact"
            bind:query={contactQuery}
            {options}
            placeholder={`Search ${data.contacts.length} contacts`}
            onselect={(contactId) => {
              draft.contactIds = [...draft.contactIds, contactId];
              contactQuery = "";
            }}
            hint="New people are added from the Contacts screen."
          />
          <div class="field">
            <label for="other-notes">Private notes</label>
            <textarea
              id="other-notes"
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
            Save band <Icon name="arrow-right" stroke={2.5} />
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            onclick={() => router.back("bands")}
          >
            Cancel
          </button>
        </BottomActionBar>
      </form>
    {:else if selected}
      {@const { band, gigs } = selected}
      <PhoneHeader back={() => router.back("bands")} backLabel="Other bands">
        {#snippet action()}
          <a class="btn btn-ghost" href={`#/${path("bands", band.id, "edit")}`}
            >Edit</a
          >
        {/snippet}
      </PhoneHeader>
      <div class="detail-head">
        <p class="kicker">Other band</p>
        <h2>{band.name}</h2>
      </div>
      <div class="scroll">
        <DetailSection label="Contacts">
          {#each band.contactIds as contactId (contactId)}
            {@const contact = data.contacts.find((c) => c.id === contactId)}
            {#if contact}
              <a class="main plain" href={`#/${path("contacts", contact.id)}`}
                >{contact.name}</a
              >
              <span class="line"
                >{[
                  contact.email,
                  contact.phone,
                  contact.messenger,
                  contact.instagram,
                ]
                  .filter(Boolean)
                  .join(" · ")}</span
              >
            {:else}
              <span class="main">{contactId}</span>
            {/if}
          {:else}
            <span class="muted">No contacts linked yet.</span>
          {/each}
        </DetailSection>
        {#if band.notes?.trim()}
          <DetailSection label="Notes"
            ><span class="pre">{band.notes}</span></DetailSection
          >
        {/if}
        <SectionLabel>Gigs together · {gigs.length}</SectionLabel>
        <ul>
          {#each gigs as gig (gig.id)}
            <li>
              <a
                class="gig"
                href={`#/${path("bookings", "gig", data.band.id, gig.id)}`}
              >
                <strong>{mediumDate(gig.date)}</strong>
                <span class="ellipsis">{gig.title}</span>
                <Tag kind={gig.status}>{capitalize(gig.status)}</Tag>
              </a>
            </li>
          {:else}
            <li class="empty">No gigs together yet.</li>
          {/each}
        </ul>
      </div>
      <BottomActionBar>
        <a
          class="btn btn-secondary"
          href={`#/${path("bands", band.id, "edit")}`}
          >Edit</a
        >
      </BottomActionBar>
    {:else if id}
      <p class="empty">This band isn't here any more.</p>
    {:else}
      <p class="empty">
        Choose a band to see its contacts and the gigs you've shared.
      </p>
    {/if}
  {/snippet}
</ListDetailLayout>

<style>
.pane {
  padding-bottom: 32px;
}
.search-row {
  padding: 12px 24px;
  border-bottom: var(--rule-2);
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-height: 64px;
  padding: 10px 24px;
  border-bottom: var(--rule);
  color: inherit;
  text-decoration: none;
}
.row:hover {
  background: var(--select-bg);
}
.selected {
  background: var(--select-bg);
  box-shadow: var(--select-mark);
}
.what {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.what strong {
  font-size: 15px;
  font-weight: 800;
}
.sub,
.count {
  font-size: 13px;
}
.scroll {
  flex: 1;
}
.plain {
  color: inherit;
  text-decoration: none;
}
.plain:hover {
  color: var(--color-accent-700);
}
.gig {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 12px 28px;
  border-bottom: var(--rule);
  color: inherit;
  text-decoration: none;
  font-size: 14px;
}
.gig:hover {
  background: var(--select-bg);
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
  padding: 4px 4px 4px 10px;
  font-size: 13px;
  font-weight: 600;
  background: var(--color-text);
  color: var(--color-bg);
}
.chip-remove {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  background: transparent;
  color: inherit;
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
@media (max-width: 899px) {
  .pane {
    padding-bottom: calc(var(--tabbar) + 16px);
  }
  .search-row,
  .row,
  .gig,
  .block {
    padding-inline: 16px;
  }
  .gig {
    grid-template-columns: 90px minmax(0, 1fr) auto;
    gap: 8px;
  }
}
</style>
