<script lang="ts">
import type { Gig, GigStatus } from "@showday/schemas";
import { availabilitySummary } from "../components/AvailabilityCells.svelte";
import Icon from "../components/Icon.svelte";
import LedgerRow from "../components/LedgerRow.svelte";
import ListDetailLayout from "../components/ListDetailLayout.svelte";
import SectionLabel from "../components/SectionLabel.svelte";
import Segmented from "../components/Segmented.svelte";
import Tag from "../components/Tag.svelte";
import { type BandData, data } from "../lib/data.svelte";
import {
  capitalize,
  daysUntil,
  monthLabel,
  normalize,
  shortDate,
  today,
  usedCurrencies,
} from "../lib/format";
import {
  amountText,
  contactsOf,
  isUpcoming,
  nextGig,
  timeCells,
  venueLine,
  venueName,
} from "../lib/gigs";
import { inboxItems } from "../lib/inbox";
import { prefillFrom, threads } from "../lib/messages.svelte";
import { path, router } from "../lib/router.svelte";
import { run, ui } from "../lib/ui.svelte";
import { bands } from "../storage";
import GigDetail from "./GigDetail.svelte";
import GigForm from "./GigForm.svelte";
import GigSheet from "./GigSheet.svelte";
import PlayedForm from "./PlayedForm.svelte";

let view = $state<"list" | "board">(
  localStorage.getItem("showday:view") === "board" ? "board" : "list",
);
// Upcoming first; played, cancelled and past-dated gigs are under Past.
let filter = $state<"upcoming" | "past">("upcoming");
let query = $state("");
const now = today();
const many = $derived(data.all.length > 1 && !data.current);

const rows = $derived(
  data.inView.flatMap((band) => band.gigs.map((gig) => ({ gig, band }))),
);
const bandOf = (bandId: string) => data.band(bandId);
const needle = $derived(normalize(query));
function gigMatches(gig: Gig, band: BandData) {
  if (!needle) return true;
  return normalize(
    [
      gig.title,
      venueLine(gig, band.venues),
      ...contactsOf(gig, band.contacts).map((c) => c.name),
      gig.enquiryText ?? "",
      band.band.name,
    ].join(" "),
  ).includes(needle);
}
const visibleGigs = $derived(
  rows
    .filter(({ gig }) => isUpcoming(gig, now) === (filter === "upcoming"))
    .filter(({ gig, band }) => gigMatches(gig, band))
    .sort((a, b) =>
      filter === "past"
        ? b.gig.date.localeCompare(a.gig.date)
        : a.gig.date.localeCompare(b.gig.date) ||
          a.gig.title.localeCompare(b.gig.title),
    ),
);
const months = $derived.by(() => {
  const groups: { key: string; label: string; rows: typeof visibleGigs }[] = [];
  for (const row of visibleGigs) {
    const key = row.gig.date.slice(0, 7);
    let group = groups.at(-1);
    if (group?.key !== key) {
      group = { key, label: monthLabel(row.gig.date) || "No date", rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
});
const next = $derived(nextGig(data.inView, now));
const statuses: GigStatus[] = [
  "enquiry",
  "offered",
  "confirmed",
  "played",
  "cancelled",
];
const columns = $derived(
  statuses.map((status) => ({
    status,
    rows: rows
      .filter(({ gig, band }) => gig.status === status && gigMatches(gig, band))
      .sort((a, b) =>
        status === "played" || status === "cancelled"
          ? b.gig.date.localeCompare(a.gig.date)
          : a.gig.date.localeCompare(b.gig.date),
      ),
  })),
);

// Route: gig/<band>/<gig>[/edit|/played], message/<id>, new
const kind = $derived(router.parts[0] ?? "");
const openGig = $derived.by(() => {
  if (kind !== "gig") return undefined;
  const band = bandOf(router.parts[1]);
  const gig = band?.gigs.find((g) => g.id === router.parts[2]);
  return band && gig ? { band, gig, mode: router.parts[3] ?? "" } : undefined;
});
const from = $derived(router.query.get("from") ?? "");
const fromItem = $derived(
  from
    ? inboxItems(
        data.conversations,
        data.all.map((b) => b.band.id),
        data.all.flatMap((b) => b.gigs),
        data.all.flatMap((b) => b.triage),
      ).find((i) => i.id === from)
    : undefined,
);
const newBand = $derived(
  kind !== "new"
    ? undefined
    : fromItem
      ? bandOf(fromItem.conversation.bandId)
      : (data.current ?? (data.all.length === 1 ? data.all[0] : undefined)),
);
const open = $derived(!!kind);
const selectedGig = $derived(openGig?.gig.id ?? "");

// A new enquiry from a message needs the message text before the form starts.
let fromLoaded = $state("");
$effect(() => {
  const id = fromItem?.id;
  if (!id || fromLoaded === id) return;
  threads
    .load(id)
    .catch(() => {})
    .finally(() => {
      fromLoaded = id;
    });
});

const gigHref = (bandId: string, gigId: string) =>
  `#/${path("bookings", "gig", bandId, gigId)}`;
function sub(gig: Gig, band: BandData) {
  return [venueLine(gig, band.venues), many ? band.band.name : ""]
    .filter(Boolean)
    .join(" · ");
}
</script>

{#snippet controls()}
  <div class="list-head">
    {#if !ui.phone}
      <Segmented
        label="View"
        options={[
          { value: "list", label: "List" },
          { value: "board", label: "Board" },
        ]}
        bind:value={view}
        onchange={(v) => localStorage.setItem("showday:view", v)}
      />
    {/if}
    <label class="search">
      <span class="sr-only">Search</span>
      <Icon name="search" />
      <input
        class="input"
        type="search"
        placeholder={ui.phone ? "Search gigs" : "Search gigs, venues, people"}
        bind:value={query}
      >
    </label>
    {#if view === "list" || ui.phone}
      <Segmented
        label="Show"
        options={[
          { value: "upcoming", label: "Upcoming" },
          { value: "past", label: "Past" },
        ]}
        bind:value={filter}
      />
    {/if}
  </div>
{/snippet}

{#snippet nextBlock()}
  {#if next}
    {@const summary = availabilitySummary(next.gig, next.data.members)}
    <a class="next" href={gigHref(next.data.band.id, next.gig.id)}>
      <span class="next-head">
        <span
          >Next gig ·
          {daysUntil(next.gig.date) === 0
            ? "today"
            : `in ${daysUntil(next.gig.date)} ${daysUntil(next.gig.date) === 1 ? "day" : "days"}`}</span
        >
        {#if next.data.members.length}
          <span>{summary.short}</span>
        {/if}
      </span>
      <span class="next-date">{shortDate(next.gig.date)}</span>
      <span class="next-title"
        >{next.gig.title}
        {#if venueName(next.gig, next.data.venues)}
          · {venueName(next.gig, next.data.venues)}
        {/if}</span
      >
      {#if timeCells(next.gig).length}
        <span class="next-times">
          {#each timeCells(next.gig) as cell (cell.label)}
            <span class="next-time"
              ><span>{cell.label}</span><strong>{cell.value}</strong></span
            >
          {/each}
        </span>
      {/if}
    </a>
  {/if}
{/snippet}

{#snippet ledger()}
  {#if many && !data.all.length}
    <p class="empty">Create your first band to get started.</p>
  {/if}
  {#each months as month (month.key)}
    <section aria-label={month.label}>
      <SectionLabel>{month.label}</SectionLabel>
      <ul>
        {#each month.rows as { gig, band } (`${band.band.id}/${gig.id}`)}
          {@const summary = availabilitySummary(gig, band.members)}
          <LedgerRow
            href={gigHref(band.band.id, gig.id)}
            date={gig.date}
            title={gig.title}
            sub={sub(gig, band)}
            status={gig.status}
            availability={band.members.length && gig.status !== "cancelled"
              ? summary.short
              : ""}
            availabilityAlert={summary.alert && gig.status !== "played"}
            amount={amountText(gig, band.band.currency ?? "EUR")}
            selected={gig.id === selectedGig}
          />
        {/each}
      </ul>
    </section>
  {:else}
    <p class="empty">
      {query
        ? "No gigs match that search."
        : filter === "upcoming"
          ? "No upcoming gigs. Enquiries you add show up here."
          : "No past gigs yet. Played and cancelled gigs move here."}
    </p>
  {/each}
{/snippet}

{#snippet board()}
  <div class="board">
    {#each columns as column (column.status)}
      <section class="column" aria-label={capitalize(column.status)}>
        <h3 class="column-head">
          <Tag kind={column.status}>{capitalize(column.status)}</Tag
          ><span class="count">{column.rows.length}</span>
        </h3>
        <ul>
          {#each column.rows as { gig, band } (`${band.band.id}/${gig.id}`)}
            {@const hot = next?.gig.id === gig.id}
            <li>
              <a
                class="card"
                class:hot
                class:selected={gig.id === selectedGig}
                href={gigHref(band.band.id, gig.id)}
              >
                <span class="card-top">
                  <span>{shortDate(gig.date)}</span>
                  <span class="card-kick">
                    {hot
                      ? "Next up"
                      : gig.status === "enquiry"
                        ? (gig.enquirySource ?? "")
                        : gig.status === "cancelled"
                          ? "Cancelled"
                          : ""}
                  </span>
                </span>
                <span class="card-title">{gig.title}</span>
                <span class="card-sub">{sub(gig, band)}</span>
                <span class="card-money">
                  <span
                    >{gig.status === "played" && gig.earnings
                      ? "Took home"
                      : "Fee"}</span
                  >
                  <strong
                    >{amountText(gig, band.band.currency ?? "EUR") ||
                      "—"}</strong
                  >
                </span>
              </a>
            </li>
          {:else}
            <li class="empty">None</li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{/snippet}

<ListDetailLayout fill {open} key={router.parts.join("/")}>
  {#snippet list()}
    <div class="list">
      {#if !ui.phone}
        {@render controls()}
      {/if}
      {#if ui.phone}
        {#if !query && filter === "upcoming"}
          {@render nextBlock()}
        {/if}
        {@render controls()}
        {@render ledger()}
      {:else if view === "board"}
        {@render board()}
      {:else}
        {#if !query && filter === "upcoming"}
          {@render nextBlock()}
        {/if}
        {@render ledger()}
      {/if}
    </div>
  {/snippet}
  {#snippet detail()}
    {#if openGig?.mode === "edit"}
      {#key openGig.gig.id}
        <GigForm
          data={openGig.band}
          gig={openGig.gig}
          onsaved={(id) =>
            router.go(path("bookings", "gig", openGig.band.band.id, id), {
              replace: true,
            })}
          oncancel={() =>
            router.back(
              path("bookings", "gig", openGig.band.band.id, openGig.gig.id),
            )}
        />
      {/key}
    {:else if openGig?.mode === "played"}
      {#key openGig.gig.id}
        <PlayedForm
          gig={openGig.gig}
          venueName={venueLine(openGig.gig, openGig.band.venues)}
          currency={openGig.band.band.currency ?? "EUR"}
          used={usedCurrencies(openGig.band.gigs)}
          busy={ui.busy}
          oncancel={() =>
            router.back(
              path("bookings", "gig", openGig.band.band.id, openGig.gig.id),
            )}
          onsave={async (survey, earnings) => {
            const target = openGig;
            if (!target) return;
            const ok = await run(() =>
              bands.markPlayed(
                target.band.band.id,
                target.gig.id,
                survey,
                earnings,
              ),
            );
            if (ok)
              router.go(
                path("bookings", "gig", target.band.band.id, target.gig.id),
                {
                  replace: true,
                },
              );
          }}
        />
      {/key}
    {:else if openGig}
      <GigDetail data={openGig.band} gig={openGig.gig} />
    {:else if kind === "new"}
      {#if !newBand}
        <div class="detail-head">
          <p class="kicker">New gig</p>
          <h2>Which band is it for?</h2>
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
            <li class="empty">Create a band on the Band page first.</li>
          {/each}
        </ul>
      {:else if fromItem && fromLoaded !== fromItem.id}
        <p class="empty">Loading the message…</p>
      {:else}
        {#key `${newBand.band.id}:${from}`}
          <GigForm
            data={newBand}
            prefill={fromItem
              ? prefillFrom(fromItem, newBand)
              : {
                  contactId: router.query.get("contact") ?? undefined,
                  extracted: {
                    venueId: router.query.get("venue") ?? undefined,
                  },
                }}
            onsaved={(id) =>
              router.go(path("bookings", "gig", newBand.band.id, id), {
                replace: true,
              })}
            oncancel={() => router.back("bookings")}
          />
        {/key}
      {/if}
    {:else if kind && data.loaded}
      <p class="empty">
        This item isn't here any more. It may have been removed on another
        device.
      </p>
    {:else}
      <div class="placeholder">
        <span class="placeholder-icon"><Icon name="calendar" size={26} /></span>
        <p>Choose a gig to see its details.</p>
      </div>
    {/if}
  {/snippet}
</ListDetailLayout>

{#if openGig && !openGig.mode}
  <GigSheet
    gig={openGig.gig}
    bandName={openGig.band.band.name}
    currency={openGig.band.band.currency ?? "EUR"}
    venue={openGig.band.venues.find((v) => v.id === openGig.gig.venueId)}
    contacts={contactsOf(openGig.gig, openGig.band.contacts)}
  />
{/if}

<style>
.list {
  padding-bottom: 32px;
}
.list-head {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 14px var(--pad);
  background: var(--color-surface);
  border-bottom: var(--rule);
}
.search {
  position: relative;
  flex: 1;
  min-width: 180px;
  display: flex;
  align-items: center;
}
.search :global(svg) {
  position: absolute;
  left: 11px;
  color: var(--faint);
  pointer-events: none;
}
.search .input {
  padding-left: 34px;
}
.next {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 16px var(--pad) 4px;
  padding: 18px 20px 16px;
  border-radius: var(--radius-xl);
  background:
    radial-gradient(
      120% 140% at 100% 0%,
      var(--color-accent-500) 0%,
      transparent 55%
    ),
    var(--color-accent-700);
  color: #fff;
  text-decoration: none;
  box-shadow: var(--shadow-md);
  overflow: hidden;
}
@media (prefers-color-scheme: dark) {
  .next {
    background:
      radial-gradient(
        120% 140% at 100% 0%,
        var(--color-accent-500) 0%,
        transparent 55%
      ),
      var(--color-accent-400);
  }
}
.next:hover {
  box-shadow: var(--shadow-lg);
}
.next-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 500;
  opacity: 0.85;
}
.next-date {
  margin-top: 6px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.next-title {
  font-size: 15px;
  font-weight: 500;
  opacity: 0.95;
}
.next-times {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.next-time {
  display: flex;
  flex-direction: column;
  min-width: 92px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgb(255 255 255 / 0.14);
  font-size: 12px;
  line-height: 1.3;
}
.next-time span {
  opacity: 0.8;
}
.next-time strong {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.board {
  display: grid;
  grid-template-columns: repeat(5, minmax(200px, 1fr));
  gap: 12px;
  padding: 16px var(--pad);
  overflow-x: auto;
  min-height: 60vh;
  background: var(--color-bg);
}
.column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: var(--radius-lg);
  background: var(--color-sunken);
}
.column-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0;
  padding: 12px 12px 4px;
}
.count {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}
.column ul {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  color: inherit;
  text-decoration: none;
}
.card:hover {
  border-color: var(--color-border);
  box-shadow: var(--shadow-md);
}
.card.selected {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-200);
}
.card.hot {
  border-color: var(--color-accent-300);
}
.card-top {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  justify-content: space-between;
  font-weight: 600;
  font-size: 12px;
  color: var(--color-accent-700);
}
.card-kick {
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
  text-transform: capitalize;
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}
.card-sub {
  font-size: 12px;
  color: var(--muted);
}
.card-money {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  padding-top: 8px;
  border-top: var(--rule);
  font-size: 12px;
  color: var(--muted);
}
.card-money strong {
  color: var(--color-text);
  font-weight: 600;
}
.choose {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 28px;
}
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 100%;
  min-height: 320px;
  padding: 24px;
  color: var(--muted);
  text-align: center;
}
.placeholder p {
  margin: 0;
}
.placeholder-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: 8px;
  border-radius: 50%;
  background: var(--color-surface-2);
  color: var(--faint);
}
section:not(.column) > ul {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
@media (max-width: 899px) {
  .list {
    padding-bottom: calc(var(--tabbar) + 24px);
  }
  .list-head {
    position: static;
    padding: 12px var(--pad) 4px;
    background: transparent;
    border-bottom: 0;
  }
  .search {
    flex-basis: 100%;
  }
}
</style>
