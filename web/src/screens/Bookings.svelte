<script lang="ts">
import type { Gig, GigStatus } from "@showday/schemas";
import { availabilitySummary } from "../components/AvailabilityCells.svelte";
import Icon from "../components/Icon.svelte";
import LedgerRow from "../components/LedgerRow.svelte";
import ListDetailLayout from "../components/ListDetailLayout.svelte";
import MessageRow from "../components/MessageRow.svelte";
import SectionLabel from "../components/SectionLabel.svelte";
import Segmented from "../components/Segmented.svelte";
import StatCells from "../components/StatCells.svelte";
import { type BandData, data } from "../lib/data.svelte";
import {
  capitalize,
  daysUntil,
  messageTime,
  monthLabel,
  normalize,
  shortDate,
  today,
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
import {
  channelTag,
  type InboxItem,
  inboxItems,
  matchLine,
  matchSender,
} from "../lib/inbox";
import { prefillFrom, senderName, threads } from "../lib/messages.svelte";
import { path, router } from "../lib/router.svelte";
import { run, ui } from "../lib/ui.svelte";
import { bands } from "../storage";
import GigDetail from "./GigDetail.svelte";
import GigForm from "./GigForm.svelte";
import GigSheet from "./GigSheet.svelte";
import MessageDetail from "./MessageDetail.svelte";
import PlayedForm from "./PlayedForm.svelte";

let { humanAgent = false }: { humanAgent?: boolean } = $props();

let view = $state<"list" | "board">(
  localStorage.getItem("showday:view") === "board" ? "board" : "list",
);
// Upcoming first; played, cancelled and past-dated gigs are under Past.
let filter = $state<"upcoming" | "past">("upcoming");
let query = $state("");
let showSorted = $state(false);
let allToSort = $state(false);
const now = today();
const many = $derived(data.all.length > 1 && !data.current);

const rows = $derived(
  data.inView.flatMap((band) => band.gigs.map((gig) => ({ gig, band }))),
);
const inbox = $derived(
  inboxItems(
    data.conversations,
    data.inView.map((b) => b.band.id),
    rows.map((r) => r.gig),
    data.inView.flatMap((b) => b.triage),
  ),
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
function messageMatches(item: InboxItem) {
  if (!needle) return true;
  return normalize(
    `${senderName(item.conversation, bandOf(item.conversation.bandId))} ${item.conversation.peer.id} ${item.conversation.preview}`,
  ).includes(needle);
}
const toSort = $derived(
  inbox.filter((i) => i.state === "toSort" && messageMatches(i)),
);
const sorted = $derived(
  inbox.filter((i) => i.state !== "toSort" && messageMatches(i)),
);
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
const openMessage = $derived(
  kind === "message" ? inbox.find((i) => i.id === router.parts[1]) : undefined,
);
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
const selectedMessage = $derived(openMessage?.id ?? "");

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
function matchFor(item: InboxItem) {
  if (item.state === "converted")
    return { text: "Already an enquiry", tone: "muted" as const };
  if (item.state === "archived")
    return { text: "Not a booking", tone: "muted" as const };
  const band = bandOf(item.conversation.bandId);
  const match = matchSender(item.conversation, band?.contacts ?? []);
  return {
    text: matchLine(match),
    tone: match.kind === "matched" ? ("ink" as const) : ("accent" as const),
  };
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
        placeholder={ui.phone
          ? "Search"
          : "Search gigs, venues, contacts, messages"}
        bind:value={query}
      >
    </label>
    {#if view === "list" || ui.phone}
      <Segmented
        label="Show"
        dark
        options={[
          { value: "upcoming", label: "Upcoming" },
          { value: "past", label: "Past" },
        ]}
        bind:value={filter}
      />
    {/if}
  </div>
{/snippet}

{#snippet toSortGroup()}
  {#if toSort.length || sorted.length}
    <section aria-labelledby="to-sort">
      <SectionLabel tone="accent" id="to-sort">
        To sort · {toSort.length}
        {#snippet aside()}
          {#if ui.phone}
            {#if toSort.length > 3}
              <button
                type="button"
                class="link"
                onclick={() => (allToSort = !allToSort)}
              >
                {allToSort ? "Show fewer" : "See all"}
              </button>
            {/if}
          {:else}
            <span class="muted">From email, Messenger, Instagram</span>
          {/if}
        {/snippet}
      </SectionLabel>
      <ul>
        {#each ui.phone && !allToSort
          ? toSort.slice(0, 3)
          : toSort as item (item.id)}
          {@const band = bandOf(item.conversation.bandId)}
          {@const match = matchFor(item)}
          <MessageRow
            href={`#/${path("bookings", "message", item.id)}`}
            channel={channelTag[item.conversation.channel]}
            sender={senderName(item.conversation, band)}
            preview={item.conversation.preview}
            match={match.text}
            matchTone={match.tone}
            time={messageTime(item.latest)}
            selected={item.id === selectedMessage}
          />
        {:else}
          <li class="empty">Nothing to sort. New messages land here.</li>
        {/each}
        {#if showSorted}
          {#each sorted as item (item.id)}
            {@const band = bandOf(item.conversation.bandId)}
            {@const match = matchFor(item)}
            <MessageRow
              href={`#/${path("bookings", "message", item.id)}`}
              channel={channelTag[item.conversation.channel]}
              sender={senderName(item.conversation, band)}
              preview={item.conversation.preview}
              match={match.text}
              matchTone={match.tone}
              time={messageTime(item.latest)}
              selected={item.id === selectedMessage}
              dim
            />
          {/each}
        {/if}
      </ul>
      {#if sorted.length}
        <button
          type="button"
          class="link more"
          onclick={() => (showSorted = !showSorted)}
        >
          {showSorted
            ? "Hide sorted messages"
            : `Show ${sorted.length} sorted ${sorted.length === 1 ? "message" : "messages"}`}
        </button>
      {/if}
    </section>
  {/if}
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
    </a>
    <StatCells cells={timeCells(next.gig)} size="sm" tone="accent" />
  {/if}
{/snippet}

{#snippet ledger()}
  {#if many && !data.all.length}
    <p class="empty">Create your first band to get started.</p>
  {/if}
  {#each months as month (month.key)}
    <section aria-label={month.label}>
      {#if !ui.phone}
        <SectionLabel>{month.label}</SectionLabel>
      {/if}
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
            showMonth={ui.phone}
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
          <span class="label">{column.status}</span
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

<ListDetailLayout {open} key={router.parts.join("/")}>
  {#snippet list()}
    <div class="list">
      {#if !ui.phone}
        {@render controls()}
      {/if}
      {#if ui.phone}
        {@render toSortGroup()}
        {#if !query && filter === "upcoming"}
          {@render nextBlock()}
        {/if}
        {@render controls()}
        <SectionLabel
          >{filter === "upcoming" ? "Coming up" : "Past"}</SectionLabel
        >
        {@render ledger()}
      {:else if view === "board"}
        {@render toSortGroup()}
        {@render board()}
      {:else}
        {@render toSortGroup()}
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
    {:else if openMessage}
      {@const band = bandOf(openMessage.conversation.bandId)}
      {#if band}
        <!-- Keyed so an unsent reply draft never follows you to another conversation. -->
        {#key openMessage.id}
          <MessageDetail item={openMessage} data={band} {humanAgent} />
        {/key}
      {/if}
    {:else if kind === "new"}
      {#if !newBand}
        <div class="detail-head">
          <p class="kicker">New enquiry</p>
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
      <p class="empty">Choose a gig or a message to see it here.</p>
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
  gap: 12px;
  align-items: center;
  padding: 16px 24px;
  background: var(--color-bg);
  border-bottom: var(--rule-2);
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
  left: 10px;
  color: var(--muted);
  pointer-events: none;
}
.search .input {
  padding-left: 34px;
}
.link {
  border: 0;
  background: transparent;
  padding: 0;
  font-weight: 600;
  font-size: 13px;
  color: var(--color-text);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.more {
  margin: 10px 24px 4px;
  color: var(--muted);
}
.next {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 18px 16px 14px;
  margin-top: 16px;
  background: var(--color-accent-600);
  color: #fff;
  text-decoration: none;
}
.next-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.next-date {
  font-size: 40px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.05;
  text-transform: uppercase;
}
.next-title {
  font-size: 16px;
  font-weight: 800;
}
.board {
  display: grid;
  grid-template-columns: repeat(5, minmax(180px, 1fr));
  overflow-x: auto;
  min-height: 60vh;
}
.column {
  border-right: var(--rule-2);
  min-width: 0;
}
.column:last-child {
  border-right: 0;
}
.column-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 0;
  padding: 16px 16px 10px;
  border-bottom: var(--rule-2);
  font-family: var(--font-body);
}
.count {
  font-size: 28px;
  font-weight: 800;
}
.column ul {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  background: var(--color-surface);
  color: inherit;
  text-decoration: none;
}
.card:hover,
.card.selected {
  background: var(--color-neutral-300);
}
.card.selected {
  box-shadow: var(--select-mark);
}
.card.hot {
  background: var(--color-accent-600);
  color: #fff;
}
.card-top {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  justify-content: space-between;
  font-weight: 800;
  font-size: 13px;
  text-transform: uppercase;
}
.card-kick {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
}
.card-title {
  font-size: 17px;
  font-weight: 800;
  line-height: 1.2;
}
.card-sub {
  font-size: 12px;
}
.card-money {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid color-mix(in srgb, currentColor 40%, transparent);
  font-size: 12px;
}
.choose {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 28px;
}
@media (max-width: 899px) {
  .list {
    padding-bottom: calc(var(--tabbar) + 16px);
  }
  .list-head {
    position: static;
    padding: 12px 16px;
  }
  .search {
    flex-basis: 100%;
  }
  .more {
    margin-inline: 16px;
  }
}
</style>
