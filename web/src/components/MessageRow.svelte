<script lang="ts">
import type { Channel } from "@showday/schemas";
import ChannelIcon from "./ChannelIcon.svelte";
import Tag, { type TagKind } from "./Tag.svelte";

/** A conversation in the inbox: who, which channel, the latest line, and what it became (a gig, not a booking, or still to sort). */
let {
  href,
  channel,
  sender,
  subject,
  preview,
  time,
  note,
  noteKind,
  noteTag,
  selected = false,
  unread = false,
}: {
  href: string;
  channel: Channel | "other";
  sender: string;
  subject?: string;
  preview: string;
  time: string;
  /** The line under the preview: the linked gig, or how the sender matches a contact. */
  note?: string;
  noteKind?: "accent" | "muted" | "ink";
  /** A status tag beside the note, e.g. the linked gig's status. */
  noteTag?: { kind: TagKind; label: string };
  selected?: boolean;
  /** Still to sort: shown with a dot and a bold name. */
  unread?: boolean;
} = $props();
const initials = $derived(
  sender
    .replace(/[@._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?",
);
</script>

<li>
  <a
    class="row"
    class:selected
    class:unread
    {href}
    aria-current={selected ? "true" : undefined}
  >
    <span class="avatar" aria-hidden="true">
      {initials}
      <span class="badge"><ChannelIcon {channel} size={11} /></span>
    </span>
    <span class="top">
      <span class="sender ellipsis">{sender}</span>
      <span class="time">{time}</span>
    </span>
    <span class="preview">
      {#if subject}
        <span class="subject">{subject}</span>
        ·
      {/if}
      {preview}
    </span>
    {#if note || noteTag}
      <span class="note {noteKind ?? "muted"}">
        {#if noteTag}
          <Tag kind={noteTag.kind}>{noteTag.label}</Tag>
        {/if}
        {#if note}
          <span class="ellipsis">{note}</span>
        {/if}
      </span>
    {/if}
    {#if unread}
      <span class="sr-only">To sort</span>
    {/if}
  </a>
</li>

<style>
.row {
  position: relative;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  grid-template-areas:
    "avatar top"
    "avatar preview"
    "avatar note";
  column-gap: 12px;
  row-gap: 2px;
  padding: 12px 16px 12px 18px;
  margin: 0 8px;
  border-radius: var(--radius-lg);
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
.unread::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 26px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-accent-600);
}
.avatar {
  grid-area: avatar;
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--color-surface-2);
  color: var(--muted);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.badge {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-surface);
  box-shadow: 0 0 0 1px var(--color-divider);
}
.top {
  grid-area: top;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.sender {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
}
.unread .sender {
  font-weight: 700;
}
.time {
  flex: none;
  font-size: 12px;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}
.unread .time {
  color: var(--color-text);
  font-weight: 600;
}
.preview {
  grid-area: preview;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.45;
  color: var(--muted);
}
.subject {
  color: var(--color-text);
  font-weight: 500;
}
.note {
  grid-area: note;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 6px;
  font-size: 12px;
  font-weight: 500;
}
.note.muted {
  color: var(--faint);
}
.note.accent {
  color: var(--color-accent-700);
}
.note.ink {
  color: var(--color-text);
}
</style>
