<script lang="ts">
import {
  type Attachment,
  type Gig,
  needsHumanAgentTag,
  replyBlocked,
} from "@showday/schemas";
import { tick, untrack } from "svelte";
import { availabilitySummary } from "../components/AvailabilityCells.svelte";
import ChannelIcon from "../components/ChannelIcon.svelte";
import Icon from "../components/Icon.svelte";
import IncomingEmailText from "../components/IncomingEmailText.svelte";
import Tag from "../components/Tag.svelte";
import type { BandData } from "../lib/data.svelte";
import {
  capitalize,
  fee as feeText,
  longDate,
  mediumDate,
  messageTimeLong,
  money,
  shortDate,
} from "../lib/format";
import { contactsOf, venueOf } from "../lib/gigs";
import { channelName, type InboxItem, matchSender } from "../lib/inbox";
import { beginMessageDetailConversation } from "../lib/message-translate-ui-session";
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

/** A conversation as the main thing: the thread, a reply box, and what you need to know beside it. */
let {
  item,
  data,
  humanAgent = false,
}: { item: InboxItem; data: BandData; humanAgent?: boolean } = $props();
const conversation = $derived(item.conversation);
const messages = $derived(threads.byId[item.id]);
const latest = $derived(latestIncoming(messages));
const match = $derived(matchSender(conversation, data.contacts));
const prefill = $derived(prefillFrom(item, data));
const found = $derived(prefill.extracted ?? {});
const venue = $derived(data.venues.find((v) => v.id === found.venueId));
const missing = $derived(
  [!found.date && "date", !venue && "venue"].filter(Boolean) as string[],
);
// Saving straight from here needs everything the gig requires and a clear contact.
const quick = $derived(!missing.length && match.kind !== "ambiguous");
const name = $derived(senderName(conversation, data));
const initials = $derived(
  name
    .replace(/[@._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?",
);
const contact = $derived(
  item.gig
    ? (contactsOf(item.gig, data.contacts)[0] ??
        (match.kind === "matched" ? match.contact : undefined))
    : match.kind === "matched"
      ? match.contact
      : undefined,
);
const history = $derived(
  contact
    ? data.gigs
        .filter(
          (g) => g.contactIds?.includes(contact.id) && g.id !== item.gig?.id,
        )
        .sort((a, b) => b.date.localeCompare(a.date))
    : [],
);
let now = $state(Date.now());
let reply = $state("");
let loading = $state(false);
let failed = $state("");
const blocked = $derived(replyBlocked(conversation, now, humanAgent));
const tagged = $derived(
  humanAgent && !blocked && needsHumanAgentTag(conversation, now),
);
let headerSubject = $state<string | undefined>();
let latestBody = $state("");
let latestLang = $state<string | undefined>();
/** Keeps the translate control mounted while thread data refreshes for this item. */
let pinnedLatest = $state<{ id: string; body: string } | undefined>();
$effect(() => {
  const id = item.id;
  if (!beginMessageDetailConversation(id)) return;
  pinnedLatest = undefined;
  headerSubject = untrack(() => conversation.subject);
});
$effect(() => {
  const incoming = latest;
  if (!incoming) return;
  pinnedLatest = { id: incoming.id, body: incoming.object.content };
});
/** The newest incoming message, pinned so its translate control survives a thread refresh. */
const shownLatest = $derived(
  pinnedLatest ??
    (latest ? { id: latest.id, body: latest.object.content } : undefined),
);
const address = $derived(
  conversation.channel === "instagram"
    ? `@${conversation.peer.id.replace(/^@/, "")}`
    : conversation.channel === "email"
      ? conversation.peer.id
      : `Messenger${conversation.peer.name ? ` · ${conversation.peer.name}` : ""}`,
);
const stateTag = $derived(
  item.state === "toSort"
    ? { kind: "accent" as const, label: "To sort" }
    : item.state === "archived"
      ? { kind: "neutral" as const, label: "Not a booking" }
      : item.state === "discarded"
        ? { kind: "neutral" as const, label: "Discarded" }
        : undefined,
);
$effect(() => {
  const id = item.id;
  threads.active = id;
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
  const timer = setInterval(() => {
    now = Date.now();
  }, 60000);
  return () => {
    clearInterval(timer);
    if (threads.active === id) threads.active = undefined;
  };
});
// Open at the newest message, like any chat.
let scroller = $state<HTMLElement>();
let thread = $state<HTMLElement>();
let seen = 0;
$effect(() => {
  const count = messages?.length ?? 0;
  if (count === seen) return;
  seen = count;
  void tick().then(() => {
    if (ui.phone) {
      if (item.state !== "toSort")
        window.scrollTo({ top: document.body.scrollHeight });
    } else if (scroller && thread) {
      // When the context cards follow the thread, stop at its last message.
      const end =
        compact && !item.gig
          ? thread.offsetTop + thread.offsetHeight
          : scroller.scrollHeight;
      scroller.scrollTop = end - scroller.clientHeight;
    }
  });
});

// Kept across a retry (this component is remounted per conversation, so
// these never leak to another item): a save that writes the record but then
// fails to reload must not create a second gig or contact on retry.
let pendingGigId: string | undefined;
let pendingContactId: string | undefined;
async function createEnquiry() {
  if (!quick || !found.date || !venue) {
    router.go(`${path("bookings", "new")}?from=${encodeURIComponent(item.id)}`);
    return;
  }
  const bandId = data.band.id;
  pendingGigId ??= crypto.randomUUID();
  const gigId = pendingGigId;
  // Stays in the conversation: the new gig shows beside the thread.
  await run(async () => {
    let contactId = prefill.contactId;
    if (!contactId && prefill.newContact) {
      pendingContactId ??= crypto.randomUUID();
      contactId = pendingContactId;
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
}
async function send(event: SubmitEvent) {
  event.preventDefault();
  const text = reply;
  if (!text.trim()) return;
  const ok = await run(() => sendReply(item.id, conversation.bandId, text));
  if (ok && reply === text) reply = "";
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  }
}
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
/** Below 1280px the context folds into the header and under the thread, as on a phone. */
const compact = $derived(ui.phone || ui.narrow);
const fullForm = $derived(
  `#/${path("bookings", "new")}?from=${encodeURIComponent(item.id)}`,
);
</script>

{#snippet attachments(list: Attachment[] | undefined)}
  {#each list ?? [] as attachment (attachment.url)}
    {#await threads.fileUrl(attachment)}
      <p class="muted">Loading attachment…</p>
    {:then url}
      {#if (attachment.mediaType ?? attachment.type).startsWith("image")}
        <img src={url} alt={attachment.name ?? "Attachment"}>
      {:else}
        <!-- Always a download: a blob URL shares the app origin, so stored HTML must never render. -->
        <a class="file" href={url} download={attachment.name ?? ""}
          >{attachment.name ?? attachment.type}</a
        >
      {/if}
    {:catch}
      <p class="muted">Attachment unavailable.</p>
    {/await}
  {/each}
{/snippet}

{#snippet gigCard(gig: Gig)}
  {@const gigVenue = venueOf(gig, data.venues)}
  {@const summary = availabilitySummary(gig, data.members)}
  {@const fee = feeText(gig, data.band.currency ?? "EUR")}
  <section class="card ctx" aria-label="Gig">
    <div class="ctx-head">
      <h3><Icon name="calendar" size={15} />Gig</h3>
      <Tag kind={gig.status}>{capitalize(gig.status)}</Tag>
    </div>
    <a
      class="gig-title"
      href={`#/${path("bookings", "gig", data.band.id, gig.id)}`}
      >{gig.title}</a
    >
    <dl class="facts">
      <div>
        <dt>When</dt>
        <dd>{longDate(gig.date)}</dd>
      </div>
      {#if gigVenue || gig.venue}
        <div>
          <dt>Where</dt>
          <dd>
            {gigVenue?.name ?? gig.venue}{gigVenue?.city
              ? `, ${gigVenue.city}`
              : ""}
          </dd>
        </div>
      {/if}
      {#if gig.loadIn}
        <div>
          <dt>Load-in</dt>
          <dd>{gig.loadIn}</dd>
        </div>
      {/if}
      {#if gig.soundcheck}
        <div>
          <dt>Soundcheck</dt>
          <dd>{gig.soundcheck}</dd>
        </div>
      {/if}
      {#if gig.setTimes?.length}
        <div>
          <dt>Set</dt>
          <dd>
            {gig.setTimes.join(", ")}{gig.setLength
              ? ` · ${gig.setLength} min`
              : ""}
          </dd>
        </div>
      {/if}
      <div>
        <dt>Fee</dt>
        <dd class="with-tag">
          {fee ?? "Not agreed yet"}
          <Tag kind="private">Private</Tag>
        </dd>
      </div>
      {#if data.members.length && gig.status !== "cancelled"}
        <div>
          <dt>Band</dt>
          <dd class:alert-text={summary.alert}>{summary.line}</dd>
        </div>
      {/if}
    </dl>
    <a
      class="btn btn-secondary btn-block"
      href={`#/${path("bookings", "gig", data.band.id, gig.id)}`}
      >Open gig <Icon name="arrow-right" /></a
    >
  </section>
{/snippet}

{#snippet sortCard()}
  <section class="card ctx draft" aria-label="Booking details">
    <div class="ctx-head">
      <h3><Icon name="sparkles" size={15} />Looks like a booking</h3>
    </div>
    <dl class="facts">
      <div>
        <dt>Title</dt>
        <dd>{prefill.title}</dd>
      </div>
      <div>
        <dt>Date</dt>
        <dd class:muted={!found.date}>
          {found.date ? shortDate(found.date) : "Not found"}
        </dd>
      </div>
      <div>
        <dt>Venue</dt>
        <dd class:muted={!venue && !found.newVenue}>
          {#if venue}
            {venue.name}{venue.city ? `, ${venue.city}` : ""}
          {:else if found.newVenue}
            {found.newVenue} <span class="hint">new</span>
          {:else}
            Not found
          {/if}
        </dd>
      </div>
      {#if found.fee || found.sets || found.start || found.doors}
        <div>
          <dt>Also</dt>
          <dd>
            {[
              found.fee && money(found.fee.amount, found.fee.currency),
              found.sets &&
                `${found.sets} ${found.sets === 1 ? "set" : "sets"}`,
              found.start && `start ${found.start}`,
              found.doors && `doors ${found.doors}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </dd>
        </div>
      {/if}
    </dl>
    <p class="fine">
      Filled in from the message. Check before saving.
      {#if missing.length}
        The form opens to add the {missing.join(" and ")}.
      {/if}
    </p>
    <div class="ctx-actions">
      <button
        type="button"
        class="btn btn-primary btn-block"
        disabled={ui.busy || loading || !!failed}
        onclick={createEnquiry}
      >
        {quick ? "Add as gig" : "Review and add"}
        <Icon name="arrow-right" stroke={2.5} />
      </button>
      {#if quick}
        <a class="btn btn-ghost" href={fullForm}>Edit details first</a>
      {/if}
    </div>
    <div class="ctx-secondary">
      {#if item.state === "toSort"}
        <button
          type="button"
          class="btn btn-ghost"
          disabled={ui.busy}
          onclick={() =>
            run(() => bands.archiveConversation(data.band.id, item.id))}
        >
          <Icon name="archive" />Not a booking
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-danger"
          disabled={ui.busy}
          onclick={() =>
            run(() => bands.discardConversation(data.band.id, item.id))}
        >
          <Icon name="trash" />Discard
        </button>
      {:else if item.state === "archived"}
        <button
          type="button"
          class="btn btn-ghost"
          disabled={ui.busy}
          onclick={() =>
            run(() => bands.unarchiveConversation(data.band.id, item.id))}
        >
          <Icon name="undo" />Back to sort
        </button>
      {:else if item.state === "discarded"}
        <button
          type="button"
          class="btn btn-ghost"
          disabled={ui.busy}
          onclick={() =>
            run(() => bands.undiscardConversation(data.band.id, item.id))}
        >
          <Icon name="undo" />Restore to sort
        </button>
      {/if}
    </div>
  </section>
{/snippet}

{#snippet contactCard()}
  <section class="card ctx" aria-label="Contact">
    <div class="ctx-head">
      <h3><Icon name="user" size={15} />Contact</h3>
      <Tag kind="private">Private</Tag>
    </div>
    {#if contact}
      <a class="gig-title" href={`#/${path("contacts", contact.id)}`}
        >{contact.name}</a
      >
      {#if !item.gig && match.kind === "matched"}
        <p class="fine ok">
          <Icon name="check" size={13} stroke={2.5} />{match.reason}
        </p>
      {/if}
      <dl class="facts">
        {#if contact.email}
          <div>
            <dt>Email</dt>
            <dd><a href={`mailto:${contact.email}`}>{contact.email}</a></dd>
          </div>
        {/if}
        {#if contact.phone}
          <div>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${contact.phone.replace(/\s/g, "")}`}
                >{contact.phone}</a
              >
            </dd>
          </div>
        {/if}
        {#if contact.instagram}
          <div>
            <dt>Instagram</dt>
            <dd>@{contact.instagram.replace(/^@/, "")}</dd>
          </div>
        {/if}
        {#if contact.notes?.trim()}
          <div>
            <dt>Notes</dt>
            <dd class="pre">{contact.notes}</dd>
          </div>
        {/if}
      </dl>
      {#if history.length}
        <p class="sub-head">
          {history.length === 1
            ? "1 other gig together"
            : `${history.length} other gigs together`}
        </p>
        <ul class="history">
          {#each history.slice(0, 4) as gig (gig.id)}
            <li>
              <a href={`#/${path("bookings", "gig", data.band.id, gig.id)}`}>
                <span class="ellipsis">{gig.title}</span>
                <span class="muted">{mediumDate(gig.date)}</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if match.kind === "ambiguous"}
      <p class="gig-title">Might be someone you know</p>
      <p class="fine">
        {match.suggestions
          .slice(0, 3)
          .map((s) => s.contact.name)
          .join(", ")}{match.suggestions.length > 3 ? "…" : ""}. Choose one in
        the form, or save the sender as a new contact.
      </p>
    {:else}
      <p class="gig-title">{prefill.newContact?.name ?? name}</p>
      <p class="fine">
        New sender. Adding this as a gig also saves them as a contact.
      </p>
    {/if}
  </section>
{/snippet}

{#snippet context()}
  {#if item.gig}
    {@render gigCard(item.gig)}
  {:else}
    {@render sortCard()}
  {/if}
  {@render contactCard()}
{/snippet}

<div class="conv">
  <div class="main-col">
    <header class="conv-head">
      {#if ui.phone}
        <button
          type="button"
          class="back"
          aria-label="Back to inbox"
          onclick={() => router.back("inbox")}
        >
          <Icon name="chevron-left" size={24} />
        </button>
      {/if}
      <span class="avatar" aria-hidden="true">
        {initials}
        <span class="badge"
          ><ChannelIcon channel={conversation.channel} size={12} /></span
        >
      </span>
      <div class="who">
        <h2>{name}</h2>
        <p class="meta">
          <span class="ellipsis"
            >{channelName[conversation.channel]}
            · {address}</span
          >
        </p>
        {#if headerSubject ?? conversation.subject}
          <p class="subject">{headerSubject ?? conversation.subject}</p>
        {/if}
      </div>
      <div class="head-side">
        {#if stateTag}
          <Tag kind={stateTag.kind}>{stateTag.label}</Tag>
        {/if}
        <span class="when"
          >{messageTimeLong(conversation.lastIn ?? item.latest)}</span
        >
      </div>
      {#if compact && item.gig}
        <details class="peek">
          <summary>
            <span class="peek-icon"><Icon name="calendar" size={16} /></span>
            <span class="peek-text">
              <strong class="ellipsis">{item.gig.title}</strong>
              <span class="muted">{shortDate(item.gig.date)}</span>
            </span>
            <Tag kind={item.gig.status}>{capitalize(item.gig.status)}</Tag>
            <Icon name="chevron-down" />
          </summary>
          <div class="peek-body">{@render context()}</div>
        </details>
      {/if}
    </header>

    <div class="scroll" bind:this={scroller}>
      <ol class="thread" aria-label="Messages" bind:this={thread}>
        {#if !messages?.length}
          <li class="bubble in">
            <div class="text">
              <p class="pre">
                {#if loading}
                  <span class="muted">Loading…</span>
                {:else}
                  {conversation.preview}
                {/if}
              </p>
            </div>
          </li>
        {/if}
        {#each messages ?? [] as message, i (message.id)}
          {@const isLatest = message.id === shownLatest?.id}
          {@const prev = messages?.[i - 1]}
          {#if !prev ||
            prev.published.slice(0, 10) !== message.published.slice(0, 10)}
            <li class="day" aria-hidden="true">
              <span>{mediumDate(message.published.slice(0, 10))}</span>
            </li>
          {/if}
          <li
            class="bubble {message.direction}"
            class:latest={isLatest}
            class:failed={!!message.error}
          >
            <div class="text">
              {#if isLatest && conversation.channel === "email" && shownLatest}
                <p class="pre" lang={latestLang}>
                  {latestBody || shownLatest.body}
                </p>
                <div class="translate-slot">
                  {#key shownLatest.id}
                    <IncomingEmailText
                      messageId={shownLatest.id}
                      conversationId={item.id}
                      subject={conversation.subject}
                      body={shownLatest.body}
                      showSubject
                      separateControl
                      bind:displayBody={latestBody}
                      bind:contentLang={latestLang}
                      onSubject={(value) => {
                        headerSubject = value;
                      }}
                    />
                  {/key}
                </div>
              {:else if message.direction === "in" &&
                message.channel === "email"}
                <IncomingEmailText
                  messageId={message.id}
                  body={message.object.content}
                />
              {:else}
                <p class="pre">{message.object.content}</p>
              {/if}
              {@render attachments(message.object.attachment)}
            </div>
            <p class="stamp">
              {message.direction === "out" ? "You · " : ""}{clock(
                message.published,
              )}
            </p>
            {#if message.error}
              <p class="alert-text">Not delivered: {message.error}</p>
            {/if}
          </li>
        {/each}
      </ol>
      {#if failed}
        <p class="alert-text load-failed" role="alert">{failed}</p>
      {/if}
      {#if compact && !item.gig}
        <div class="phone-context">{@render context()}</div>
      {/if}
    </div>

    <form class="composer no-print" onsubmit={send}>
      <label class="sr-only" for="reply-text"
        >Reply via {channelName[conversation.channel]}</label
      >
      <div class="compose-box" class:disabled={!!blocked}>
        <textarea
          id="reply-text"
          bind:value={reply}
          rows="2"
          required
          placeholder={blocked
            ? "Replies are closed for this conversation"
            : `Reply to ${contact ? contact.name.split(" ")[0] : name} by ${channelName[conversation.channel].toLowerCase()}…`}
          disabled={ui.busy || !!blocked}
          onkeydown={keydown}
        ></textarea>
        <button
          type="submit"
          class="btn btn-primary send"
          disabled={ui.busy || !!blocked || !reply.trim()}
        >
          <Icon name="send" />
          Send
        </button>
      </div>
      {#if blocked}
        <p class="field-hint" role="status">{blocked}</p>
      {:else if tagged}
        <p class="field-hint" role="status">
          More than 24 hours since their last message: this reply goes out with
          Meta's human agent tag, which allows a person to answer within 7 days.
          Automated messages are not permitted.
        </p>
      {/if}
    </form>
  </div>

  {#if !compact}
    <aside class="context" aria-label="About this conversation">
      {@render context()}
    </aside>
  {/if}
</div>

<style>
.conv {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  flex: 1;
  min-height: 0;
}
.main-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.conv-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 18px 24px;
  border-bottom: var(--rule);
}
.avatar {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--color-accent-100);
  color: var(--color-accent-700);
  font-weight: 600;
  font-size: 15px;
}
.badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--color-surface);
  box-shadow: 0 0 0 1px var(--color-divider);
}
.who {
  flex: 1;
  min-width: 0;
}
.who h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.3;
}
.who p {
  margin: 0;
}
.meta {
  display: flex;
  font-size: 13px;
  color: var(--muted);
}
.who p.subject {
  margin-top: 4px;
  font-size: 14px;
  font-weight: 500;
}
.head-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex: none;
}
.when {
  font-size: 12px;
  color: var(--faint);
}
.scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--color-bg);
}
.thread {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 24px 16px;
}
.day {
  display: flex;
  justify-content: center;
}
.day span {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--color-sunken);
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
}
.bubble {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: min(600px, 86%);
}
.bubble .text {
  padding: 12px 16px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.55;
}
.bubble .text :global(p) {
  margin: 0;
}
.bubble.in {
  align-self: flex-start;
}
.bubble.in .text {
  background: var(--color-surface);
  border: 1px solid var(--color-divider);
  border-bottom-left-radius: 6px;
  box-shadow: var(--shadow-sm);
}
.bubble.out {
  align-self: flex-end;
  align-items: flex-end;
}
.bubble.out .text {
  background: var(--color-accent-600);
  color: var(--on-accent);
  border-bottom-right-radius: 6px;
}
.bubble.out.failed .text {
  background: var(--color-danger-bg);
  color: var(--color-danger);
}
.bubble img {
  margin-top: 10px;
  border-radius: 10px;
  max-width: 100%;
}
.file {
  display: inline-block;
  margin-top: 8px;
  color: inherit;
}
.stamp {
  margin: 0 6px;
  font-size: 11px;
  color: var(--faint);
}
.translate-slot {
  margin: 8px 0 -4px;
}
.load-failed {
  padding: 0 24px;
}
.composer {
  flex: none;
  padding: 12px 24px 16px;
  border-top: var(--rule);
  background: var(--color-surface);
}
.compose-box {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-width: 760px;
  margin: 0 auto;
  padding: 6px 6px 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}
.compose-box:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 20%, transparent);
}
.compose-box.disabled {
  background: var(--color-surface-2);
}
textarea {
  flex: 1;
  min-height: 44px;
  max-height: 200px;
  padding: 8px 0;
  border: 0;
  outline: none;
  resize: none;
  field-sizing: content;
  background: transparent;
  font-size: 14px;
  line-height: 1.5;
}
textarea::placeholder {
  color: var(--faint);
}
.composer .field-hint {
  max-width: 760px;
  margin: 8px auto 0;
}
.context {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  border-left: var(--rule);
  background: var(--color-bg);
}
.ctx {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}
.ctx-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ctx-head h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}
.draft {
  border-color: var(--color-accent-300);
}
.draft .ctx-head h3 {
  color: var(--color-accent-700);
}
.gig-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  text-decoration: none;
}
a.gig-title:hover {
  color: var(--color-accent-700);
}
.facts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}
.facts div {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 8px;
  font-size: 13px;
}
.facts dt {
  color: var(--muted);
}
.facts dd {
  margin: 0;
  min-width: 0;
}
.facts a {
  color: var(--color-text);
  text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
}
.facts a:hover {
  color: var(--color-accent-700);
}
.with-tag {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.hint {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-accent-700);
  background: var(--color-accent-100);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
}
.fine {
  display: flex;
  gap: 6px;
  align-items: baseline;
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.fine :global(svg) {
  align-self: center;
}
.fine.ok {
  color: var(--color-success);
}
.ctx-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ctx-actions .btn-block {
  margin: 0;
}
.ctx-secondary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: 8px;
  border-top: var(--rule);
}
.ctx .btn-block {
  margin-top: 4px;
}
.ctx-secondary .btn-danger {
  margin-left: auto;
}
.sub-head {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.history {
  display: flex;
  flex-direction: column;
}
.history a {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  border-top: var(--rule);
  font-size: 13px;
  color: inherit;
  text-decoration: none;
}
.history a:hover {
  color: var(--color-accent-700);
}
.phone-context {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 var(--pad) 16px;
}
.back {
  display: grid;
  place-items: center;
  width: 36px;
  height: 44px;
  margin: 0 -6px 0 -8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-accent-600);
}
.peek {
  grid-column: 1 / -1;
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}
.peek summary {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 8px 12px;
  list-style: none;
  cursor: pointer;
}
.peek summary::-webkit-details-marker {
  display: none;
}
.peek[open] summary > :global(svg:last-child) {
  transform: rotate(180deg);
}
.peek-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--color-accent-100);
  color: var(--color-accent-700);
}
.peek-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.3;
}
.peek-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 60dvh;
  overflow: auto;
  padding: 0 8px 8px;
}
.peek-body :global(.card) {
  box-shadow: none;
}
@media (max-width: 1279px) {
  .conv {
    grid-template-columns: minmax(0, 1fr);
  }
  .conv-head {
    flex-wrap: wrap;
  }
  .peek {
    flex-basis: 100%;
  }
}
@media (max-width: 899px) {
  .conv {
    display: block;
  }
  .conv-head {
    position: sticky;
    top: 0;
    z-index: 5;
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 8px var(--pad) 10px;
    background: var(--color-surface);
    box-shadow: 0 1px 0 var(--color-divider);
  }
  .conv-head .avatar {
    width: 36px;
    height: 36px;
    font-size: 13px;
  }
  .conv-head .badge {
    width: 18px;
    height: 18px;
  }
  .who h2 {
    font-size: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    min-width: 0;
  }
  .who p.subject {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .head-side .when {
    display: none;
  }
  .scroll {
    overflow: visible;
    min-height: calc(100dvh - 240px);
  }
  .thread {
    padding: 16px var(--pad);
  }
  .bubble {
    max-width: 90%;
  }
  .composer {
    position: sticky;
    bottom: 0;
    z-index: 4;
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
    background: var(--color-surface);
  }
  .send {
    width: 44px;
    padding: 0;
    font-size: 0;
    gap: 0;
  }
  textarea {
    font-size: 16px;
  }
}
</style>
