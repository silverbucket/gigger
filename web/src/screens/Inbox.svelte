<script lang="ts">
import { untrack } from "svelte";
import Icon from "../components/Icon.svelte";
import ListDetailLayout from "../components/ListDetailLayout.svelte";
import MessageRow from "../components/MessageRow.svelte";
import Segmented from "../components/Segmented.svelte";
import Tag from "../components/Tag.svelte";
import { api } from "../lib/account.svelte";
import { data } from "../lib/data.svelte";
import { capitalize, messageTime, normalize, shortDate } from "../lib/format";
import { type InboxItem, inboxItems, matchSender } from "../lib/inbox";
import {
  aggregateBookingsInboxStatus,
  bookingsInboxLabel,
  bookingsInboxTagKind,
  type MailWatchAccount,
  refreshBookingsMailByBand,
} from "../lib/inbox-watch";
import { messageStream } from "../lib/message-stream.svelte";
import {
  clearInboxLangUiOnConversationOpen,
  resetInboxLangOpenTracking,
} from "../lib/message-translate-ui-session";
import { senderName } from "../lib/messages.svelte";
import { path, router } from "../lib/router.svelte";
import Conversation from "./Conversation.svelte";

let { humanAgent = false }: { humanAgent?: boolean } = $props();

type Filter = "toSort" | "booked" | "set-aside" | "all";
let filter = $state<Filter>("toSort");
let query = $state("");

const items = $derived(
  inboxItems(
    data.conversations,
    data.inView.map((b) => b.band.id),
    data.inView.flatMap((b) => b.gigs),
    data.inView.flatMap((b) => b.triage),
  ),
);
const bandOf = (bandId: string) => data.band(bandId);
const needle = $derived(normalize(query));
function matches(item: InboxItem) {
  if (!needle) return true;
  const c = item.conversation;
  return normalize(
    [
      senderName(c, bandOf(c.bandId)),
      c.peer.id,
      c.peer.name ?? "",
      c.subject ?? "",
      c.preview,
      item.gig?.title ?? "",
    ].join(" "),
  ).includes(needle);
}
const inFilter = (item: InboxItem, f: Filter) =>
  f === "all" ||
  (f === "toSort" && item.state === "toSort") ||
  (f === "booked" && item.state === "converted") ||
  (f === "set-aside" &&
    (item.state === "archived" || item.state === "discarded"));
const counts = $derived({
  toSort: items.filter((i) => i.state === "toSort").length,
  booked: items.filter((i) => i.state === "converted").length,
});
// A search looks through every conversation, whatever the filter.
const shown = $derived(
  items.filter((i) => (needle ? true : inFilter(i, filter)) && matches(i)),
);

const id = $derived(router.parts[0] ?? "");
const open = $derived(items.find((i) => i.id === id));
// The list always shows the open conversation: opening one from a gig
// switches to the filter that holds it.
let followed = "";
$effect(() => {
  const item = open;
  if (!item || followed === item.id) return;
  followed = item.id;
  if (
    !inFilter(
      item,
      untrack(() => filter),
    )
  )
    filter =
      item.state === "toSort"
        ? "toSort"
        : item.state === "converted"
          ? "booked"
          : "set-aside";
});
$effect(() => {
  const openId = open?.id;
  if (!openId) {
    resetInboxLangOpenTracking();
    return;
  }
  clearInboxLangUiOnConversationOpen(openId);
});

let mailByBand = $state<Record<string, MailWatchAccount>>({});
$effect(() => {
  const bandIds = data.inView.map((item) => item.band.id);
  if (router.screen !== "inbox" || bandIds.length === 0) return;
  let cancelled = false;
  const refresh = async () => {
    const next = await refreshBookingsMailByBand(
      mailByBand,
      bandIds,
      (bandId) =>
        api<Omit<MailWatchAccount, "bandId"> | null>("/api/email/account", {
          query: { bandId },
        }),
    );
    if (!cancelled) mailByBand = next;
  };
  void refresh();
  const timer = setInterval(refresh, 5000);
  return () => {
    cancelled = true;
    clearInterval(timer);
  };
});
const inboxWatch = $derived(
  aggregateBookingsInboxStatus(
    Object.values(mailByBand),
    messageStream.retrying,
  ),
);
function openEmailSettings(event: MouseEvent) {
  event.preventDefault();
  if (inboxWatch.bandId && !data.current) data.choose(inboxWatch.bandId);
  router.go("settings");
}

function note(item: InboxItem) {
  if (item.gig)
    return {
      note: `${item.gig.title} · ${shortDate(item.gig.date)}`,
      noteKind: "ink" as const,
      noteTag: { kind: item.gig.status, label: capitalize(item.gig.status) },
    };
  if (item.state === "archived")
    return { note: "Not a booking", noteKind: "muted" as const };
  if (item.state === "discarded")
    return { note: "Discarded", noteKind: "muted" as const };
  const match = matchSender(
    item.conversation,
    bandOf(item.conversation.bandId)?.contacts ?? [],
  );
  return match.kind === "matched"
    ? { note: `From ${match.contact.name}`, noteKind: "muted" as const }
    : match.kind === "ambiguous"
      ? { note: "Might be a contact you know", noteKind: "muted" as const }
      : { note: "New sender", noteKind: "muted" as const };
}
const emptyText = $derived(
  needle
    ? "No conversations match that search."
    : filter === "toSort"
      ? "All sorted. New messages from email, Instagram and Messenger land here."
      : filter === "booked"
        ? "Conversations you turn into gigs stay here."
        : filter === "set-aside"
          ? "Messages marked not a booking or discarded show here."
          : "No conversations yet. Connect email or Meta in Settings.",
);
</script>

<ListDetailLayout inbox fill open={!!id} key={id}>
  {#snippet list()}
    <div class="list">
      <div class="tools">
        <label class="search">
          <span class="sr-only">Search conversations</span>
          <Icon name="search" />
          <input
            class="input"
            type="search"
            placeholder="Search people, subjects, gigs"
            bind:value={query}
          >
        </label>
        <Segmented
          label="Show"
          options={[
            {
              value: "toSort",
              label: counts.toSort ? `To sort ${counts.toSort}` : "To sort",
            },
            { value: "booked", label: "With gig" },
            { value: "set-aside", label: "Set aside" },
            { value: "all", label: "All" },
          ]}
          bind:value={filter}
        />
        {#if inboxWatch.status !== "hidden"}
          <a
            href="#/settings"
            class="watch"
            aria-live="polite"
            onclick={openEmailSettings}
          >
            <Tag kind={bookingsInboxTagKind(inboxWatch.status)}
              >{bookingsInboxLabel(inboxWatch.status)}</Tag
            >
          </a>
        {/if}
        {#if inboxWatch.status === "error"}
          <p class="watch-alert" role="alert">
            New email may not arrive.
            <a href="#/settings" onclick={openEmailSettings}
              >Open email settings</a
            >
            to fix this.
          </p>
        {/if}
      </div>
      {#if needle}
        <p class="search-note">
          Searching all conversations · {shown.length}
          {shown.length === 1 ? "result" : "results"}
        </p>
      {/if}
      <ul class="rows">
        {#each shown as item (item.id)}
          {@const c = item.conversation}
          {@const n = note(item)}
          <MessageRow
            href={`#/${path("inbox", item.id)}`}
            channel={c.channel}
            sender={senderName(c, bandOf(c.bandId))}
            subject={c.subject}
            preview={c.preview}
            time={messageTime(item.latest)}
            note={n.note}
            noteKind={n.noteKind}
            noteTag={n.noteTag}
            selected={item.id === id}
            unread={item.state === "toSort"}
          />
        {:else}
          <li class="empty">{emptyText}</li>
        {/each}
      </ul>
    </div>
  {/snippet}
  {#snippet detail()}
    {#if open}
      {@const band = bandOf(open.conversation.bandId)}
      {#if band}
        <!-- Keyed so an unsent reply draft never follows you to another conversation. -->
        {#key open.id}
          <Conversation item={open} data={band} {humanAgent} />
        {/key}
      {/if}
    {:else if id && data.loaded}
      <p class="empty">
        This conversation isn't here any more. It may have been removed on
        another device.
      </p>
    {:else}
      <div class="placeholder">
        <span class="placeholder-icon"><Icon name="inbox" size={28} /></span>
        <p>Choose a conversation to read it.</p>
        {#if counts.toSort}
          <p class="muted">
            {counts.toSort}
            {counts.toSort === 1 ? "message needs" : "messages need"}
            sorting.
          </p>
        {/if}
      </div>
    {/if}
  {/snippet}
</ListDetailLayout>

<style>
.list {
  max-width: 760px;
  padding-bottom: 24px;
}
.tools {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 16px 12px;
  background: var(--color-surface);
}
.tools :global(.seg) {
  display: grid;
  grid-template-columns: repeat(4, auto);
}
.search {
  position: relative;
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
.watch {
  align-self: flex-start;
  text-decoration: none;
}
.watch-alert {
  margin: 0;
  font-size: 13px;
  color: var(--color-danger);
}
.search-note {
  margin: 0;
  padding: 0 24px 8px;
  font-size: 12px;
  color: var(--muted);
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
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
  text-align: center;
  color: var(--muted);
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
@media (max-width: 899px) {
  .list {
    padding-bottom: calc(var(--tabbar) + 24px);
  }
  .tools {
    position: static;
    padding: 12px var(--pad);
    background: transparent;
  }
  .rows :global(.row) {
    margin: 0 4px;
  }
}
</style>
