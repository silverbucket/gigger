<script lang="ts">
import {
  capacities,
  type Venue,
  type VenueSurvey,
  venueAverages,
} from "@showday/schemas";
import { untrack } from "svelte";
import BottomActionBar from "../components/BottomActionBar.svelte";
import Icon from "../components/Icon.svelte";
import ListDetailLayout from "../components/ListDetailLayout.svelte";
import PhoneHeader from "../components/PhoneHeader.svelte";
import Rating from "../components/Rating.svelte";
import SectionLabel from "../components/SectionLabel.svelte";
import Segmented from "../components/Segmented.svelte";
import StatCells from "../components/StatCells.svelte";
import Tag from "../components/Tag.svelte";
import type { BandData } from "../lib/data.svelte";
import {
  capitalize,
  mapUrl,
  mediumDate,
  normalize,
  plural,
} from "../lib/format";
import { path, router } from "../lib/router.svelte";
import { run, ui } from "../lib/ui.svelte";
import { bands } from "../storage";

let { data }: { data: BandData } = $props();
let filter = $state<"all" | "played" | "return" | "unsurveyed">("all");
let query = $state("");

type Row = {
  venue: Venue;
  surveys: VenueSurvey[];
  averages: ReturnType<typeof venueAverages>;
  gigs: number;
  played: number;
  again?: boolean;
};
const rows = $derived<Row[]>(
  data.venues.map((venue) => {
    const surveys = data.surveys
      .filter((s) => s.venueId === venue.id)
      .sort((a, b) => b.date.localeCompare(a.date));
    const gigs = data.gigs.filter((g) => g.venueId === venue.id);
    const yes = surveys.filter((s) => s.playAgain).length;
    return {
      venue,
      surveys,
      averages: venueAverages(surveys),
      gigs: gigs.length,
      played: gigs.filter((g) => g.status === "played").length,
      again: surveys.length ? yes * 2 >= surveys.length : undefined,
    };
  }),
);
const shown = $derived(
  rows
    .filter((r) =>
      filter === "played"
        ? r.played > 0
        : filter === "return"
          ? r.again === true
          : filter === "unsurveyed"
            ? !r.surveys.length
            : true,
    )
    .filter(
      (r) =>
        !query ||
        normalize(
          `${r.venue.name} ${r.venue.city ?? ""} ${r.venue.address}`,
        ).includes(normalize(query)),
    ),
);
const surveyed = $derived(rows.filter((r) => r.surveys.length).length);
const id = $derived(router.parts[0] ?? "");
const mode = $derived(router.parts[1] ?? "");
const selected = $derived(rows.find((r) => r.venue.id === id));
const editing = $derived(id === "new" || mode === "edit");

let draft = $state<Venue>({ id: "", name: "", address: "" });
// Start the draft when the form opens; later syncs don't overwrite what's being typed.
$effect(() => {
  // Track the route's record id so switching straight from editing one venue
  // to "New venue" (or to another venue) starts a fresh draft instead of
  // keeping the previous one, which would overwrite it on save.
  void id;
  if (editing)
    draft = untrack(() =>
      structuredClone(
        $state.snapshot(selected?.venue) ?? {
          id: "",
          name: "",
          address: "",
          city: "",
        },
      ),
    );
});
async function save(event: SubmitEvent) {
  event.preventDefault();
  // Keep the generated id on the draft, not just the saved value, so a
  // retry after a save that succeeded but failed to reload reuses it
  // instead of creating a duplicate venue.
  draft.id ||= crypto.randomUUID();
  const value: Venue = {
    ...$state.snapshot(draft),
    name: draft.name.trim(),
    address: draft.address.trim(),
  };
  if (!value.city?.trim()) delete value.city;
  if (await run(() => bands.save("venue", data.band.id, value)))
    router.go(path("venues", value.id), { replace: true });
}
const short = (c: string) => (c === "under 50" ? "under 50" : c);
</script>

<ListDetailLayout open={!!id} key={router.parts.join("/")}>
  {#snippet list()}
    <div class="pane">
      <div class="page-head">
        <div>
          <h1>Venues</h1>
          <p>
            {plural(rows.length, "venue")}
            · {surveyed} surveyed · {plural(data.surveys.length, "survey")}
          </p>
        </div>
        <Segmented
          label="Show"
          options={[
            { value: "all", label: "All" },
            { value: "played", label: "Played" },
            { value: "return", label: "Would return" },
            { value: "unsurveyed", label: "Not surveyed" },
          ]}
          bind:value={filter}
        />
      </div>
      <div class="search-row">
        <label class="sr-only" for="venue-search">Search venues</label>
        <input
          id="venue-search"
          class="input"
          type="search"
          placeholder="Search by name or city"
          bind:value={query}
        >
        {#if ui.phone}
          <a class="btn btn-secondary" href="#/venues/new"
            ><Icon name="plus" />
            New venue</a
          >
        {/if}
      </div>
      <div class="table-head" aria-hidden="true">
        <span>Venue · City</span><span>Rating</span><span>Capacity</span
        ><span>Return</span><span>Gigs</span>
      </div>
      <ul>
        {#each shown as row (row.venue.id)}
          <li>
            <a
              class="row"
              class:selected={row.venue.id === id}
              aria-current={row.venue.id === id ? "true" : undefined}
              href={`#/${path("venues", row.venue.id)}`}
            >
              <span class="what">
                <strong>{row.venue.name}</strong>
                <span class="sub">
                  {[
                    row.venue.city,
                    row.surveys.length
                      ? plural(row.surveys.length, "survey")
                      : "not surveyed",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span class="rating">
                <span class="num"
                  >{row.averages ? row.averages.rating.toFixed(1) : "—"}</span
                >
                <Rating value={row.averages?.rating ?? 0} />
              </span>
              <span class="cap"
                >{row.averages?.capacities.map(short).join(" / ") ?? "—"}</span
              >
              <span class="again" class:alert-text={row.again === false}
                >{row.again === undefined
                  ? "—"
                  : row.again
                    ? "Yes"
                    : "No"}</span
              >
              <span class="gigs">{row.gigs}</span>
            </a>
          </li>
        {:else}
          <li class="empty">
            {rows.length
              ? "No venues match."
              : "No venues yet. Venues you add to enquiries appear here."}
          </li>
        {/each}
      </ul>
    </div>
  {/snippet}
  {#snippet detail()}
    {#if editing}
      <PhoneHeader
        title={id === "new" ? "New venue" : "Edit venue"}
        onclose={() => router.back("venues")}
      />
      <form class="edit" onsubmit={save}>
        <div class="detail-head">
          <p class="kicker">Venue</p>
          <h2>{id === "new" ? "New venue" : "Edit venue"}</h2>
        </div>
        <fieldset class="form block" disabled={ui.busy}>
          <div class="field">
            <label for="venue-name">Name</label>
            <input
              id="venue-name"
              class="input"
              required
              bind:value={draft.name}
            >
          </div>
          <div class="field">
            <label for="venue-address">Address</label>
            <input
              id="venue-address"
              class="input"
              required
              bind:value={draft.address}
            >
          </div>
          <div class="field">
            <label for="venue-city">City</label>
            <input id="venue-city" class="input" bind:value={draft.city}>
            <p class="field-hint">
              Shown with confirmed gigs on your public page.
            </p>
          </div>
        </fieldset>
        <div class="spacer"></div>
        <BottomActionBar>
          <button
            type="submit"
            class="btn btn-primary btn-wide"
            disabled={ui.busy}
          >
            Save venue <Icon name="arrow-right" stroke={2.5} />
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            onclick={() => router.back("venues")}
          >
            Cancel
          </button>
        </BottomActionBar>
      </form>
    {:else if selected}
      {@const { venue, surveys, averages } = selected}
      {@const indoor = surveys.filter((s) => s.setting === "indoor").length}
      {@const counted = surveys.filter((s) => s.attendance !== undefined)}
      {@const avgPeople = counted.length
        ? Math.round(
            counted.reduce((sum, s) => sum + (s.attendance ?? 0), 0) /
              counted.length,
          )
        : undefined}
      {@const most = averages
        ? Math.max(
            ...capacities.map(
              (c) => surveys.filter((s) => s.capacity === c).length,
            ),
          )
        : 0}
      <PhoneHeader back={() => router.back("venues")} backLabel="Venues">
        {#snippet action()}
          <a
            class="btn btn-ghost"
            href={`#/${path("venues", venue.id, "edit")}`}
            >Edit</a
          >
        {/snippet}
      </PhoneHeader>
      <div class="detail-head head-row">
        <div>
          <p class="kicker">Venue{venue.city ? ` · ${venue.city}` : ""}</p>
          <h2>{venue.name}</h2>
          <p>
            {venue.address}
            ·
            <a href={mapUrl(venue.address)} target="_blank" rel="noreferrer"
              >Map ↗</a
            >
          </p>
        </div>
        <a
          class="btn btn-secondary desktop"
          href={`#/${path("venues", venue.id, "edit")}`}
          >Edit</a
        >
      </div>
      <div class="scroll">
        {#if averages}
          <StatCells
            phoneColumns={2}
            cells={[
              {
                label: "Avg rating",
                value: `${averages.rating.toFixed(1)} / 5`,
                note: `from ${plural(averages.count, "survey")}`,
              },
              {
                label: "Usual capacity",
                value: averages.capacities.join(" / "),
                note: "most often reported",
              },
              {
                label: "Venue PA",
                value: `${averages.paProvided} of ${averages.count}`,
                note: `${Math.round((averages.paProvided / averages.count) * 100)}% provided a PA`,
              },
              {
                label: "Play again",
                value: selected.again ? "Yes" : "No",
                note:
                  avgPeople !== undefined
                    ? `avg ${avgPeople} people`
                    : `${surveys.filter((s) => s.playAgain).length} of ${surveys.length} would`,
              },
            ]}
          />
          <SectionLabel>
            Capacity reported
            {#snippet aside()}
              {indoor}
              indoor · {surveys.length - indoor} outdoor
            {/snippet}
          </SectionLabel>
          <ol class="capacity">
            {#each capacities as capacity (capacity)}
              {@const count = surveys.filter(
                (s) => s.capacity === capacity,
              ).length}
              <li class:hot={count > 0 && count === most} class:zero={!count}>
                <strong>{count}</strong><span>{capacity}</span>
              </li>
            {/each}
          </ol>
          <SectionLabel>
            Surveys after each gig
            {#snippet aside()}
              Kept in your account. Sharing with other bands comes later.
            {/snippet}
          </SectionLabel>
          <ul>
            {#each surveys as survey (survey.id)}
              <li class="survey">
                <div class="when">
                  <strong>{mediumDate(survey.date)}</strong>
                  <Rating value={survey.rating} />
                </div>
                <div class="tags">
                  <span class="tag-row">
                    <Tag>{survey.capacity} cap.</Tag>
                    <Tag>{survey.setting}</Tag>
                    <Tag>PA: {survey.pa}</Tag>
                    {#if survey.attendance !== undefined}
                      <Tag kind="proposed">≈ {survey.attendance} people</Tag>
                    {/if}
                    <Tag kind={survey.playAgain ? "neutral" : "accent"}
                      >{survey.playAgain
                        ? "Would play again"
                        : "Would not return"}</Tag
                    >
                  </span>
                  {#if survey.stageNotes}
                    <p class="notes">“{survey.stageNotes}”</p>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty">
            No surveys yet. Marking a gig here played adds one.
          </p>
        {/if}
        <SectionLabel>Gigs here · {selected.gigs}</SectionLabel>
        <ul>
          {#each data.gigs
            .filter((g) => g.venueId === venue.id)
            .sort((a, b) => b.date.localeCompare(a.date)) as gig (gig.id)}
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
            <li class="empty">No gigs here yet.</li>
          {/each}
        </ul>
      </div>
      <BottomActionBar>
        <a
          class="btn btn-primary btn-wide"
          href={`#/bookings/new?venue=${encodeURIComponent(venue.id)}`}
          >New enquiry <Icon name="arrow-right" stroke={2.5} /></a
        >
        <a
          class="btn btn-secondary"
          href={`#/${path("venues", venue.id, "edit")}`}
          >Edit</a
        >
      </BottomActionBar>
    {:else if id}
      <p class="empty">This venue isn't here any more.</p>
    {:else}
      <p class="empty">Choose a venue to see what it was really like.</p>
    {/if}
  {/snippet}
</ListDetailLayout>

<style>
.pane {
  padding-bottom: 32px;
}
.search-row {
  display: flex;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: var(--rule);
}
.table-head,
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 120px 110px 70px 48px;
  gap: 12px;
  align-items: center;
  padding: 10px 24px;
}
.table-head {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-bottom: var(--rule-2);
}
.table-head span:last-child,
.gigs {
  text-align: right;
}
.row {
  min-height: 64px;
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
.sub {
  font-size: 13px;
}
.rating {
  display: flex;
  gap: 8px;
  align-items: center;
}
.num,
.gigs {
  font-weight: 800;
  font-size: 15px;
}
.gigs {
  font-size: 18px;
}
.cap,
.again {
  font-size: 13px;
}
.head-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
}
.scroll {
  flex: 1;
}
.capacity {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 12px 28px 16px;
  border: var(--rule);
}
.capacity li {
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  border-right: var(--rule);
  font-size: 11px;
}
.capacity li:last-child {
  border-right: 0;
}
.capacity strong {
  font-size: 20px;
  font-weight: 800;
}
.capacity .hot {
  background: var(--color-accent-600);
  color: #fff;
}
.capacity .zero {
  color: var(--color-neutral-500);
}
.survey {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 16px;
  padding: 14px 28px;
  border-bottom: var(--rule);
}
.when {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.notes {
  margin: 8px 0 0;
  font-size: 14px;
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
    grid-template-columns: minmax(0, 1fr) 110px 48px;
  }
  .table-head span:nth-child(3),
  .table-head span:nth-child(4),
  .cap,
  .again {
    display: none;
  }
}
@media (max-width: 899px) {
  .pane {
    padding-bottom: calc(var(--tabbar) + 16px);
  }
  .search-row,
  .table-head,
  .row {
    padding-inline: 16px;
  }
  .desktop,
  .table-head {
    display: none;
  }
  .capacity {
    margin-inline: 16px;
  }
  .survey,
  .gig {
    padding-inline: 16px;
  }
  .survey {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .gig {
    grid-template-columns: 90px minmax(0, 1fr) auto;
    gap: 8px;
  }
  .block {
    padding-inline: 16px;
  }
}
</style>
