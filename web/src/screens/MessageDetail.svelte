<script lang="ts">
import {
  type Attachment,
  type Gig,
  messagePeer,
  needsHumanAgentTag,
  replyBlocked,
} from "@gigger/schemas";
import BottomActionBar from "../components/BottomActionBar.svelte";
import DetailSection from "../components/DetailSection.svelte";
import Icon from "../components/Icon.svelte";
import PhoneHeader from "../components/PhoneHeader.svelte";
import SectionLabel from "../components/SectionLabel.svelte";
import type { BandData } from "../lib/data.svelte";
import { longDate, messageTimeLong, money, shortDate } from "../lib/format";
import { channelName, type InboxItem, matchSender } from "../lib/inbox";
import {
  latestIncoming,
  prefillFrom,
  senderName,
  sendReply,
  threads,
} from "../lib/messages.svelte";
import { path, router } from "../lib/router.svelte";
import { run, ui } from "../lib/ui.svelte";
import { bands } from "../storage";

let {
  item,
  data,
  humanAgent = false,
}: { item: InboxItem; data: BandData; humanAgent?: boolean } = $props();
const conversation = $derived(item.conversation);
const messages = $derived(threads.byId[item.id]);
const latest = $derived(latestIncoming(messages));
const earlier = $derived((messages ?? []).filter((m) => m !== latest));
const match = $derived(matchSender(conversation, data.contacts));
const prefill = $derived(prefillFrom(item, data));
const found = $derived(prefill.extracted ?? {});
const venue = $derived(data.venues.find((v) => v.id === found.venueId));
const missing = $derived(
  [!found.date && "date", !venue && "venue"].filter(Boolean) as string[],
);
// Saving straight from here needs everything the gig requires and a clear contact.
const quick = $derived(!missing.length && match.kind !== "ambiguous");
let now = $state(Date.now());
let reply = $state("");
let loading = $state(false);
let failed = $state("");
const blocked = $derived(replyBlocked(conversation, now, humanAgent));
const tagged = $derived(
  humanAgent && !blocked && needsHumanAgentTag(conversation, now),
);
const address = $derived(
  conversation.channel === "instagram"
    ? `@${conversation.peer.id.replace(/^@/, "")}`
    : conversation.channel === "email"
      ? conversation.peer.id
      : `Messenger${conversation.peer.name ? ` · ${conversation.peer.name}` : ""}`,
);

$effect(() => {
  const id = item.id;
  loading = true;
  failed = "";
  threads
    .load(id)
    .catch(() => {
      failed = "Could not load this conversation. Please retry.";
    })
    .finally(() => {
      loading = false;
    });
  const tick = setInterval(() => {
    now = Date.now();
  }, 60000);
  return () => clearInterval(tick);
});

async function createEnquiry() {
  if (!quick || !found.date || !venue) {
    router.go(`${path("bookings", "new")}?from=${encodeURIComponent(item.id)}`);
    return;
  }
  const bandId = data.band.id;
  const gigId = crypto.randomUUID();
  const ok = await run(async () => {
    let contactId = prefill.contactId;
    if (!contactId && prefill.newContact) {
      contactId = crypto.randomUUID();
      await bands.save("contact", bandId, {
        ...prefill.newContact,
        id: contactId,
      });
    }
    const gig: Gig = {
      id: gigId,
      title: prefill.title ?? "Enquiry",
      date: found.date ?? "",
      contactDate: new Date().toLocaleDateString("en-CA"),
      venueId: venue.id,
      contactIds: contactId ? [contactId] : [],
      status: "enquiry",
      enquiryText: prefill.enquiryText ?? "",
      enquirySource: conversation.channel,
      conversationId: item.id,
      fee: found.fee
        ? { amount: found.fee.amount, currency: found.fee.currency, extras: [] }
        : { extras: [] },
      ...(found.start ? { setTimes: [found.start] } : {}),
      ...(found.sets || found.doors
        ? {
            notes: `From the message: ${[found.sets && `${found.sets} ${found.sets === 1 ? "set" : "sets"}`, found.doors && `doors ${found.doors}`].filter(Boolean).join(" · ")}`,
          }
        : {}),
    };
    await bands.save("gig", bandId, gig);
  });
  if (ok) router.go(path("bookings", "gig", bandId, gigId), { replace: true });
}
async function send(event: SubmitEvent) {
  event.preventDefault();
  const text = reply;
  if (!text.trim()) return;
  const ok = await run(() => sendReply(item.id, conversation.bandId, text));
  if (ok && reply === text) reply = "";
}
</script>

<PhoneHeader back={() => router.back("bookings")} backLabel="Bookings" />

<div class="detail-head">
  <p class="kicker">
    {item.state === "toSort"
      ? "To sort"
      : item.state === "archived"
        ? "Not a booking"
        : "Enquiry"}
    · {channelName[conversation.channel]} ·
    {messageTimeLong(conversation.lastIn ?? item.latest)}
  </p>
  <h2 class="sender">{senderName(conversation, data)}</h2>
  <p class="muted">
    {address}
    {#if conversation.subject}
      · {conversation.subject}
    {/if}
  </p>
</div>

{#snippet attachments(list: Attachment[] | undefined)}
  {#each list ?? [] as attachment (attachment.url)}
    {#await threads.fileUrl(attachment)}
      <p class="muted">Loading attachment…</p>
    {:then url}
      {#if (attachment.mediaType ?? attachment.type).startsWith("image")}
        <img src={url} alt={attachment.name ?? "Attachment"}>
      {:else}
        <!-- Always a download: a blob URL shares the app origin, so stored HTML must never render. -->
        <a href={url} download={attachment.name ?? ""}
          >{attachment.name ?? attachment.type}</a
        >
      {/if}
    {:catch}
      <p class="muted">Attachment unavailable.</p>
    {/await}
  {/each}
{/snippet}

<div class="scroll">
  <div class="body pre">
    {#if latest}
      {latest.object.content}
    {:else if loading}
      <span class="muted">Loading…</span>
    {:else}
      {conversation.preview}
    {/if}
    {#if failed}
      <p class="alert-text" role="alert">{failed}</p>
    {/if}
    {@render attachments(latest?.object.attachment)}
  </div>

  {#if item.gig}
    <DetailSection label="Gig">
      <a
        class="main"
        href={`#/${path("bookings", "gig", data.band.id, item.gig.id)}`}
        >{item.gig.title}</a
      >
      <span class="line">{longDate(item.gig.date)} · {item.gig.status}</span>
    </DetailSection>
  {:else}
    <DetailSection label="Contact">
      {#if match.kind === "matched"}
        <a class="main" href={`#/${path("contacts", match.contact.id)}`}
          >✓ {match.contact.name}</a
        >
        <span class="line">{match.reason}</span>
      {:else if match.kind === "ambiguous"}
        <span class="main alert-text">
          {match.suggestions.length === 1
            ? "1 possible contact"
            : `${match.suggestions.length} possible contacts`}
          — choose one
        </span>
        <span class="line">
          {match.suggestions
            .slice(0, 3)
            .map((s) => s.contact.name)
            .join(", ")}{match.suggestions.length > 3 ? "…" : ""}. Choose in the
          full form, or create a new contact from the sender.
        </span>
      {:else}
        <span class="main alert-text"
          >New sender · contact ready to create</span
        >
        <span class="line"
          >{prefill.newContact?.name}
          will be added to your contacts.</span
        >
      {/if}
    </DetailSection>
    <DetailSection label="Title"
      ><span class="main">{prefill.title}</span></DetailSection
    >
    <DetailSection label="Date">
      <span class="main" class:muted={!found.date}
        >{found.date ? shortDate(found.date) : "Not found in the message"}</span
      >
    </DetailSection>
    <DetailSection label="Venue">
      {#if venue}
        <span class="main">{venue.name}</span>
        <span class="line"
          >Known venue{venue.city ? ` · ${venue.city}` : ""}</span
        >
      {:else if found.newVenue}
        <span class="main">{found.newVenue}</span>
        <span class="line alert-text"
          >New venue · add the address in the form</span
        >
      {:else}
        <span class="main muted">Not found in the message</span>
      {/if}
    </DetailSection>
    {#if found.fee || found.sets || found.start || found.doors}
      <DetailSection label="Also">
        <span class="main">
          {[
            found.fee && money(found.fee.amount, found.fee.currency),
            found.sets && `${found.sets} ${found.sets === 1 ? "set" : "sets"}`,
            found.start && `start ${found.start}`,
            found.doors && `doors ${found.doors}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </DetailSection>
    {/if}
    <p class="note">
      Filled in from the message. Check before saving.
      {#if missing.length}
        The form opens to add the {missing.join(" and ")}.
      {/if}
    </p>
  {/if}

  {#if earlier.length}
    <SectionLabel>Conversation · {messages?.length}</SectionLabel>
    <ol class="thread">
      {#each earlier as message (message.id)}
        <li class={message.direction}>
          <p class="meta small-label">
            {message.direction === "in"
              ? (messagePeer(message).name ?? messagePeer(message).id)
              : "You"}
            · {messageTimeLong(message.published)}
          </p>
          <p class="pre">{message.object.content}</p>
          {@render attachments(message.object.attachment)}
          {#if message.error}
            <p class="alert-text">Not delivered: {message.error}</p>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  <form class="reply" onsubmit={send}>
    <label class="label" for="reply-text"
      >Reply via {channelName[conversation.channel]}</label
    >
    <textarea
      id="reply-text"
      class="input"
      bind:value={reply}
      rows="3"
      required
      disabled={ui.busy || !!blocked}
    ></textarea>
    {#if blocked}
      <p class="field-hint" role="status">{blocked}</p>
    {:else if tagged}
      <p class="field-hint" role="status">
        More than 24 hours since their last message: this reply goes out with
        Meta's human agent tag, which allows a person to answer within 7 days.
        Automated messages are not permitted.
      </p>
    {/if}
    <button
      type="submit"
      class="btn btn-secondary"
      disabled={ui.busy || !!blocked || !reply.trim()}
    >
      <Icon name="send" />
      Send
    </button>
  </form>
</div>

<BottomActionBar>
  {#if item.gig}
    <a
      class="btn btn-primary btn-wide"
      href={`#/${path("bookings", "gig", data.band.id, item.gig.id)}`}
      >Open gig <Icon name="arrow-right" stroke={2.5} /></a
    >
  {:else}
    <button
      type="button"
      class="btn btn-primary btn-wide"
      disabled={ui.busy}
      onclick={createEnquiry}
    >
      Create enquiry <Icon name="arrow-right" stroke={2.5} />
    </button>
    <a
      class="btn btn-secondary"
      href={`#/${path("bookings", "new")}?from=${encodeURIComponent(item.id)}`}
      >Open full form</a
    >
  {/if}
  {#snippet end()}
    {#if item.state === "toSort"}
      <button
        type="button"
        class="btn btn-ghost"
        disabled={ui.busy}
        onclick={() =>
          run(() => bands.archiveConversation(data.band.id, item.id))}
      >
        Not a booking
      </button>
    {:else if item.state === "archived"}
      <button
        type="button"
        class="btn btn-ghost"
        disabled={ui.busy}
        onclick={() =>
          run(() => bands.unarchiveConversation(data.band.id, item.id))}
      >
        Back to sort
      </button>
    {/if}
  {/snippet}
</BottomActionBar>

<style>
.scroll {
  flex: 1;
}
h2.sender {
  font-size: 32px;
}
.body {
  padding: 18px 28px;
  font-size: 17px;
  line-height: 1.5;
  border-bottom: var(--rule-2);
}
.body img,
.thread img {
  margin-top: 12px;
  max-width: 100%;
}
.note {
  margin: 0;
  padding: 12px 28px;
  font-size: 13px;
  color: var(--muted);
}
.thread li {
  padding: 12px 28px;
  border-bottom: var(--rule);
  font-size: 14px;
}
.thread li.out {
  background: var(--color-neutral-100);
}
.thread p {
  margin: 0;
}
.reply {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 28px 24px;
}
.reply .btn {
  align-self: flex-start;
}
.main {
  color: inherit;
}
a.main:hover {
  color: var(--color-accent-700);
}
@media (max-width: 899px) {
  .body,
  .note,
  .thread li,
  .reply {
    padding-inline: 16px;
  }
}
</style>
