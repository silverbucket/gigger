<script lang="ts">
import {
  type Availability,
  type Gig,
  type GigStatus,
  type Member,
  publicStatuses,
} from "@showday/schemas";
import AvailabilityCells, {
  availabilityLabel,
  availabilitySummary,
} from "../components/AvailabilityCells.svelte";
import BottomActionBar from "../components/BottomActionBar.svelte";
import DetailSection from "../components/DetailSection.svelte";
import Icon from "../components/Icon.svelte";
import PhoneHeader from "../components/PhoneHeader.svelte";
import SectionLabel from "../components/SectionLabel.svelte";
import StatCells from "../components/StatCells.svelte";
import StatusSteps from "../components/StatusSteps.svelte";
import Tag from "../components/Tag.svelte";
import type { BandData } from "../lib/data.svelte";
import {
  daysUntil,
  fee as feeText,
  longDate,
  mapUrl,
  mediumDate,
  money,
  today,
} from "../lib/format";
import {
  contactsOf,
  nextMove,
  sheetText,
  timeCells,
  venueAddress,
  venueOf,
} from "../lib/gigs";
import { channelName } from "../lib/inbox";
import { path, router } from "../lib/router.svelte";
import { run, ui } from "../lib/ui.svelte";
import { bands } from "../storage";

let { data, gig }: { data: BandData; gig: Gig } = $props();
const bandId = $derived(data.band.id);
const currency = $derived(data.band.currency ?? "EUR");
const venue = $derived(venueOf(gig, data.venues));
const address = $derived(venueAddress(gig, data.venues));
const contacts = $derived(contactsOf(gig, data.contacts));
const others = $derived(
  (gig.otherBandIds ?? []).map(
    (id) => data.otherBands.find((b) => b.id === id) ?? { id, name: id },
  ),
);
const times = $derived(timeCells(gig));
const summary = $derived(availabilitySummary(gig, data.members));
const fee = $derived(feeText(gig, currency));
const extras = $derived(typeof gig.fee === "object" ? gig.fee.extras : []);
const move = $derived(
  gig.status in nextMove
    ? nextMove[gig.status as keyof typeof nextMove]
    : undefined,
);
const canCancel = $derived(
  ["enquiry", "offered", "confirmed"].includes(gig.status),
);
const gigPath = $derived(path("bookings", "gig", bandId, gig.id));
const sentTo = $derived(
  (gig.sheetSentTo ?? []).filter((id) => data.members.some((m) => m.id === id)),
);
const sheetLine = $derived(
  gig.sheetSentAt
    ? `Sent to ${sentTo.length === 1 ? "1 member" : `${sentTo.length} members`} · ${mediumDate(today(new Date(gig.sheetSentAt)))}`
    : "Not sent yet",
);
// On the night or after, marking it played is the next thing to do.
const playedDue = $derived(
  gig.status === "confirmed" && daysUntil(gig.date) <= 0,
);

async function moveTo(status: GigStatus) {
  if (status === "played") {
    router.go(`${gigPath}/played`);
    return;
  }
  if (
    status === "cancelled" &&
    !confirm(`Cancel ${gig.title}? Cancelled gigs can't be reopened.`)
  )
    return;
  await run(() => bands.moveGigStatus(bandId, gig.id, status));
}
function setAvailability(memberId: string, value: Availability | null) {
  void run(() => bands.setAvailability(bandId, gig.id, memberId, value));
}
/** Opens the member's own channel with a short question, then marks them as asked. */
function ask(member: Member) {
  const text = `Can you play ${gig.title} on ${longDate(gig.date)}? Reply yes or no.`;
  const href = member.email
    ? `mailto:${member.email}?subject=${encodeURIComponent(`Can you play ${gig.title}?`)}&body=${encodeURIComponent(text)}`
    : member.phone
      ? `sms:${member.phone}?body=${encodeURIComponent(text)}`
      : member.messenger
        ? `https://m.me/${encodeURIComponent(member.messenger)}`
        : "";
  if (href) window.open(href, href.startsWith("http") ? "_blank" : "_self");
  setAvailability(member.id, "maybe");
}
/** Email (or the phone's share sheet) does the sending; the gig remembers who it went to. */
async function sendSheet() {
  const text = sheetText(gig, data);
  const withEmail = data.members.filter((m) => m.email);
  const subject = `Gig sheet: ${gig.title}, ${longDate(gig.date)}`;
  if (ui.phone && navigator.share) {
    try {
      await navigator.share({ title: subject, text });
    } catch {
      return; // dismissed
    }
    await run(() =>
      bands.markSheetSent(
        bandId,
        gig.id,
        data.members.map((m) => m.id),
      ),
    );
    return;
  }
  const to = withEmail.map((m) => m.email).join(",");
  location.href = `mailto:?bcc=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  await run(() =>
    bands.markSheetSent(
      bandId,
      gig.id,
      withEmail.map((m) => m.id),
    ),
  );
}
</script>

<PhoneHeader back={() => router.back("bookings")} backLabel="Gigs">
  {#snippet action()}
    <a class="btn btn-ghost" href={`#/${gigPath}/edit`}>Edit</a>
  {/snippet}
</PhoneHeader>

<div class="detail-head">
  <p class="kicker head-tags">
    <Tag kind={gig.status}
      >{gig.status[0].toUpperCase() + gig.status.slice(1)}</Tag
    >
    <span>{data.band.name}</span>
  </p>
  <h2>{gig.title}</h2>
  <p>
    {longDate(gig.date)}
    {#if venue?.name || gig.venue}
      · {venue?.name ?? gig.venue}
    {/if}
  </p>
</div>

<div class="scroll">
  <StatusSteps status={gig.status} />
  <StatCells cells={times} />

  {#if !ui.phone}
    {@render bandSection()}
  {/if}
  <div class="sections">
    {#if venue || gig.venue || address}
      <DetailSection label="Where">
        <span class="main">{venue?.name ?? gig.venue}</span>
        {#if address}
          <span class="line"
            >{address}{venue?.city ? `, ${venue.city}` : ""}</span
          >
          <a
            class="line"
            href={mapUrl(address)}
            target="_blank"
            rel="noreferrer"
            >Map and directions</a
          >
        {/if}
      </DetailSection>
    {/if}
    {#if contacts.length || gig.contacts?.length || others.length}
      <DetailSection label="Who">
        {#snippet action()}
          <Tag kind="private">Private</Tag>
        {/snippet}
        {#each contacts as contact (contact.id)}
          <span class="person">
            <a class="main plain" href={`#/${path("contacts", contact.id)}`}
              >{contact.name}</a
            >
            {#if contact.phone || contact.email}
              <span class="line reach">
                {#if contact.phone}
                  <a href={`tel:${contact.phone.replace(/\s/g, "")}`}
                    >{contact.phone}</a
                  >
                {/if}
                {#if contact.phone && contact.email}
                  <span aria-hidden="true"> · </span>
                {/if}
                {#if contact.email}
                  <a href={`mailto:${contact.email}`}>{contact.email}</a>
                {/if}
              </span>
            {/if}
          </span>
        {/each}
        {#each gig.contacts ?? [] as contact, i (i)}
          <span class="main">{contact}</span>
        {/each}
        {#if others.length}
          <span class="line"
            >Playing with
            {#each others as other, i (other.id)}
              {i ? ", " : ""}<a href={`#/${path("bands", other.id)}`}
                >{other.name}</a
              >
            {/each}</span
          >
        {/if}
      </DetailSection>
    {/if}
    {#if fee || extras.length || gig.earnings}
      <DetailSection label="Money">
        {#snippet action()}
          <Tag kind="private">Private</Tag>
        {/snippet}
        {#if gig.earnings}
          <span class="main">
            Took home {money(gig.earnings.takeHome, gig.earnings.currency)}
          </span>
          <span class="line">
            {money(gig.earnings.total, gig.earnings.currency)}
            total · {gig.earnings.dealType}{gig.earnings.numberOfBands
              ? ` · split ${gig.earnings.numberOfBands} ways`
              : ""}{gig.earnings.handedOver !== undefined
              ? ` · ${money(gig.earnings.handedOver, gig.earnings.currency)} handed over`
              : ""}
          </span>
          {#if fee}
            <span class="line">Agreed fee {fee}</span>
          {/if}
        {:else}
          <span class="main">{fee ?? "No fee yet"}</span>
        {/if}
        {#if extras.length}
          <span class="line">Plus {extras.join(", ")}</span>
        {/if}
      </DetailSection>
    {/if}
    {#if gig.enquirySource || gig.enquiryText?.trim() || gig.contactDate}
      <DetailSection label="Enquiry">
        <span class="main">
          {gig.enquirySource
            ? `via ${channelName[gig.enquirySource]}`
            : "Enquiry"}{gig.contactDate
            ? ` · ${mediumDate(gig.contactDate)}`
            : ""}
        </span>
        {#if gig.enquiryText?.trim()}
          <p class="line pre quote">{gig.enquiryText}</p>
        {/if}
        {#if gig.conversationId}
          <a
            class="btn btn-secondary convo"
            href={`#/${path("inbox", gig.conversationId)}`}
            ><Icon name="message" />Open conversation</a
          >
        {/if}
      </DetailSection>
    {/if}
    <DetailSection label="Public page">
      {#if publicStatuses.includes(gig.status)}
        <span class="main with-tag"
          ><Tag kind="public">Public</Tag>
          {data.band.slug
            ? "Listed on your public page"
            : "Listed once you publish your page"}</span
        >
        <span class="line"
          >Fans see the date, start time, venue and city{gig.public?.ticketUrl
            ? ", ticket link"
            : ""}{gig.public?.description?.trim() ? " and description" : ""}.
          The title, fee, notes and contacts stay private.</span
        >
      {:else}
        <span class="main with-tag"
          ><Tag kind="private">Private</Tag>Not on your public page yet</span
        >
        <span class="line"
          >Confirmed and played gigs are listed there. The title, fee, notes and
          contacts always stay private.</span
        >
      {/if}
    </DetailSection>
    {#if gig.public?.description?.trim() || gig.public?.ticketUrl}
      <DetailSection label="For fans">
        {#if gig.public?.description?.trim()}
          <span class="main pre">{gig.public.description}</span>
        {/if}
        {#if gig.public?.ticketUrl}
          <span class="line"
            >Tickets:
            <a href={gig.public.ticketUrl} target="_blank" rel="noreferrer"
              >{gig.public.ticketUrl.replace(/^https?:\/\//, "")}</a
            ></span
          >
        {/if}
      </DetailSection>
    {/if}
    {#if gig.notes?.trim()}
      <DetailSection label="Notes">
        {#snippet action()}
          <Tag kind="private">Private</Tag>
        {/snippet}
        <span class="main pre">{gig.notes}</span>
      </DetailSection>
    {/if}
    {#if gig.status !== "cancelled"}
      <DetailSection label="Gig sheet">
        <span>{sheetLine}</span>
        {#snippet action()}
          {#if !ui.phone}
            <button
              type="button"
              class="btn btn-secondary"
              disabled={ui.busy}
              onclick={sendSheet}
            >
              {gig.sheetSentAt ? "Send again" : "Send to members"}
            </button>
          {/if}
        {/snippet}
      </DetailSection>
    {/if}
    {#if ui.phone && (canCancel || move)}
      <DetailSection label="Status">
        <span class="phone-status">
          {#if gig.status === "confirmed" && !playedDue}
            <button
              type="button"
              class="btn btn-secondary"
              disabled={ui.busy}
              onclick={() => moveTo("played")}
            >
              Mark played
            </button>
          {/if}
          <button
            type="button"
            class="btn btn-secondary"
            onclick={() => window.print()}
          >
            <Icon name="printer" />
            Print
          </button>
          {#if canCancel}
            <button
              type="button"
              class="btn btn-ghost btn-danger"
              disabled={ui.busy}
              onclick={() => moveTo("cancelled")}
            >
              Cancel gig
            </button>
          {/if}
        </span>
      </DetailSection>
    {/if}
  </div>
  {#if ui.phone}
    {@render bandSection()}
  {/if}
</div>

{#snippet bandSection()}
  <SectionLabel>
    Band
    {#snippet aside()}
      {#if data.members.length}
        <span class:alert-text={summary.alert} class="avail-line"
          >{summary.line}</span
        >
      {/if}
    {/snippet}
  </SectionLabel>
  {#if !data.members.length}
    <p class="empty">
      Add members on the <a href="#/band">Band page</a> to see who can play.
    </p>
  {:else if ui.phone}
    <ul class="members">
      {#each data.members as member (member.id)}
        {@const value = gig.availability?.[member.id]}
        <li>
          <span class="who">
            <strong>{member.name}</strong>
            <span class="muted">{availabilityLabel[value ?? "none"]}</span>
          </span>
          <span class="choices">
            <button
              type="button"
              class="btn choice"
              class:yes={value === "yes"}
              aria-pressed={value === "yes"}
              disabled={ui.busy}
              onclick={() =>
                setAvailability(member.id, value === "yes" ? null : "yes")}
            >
              {#if value === "yes"}
                <Icon name="check" size={14} stroke={3} />
              {/if}
              In
            </button>
            <button
              type="button"
              class="btn choice"
              class:no={value === "no"}
              aria-pressed={value === "no"}
              disabled={ui.busy}
              onclick={() =>
                setAvailability(member.id, value === "no" ? null : "no")}
            >
              Out
            </button>
            {#if value !== "yes" &&
              value !== "no" &&
              (member.email || member.phone || member.messenger)}
              <button
                type="button"
                class="btn btn-secondary"
                disabled={ui.busy}
                onclick={() => ask(member)}
              >
                Ask
              </button>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {:else}
    <AvailabilityCells
      {gig}
      members={data.members}
      disabled={ui.busy}
      onchange={setAvailability}
    />
  {/if}
{/snippet}

{#if ui.phone}
  <BottomActionBar>
    {#if address}
      <a
        class="btn btn-secondary btn-wide"
        href={mapUrl(address)}
        target="_blank"
        rel="noreferrer"
        >Directions <Icon name="map-pin" /></a
      >
    {/if}
    {#if gig.status === "enquiry" || gig.status === "offered"}
      <button
        type="button"
        class="btn btn-primary btn-wide"
        disabled={ui.busy}
        onclick={() => move && moveTo(move)}
      >
        Mark {move} <Icon name="arrow-right" stroke={2.5} />
      </button>
    {:else if playedDue}
      <button
        type="button"
        class="btn btn-primary btn-wide"
        disabled={ui.busy}
        onclick={() => moveTo("played")}
      >
        Mark played <Icon name="arrow-right" stroke={2.5} />
      </button>
    {:else if gig.status === "confirmed"}
      <button
        type="button"
        class="btn btn-primary btn-wide"
        disabled={ui.busy}
        onclick={sendSheet}
      >
        Send gig sheet <Icon name="arrow-right" stroke={2.5} />
      </button>
    {/if}
  </BottomActionBar>
{:else}
  <BottomActionBar>
    {#if move}
      <button
        type="button"
        class="btn btn-primary btn-wide"
        disabled={ui.busy}
        onclick={() => moveTo(move)}
      >
        Mark {move} <Icon name="arrow-right" stroke={2.5} />
      </button>
    {/if}
    <a class="btn btn-secondary" href={`#/${gigPath}/edit`}>Edit</a>
    <button
      type="button"
      class="btn btn-secondary"
      onclick={() => window.print()}
    >
      <Icon name="printer" />
      Print
    </button>
    {#snippet end()}
      {#if canCancel}
        <button
          type="button"
          class="btn btn-ghost btn-danger"
          disabled={ui.busy}
          onclick={() => moveTo("cancelled")}
        >
          Cancel gig
        </button>
      {/if}
    {/snippet}
  </BottomActionBar>
{/if}

<style>
.scroll {
  flex: 1;
}
.avail-line {
  font-size: 13px;
  font-weight: 600;
}
.members li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 60px;
  padding: 8px var(--pad);
  border-bottom: var(--rule);
}
.who {
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.who strong {
  font-size: 15px;
  font-weight: 600;
}
.choices {
  display: flex;
  gap: 6px;
}
.choice {
  border-color: var(--color-border);
  background: var(--color-surface);
  min-width: 52px;
}
.choice.yes {
  background: var(--tone-confirmed-bg);
  color: var(--tone-confirmed-fg);
  border-color: transparent;
}
.choice.no {
  background: var(--tone-cancelled-bg);
  color: var(--tone-cancelled-fg);
  border-color: transparent;
}
.plain {
  color: inherit;
  text-decoration: none;
}
.plain:hover {
  color: var(--color-accent-700);
}
p.line.quote {
  border-left: 3px solid var(--color-accent-200);
  padding-left: 10px;
  margin: 4px 0;
  max-height: 9.5em;
  overflow: auto;
}
.phone-status {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.main :global(.tag) {
  margin-left: 6px;
  vertical-align: 1px;
}
.with-tag {
  display: flex;
  align-items: center;
  gap: 8px;
}
.main.with-tag :global(.tag) {
  margin-left: 0;
}
.head-tags {
  display: flex;
  align-items: center;
  gap: 8px;
}
.person {
  display: flex;
  flex-direction: column;
}
.person + .person {
  margin-top: 6px;
}
.reach a {
  color: var(--muted);
}
.reach a:hover {
  color: var(--color-accent-700);
}
.convo {
  align-self: flex-start;
  margin-top: 6px;
}
</style>
