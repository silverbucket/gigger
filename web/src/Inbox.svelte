<script lang="ts">
import {
  type Attachment,
  type Contact,
  type Conversation,
  type ConversationIndex,
  type Gig,
  type Message,
  messagePeer,
  needsHumanAgentTag,
  replyBlocked,
} from "@gigger/schemas";
import { onMount } from "svelte";
import { bands, storage } from "./storage";

export interface InboxEnquiry {
  conversationId: string;
  enquiryText: string;
  enquirySource: Conversation["channel"];
  contactId?: string;
}
let {
  summaries,
  bandId,
  humanAgent = false,
  onopengig,
  oncreategig,
}: {
  summaries: {
    band: { id: string; name: string };
    gigs: Gig[];
    contacts: Contact[];
  }[];
  bandId: string;
  /** The server sends Meta replies older than 24 hours with the HUMAN_AGENT tag. */
  humanAgent?: boolean;
  onopengig: (bandId: string, gigId: string) => void;
  oncreategig: (bandId: string, enquiry: InboxEnquiry) => void;
} = $props();
let index = $state<ConversationIndex>({});
let opened = $state("");
let messages = $state<Message[]>([]);
let reply = $state("");
let busy = $state(false);
let error = $state("");
let now = $state(Date.now());
let files = $state<Record<string, string>>({});
let thread = $derived(index[opened]);
let blocked = $derived(thread ? replyBlocked(thread, now, humanAgent) : "");
let tagged = $derived(
  !!thread && humanAgent && !blocked && needsHumanAgentTag(thread, now),
);
function contactFor(conversation: Conversation) {
  return summaries
    .find((s) => s.band.id === conversation.bandId)
    ?.contacts.find((c) =>
      [c.messenger, c.instagram, c.email].includes(conversation.peer.id),
    );
}
/** Conversations grouped by the matching contact, or by the peer when no contact lists that handle. */
let groups = $derived.by(() => {
  const byKey = new Map<
    string,
    { label: string; rows: { id: string; conversation: Conversation }[] }
  >();
  for (const [id, conversation] of Object.entries(index)) {
    if (bandId && conversation.bandId !== bandId) continue;
    const contact = contactFor(conversation);
    const key = contact
      ? `contact:${contact.id}`
      : `peer:${conversation.peer.id}`;
    const label =
      contact?.name ?? conversation.peer.name ?? conversation.peer.id;
    const group = byKey.get(key) ?? { label, rows: [] };
    group.rows.push({ id, conversation });
    byKey.set(key, group);
  }
  const latest = (c: Conversation) =>
    [c.lastIn ?? "", c.lastOut ?? ""].sort().at(-1) ?? "";
  return [...byKey.values()]
    .map((group) => ({
      ...group,
      rows: group.rows.sort((a, b) =>
        latest(b.conversation).localeCompare(latest(a.conversation)),
      ),
    }))
    .sort((a, b) =>
      latest(b.rows[0].conversation).localeCompare(
        latest(a.rows[0].conversation),
      ),
    );
});
let linkedGig = $derived(
  summaries
    .find((s) => s.band.id === thread?.bandId)
    ?.gigs.find((g) => g.conversationId === opened),
);
async function load() {
  const requested = opened;
  const [conversations, thread] = await Promise.all([
    bands.conversations(),
    requested ? bands.messages(requested) : [],
  ]);
  index = conversations;
  // A slower read for a thread that was closed or swapped must not land in the new one.
  if (requested && requested === opened) messages = thread;
  now = Date.now();
}
$effect(() => {
  if (thread && bandId && thread.bandId !== bandId) opened = "";
});
async function run(action: () => Promise<void>) {
  busy = true;
  error = "";
  try {
    await action();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Could not load messages.";
  } finally {
    busy = false;
  }
}
function open(id: string) {
  opened = id;
  reply = "";
  messages = [];
  void run(load);
}
async function send(event: SubmitEvent) {
  event.preventDefault();
  if (!thread || !reply.trim()) return;
  const target = opened;
  const text = reply;
  await run(async () => {
    const { userAddress, token } = storage.remote;
    const username = decodeURIComponent(
      userAddress.slice(0, userAddress.lastIndexOf("@")),
    );
    const response = await fetch("/api/messages/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        username,
        bandId: thread.bandId,
        conversation: target,
        text,
      }),
    });
    const result = await response.json();
    // Another thread may have been opened meanwhile; only clear the draft we sent.
    if (response.ok && opened === target && reply === text) reply = "";
    // A 502 means the message was saved but not delivered; show it with its error.
    if (response.ok || response.status === 502) {
      await storage.startSync();
      await load();
    }
    if (!response.ok)
      throw new Error(result.error ?? "Could not send. Please retry.");
  });
}
function createGig() {
  if (!thread) return;
  const lastIn = [...messages].reverse().find((m) => m.direction === "in");
  oncreategig(thread.bandId, {
    conversationId: opened,
    enquiryText: lastIn?.object.content ?? thread.preview,
    enquirySource: thread.channel,
    contactId: contactFor(thread)?.id,
  });
}
/** Copied attachments live in private storage, so they are read through remoteStorage, not a URL. */
async function fileUrl(attachment: Attachment) {
  if (!attachment.url.startsWith("gigger/")) return attachment.url;
  if (!files[attachment.url]) {
    const file = (await storage
      .scope("/gigger/")
      .getFile(attachment.url.slice(7))) as {
      data: BlobPart;
      mimeType: string;
    };
    files[attachment.url] = URL.createObjectURL(
      new Blob([file.data], { type: file.mimeType }),
    );
  }
  return files[attachment.url];
}
onMount(() => {
  void run(load);
  const scope = storage.scope("/gigger/conversations/");
  // One refresh per sync, as Bookings does, instead of one per synced document.
  let dirty = false;
  const changed = () => {
    dirty = true;
  };
  const synced = () => {
    if (!dirty) return;
    dirty = false;
    void load().catch(() => {});
  };
  scope.on("change", changed);
  storage.on("sync-done", synced);
  const tick = setInterval(() => {
    now = Date.now();
  }, 60000);
  return () => {
    scope.removeEventListener("change", changed);
    storage.removeEventListener("sync-done", synced);
    clearInterval(tick);
    for (const url of Object.values(files)) URL.revokeObjectURL(url);
  };
});
// One stream per account; it only says "sync now". Reopened whenever the band it is checked against changes.
$effect(() => {
  const streamBand = bandId || summaries[0]?.band.id;
  const { userAddress, token } = storage.remote;
  if (!streamBand || !userAddress.endsWith(`@${location.host}`)) return;
  const username = decodeURIComponent(
    userAddress.slice(0, userAddress.lastIndexOf("@")),
  );
  let events: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  // The stream is opened with a single-use ticket, so a dropped connection needs a new ticket, not a browser retry.
  const reopen = () => {
    if (!closed) retry = setTimeout(() => open().catch(reopen), 5000);
  };
  async function open() {
    const response = await fetch("/api/messages/ticket", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ username, bandId: streamBand }),
    });
    if (!response.ok) throw new Error("No ticket");
    const { ticket } = await response.json();
    if (closed) return;
    events = new EventSource(
      `/api/messages/events?${new URLSearchParams({ ticket })}`,
    );
    events.onmessage = () => void storage.startSync();
    // The ticket is spent, so the browser's own retry would only earn a 401; reopen with a new one instead.
    events.onerror = () => {
      events?.close();
      reopen();
    };
  }
  open().catch(reopen);
  return () => {
    closed = true;
    clearTimeout(retry);
    events?.close();
  };
});
</script>

<section aria-labelledby="inbox-title">
  <h2 id="inbox-title">Inbox</h2>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  {#if thread}
    <button type="button" class="text-button" onclick={() => (opened = "")}>
      ← All conversations
    </button>
    <h3>
      {contactFor(thread)?.name ?? thread.peer.name ?? thread.peer.id}
      <small>via {thread.channel}</small>
    </h3>
    <p>
      {#if linkedGig}
        <button
          type="button"
          onclick={() => onopengig(thread.bandId, linkedGig.id)}
        >
          Open gig: {linkedGig.title || linkedGig.date}
        </button>
      {:else}
        <button type="button" disabled={busy} onclick={createGig}>
          Create gig from this conversation
        </button>
      {/if}
    </p>
    <ol class="thread">
      {#each messages as message (message.id)}
        <li class={message.direction}>
          <p class="meta">
            {message.direction === "in"
              ? (messagePeer(message).name ?? messagePeer(message).id)
              : "You"}
            ·
            <time datetime={message.published}
              >{new Date(message.published).toLocaleString()}</time
            >
          </p>
          <p class="text">{message.object.content}</p>
          {#each message.object.attachment ?? [] as attachment (attachment.url)}
            {#await fileUrl(attachment)}
              <p>Loading attachment…</p>
            {:then url}
              {#if (attachment.mediaType ?? attachment.type).startsWith(
                "image",
              )}
                <img src={url} alt={attachment.name ?? "Attachment"}>
              {:else}
                <!-- Always a download: a blob URL shares the app origin, so stored HTML must never render. -->
                <a href={url} download={attachment.name ?? ""}>
                  {attachment.name ?? attachment.type}
                </a>
              {/if}
            {:catch}
              <p>Attachment unavailable.</p>
            {/await}
          {/each}
          {#if message.error}
            <p class="error">Not delivered: {message.error}</p>
          {/if}
        </li>
      {:else}
        <li>{busy ? "Loading…" : "No messages yet."}</li>
      {/each}
    </ol>
    <form onsubmit={send}>
      <label
        >Reply<textarea
          bind:value={reply}
          rows="3"
          required
          disabled={busy || !!blocked}
        ></textarea></label
      >
      <button type="submit" disabled={busy || !!blocked}>
        Send via {thread.channel}
      </button>
      {#if blocked}
        <p role="status">{blocked}</p>
      {:else if tagged}
        <p role="status">
          More than 24 hours since their last message: this reply goes out with
          Meta's human agent tag, which allows a person to answer within 7 days.
          Automated messages are not permitted.
        </p>
      {/if}
    </form>
  {:else}
    {#each groups as group (group.label + group.rows[0].id)}
      <h3>{group.label}</h3>
      <ul>
        {#each group.rows as row (row.id)}
          <li>
            <button type="button" class="row" onclick={() => open(row.id)}>
              <span class="channel">{row.conversation.channel}</span>
              {#if !bandId}
                ·
                {summaries.find((s) => s.band.id === row.conversation.bandId)
                  ?.band.name}
              {/if}
              <span class="preview">{row.conversation.preview}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p>
        {busy
          ? "Loading…"
          : "No conversations yet. Connect a Facebook Page in band settings to receive Messenger and Instagram messages here."}
      </p>
    {/each}
  {/if}
</section>

<style>
.thread {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}
.thread li {
  max-width: 80%;
  padding: 0.6rem 0.9rem;
  border-radius: 12px;
  background: #eef2ef;
}
.thread li.out {
  justify-self: end;
  background: #dcebe3;
}
.thread p {
  margin: 0;
}
.meta {
  font-size: 0.8rem;
  color: #4e5f58;
}
.text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
img {
  max-width: 100%;
  margin-top: 0.5rem;
  border-radius: 8px;
}
.row {
  width: 100%;
  text-align: left;
  background: transparent;
  color: inherit;
  border-color: #d4ddd7;
}
.channel {
  text-transform: capitalize;
  font-weight: 600;
}
.preview {
  display: block;
  color: #4e5f58;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
small {
  font-weight: 400;
  color: #4e5f58;
}
form {
  display: grid;
}
label {
  display: grid;
  gap: 0.4rem;
}
textarea,
button {
  font: inherit;
  border: 1px solid #82958a;
  border-radius: 6px;
  padding: 0.65rem;
}
button {
  background: #205b43;
  color: white;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
}
.text-button {
  background: transparent;
  color: #205b43;
  border: 0;
  padding: 0.3rem 0;
  text-decoration: underline;
}
.error {
  color: #902a20;
}
</style>
