<script lang="ts">
import Tag from "./Tag.svelte";

/** An inbox item: channel, sender, preview, and how the sender matches a contact. */
let {
  href,
  channel,
  sender,
  preview,
  match,
  matchTone = "ink",
  time,
  selected = false,
  dim = false,
}: {
  href: string;
  channel: string;
  sender: string;
  preview: string;
  match: string;
  matchTone?: "ink" | "accent" | "muted";
  time: string;
  selected?: boolean;
  /** Already an enquiry, or set aside as not a booking. */
  dim?: boolean;
} = $props();
</script>

<li>
  <a
    class="row"
    class:selected
    class:dim
    {href}
    aria-current={selected ? "true" : undefined}
  >
    <span class="channel"><Tag kind="channel">{channel}</Tag></span>
    <span class="what">
      <span class="sender ellipsis">{sender}</span>
      <span class="preview ellipsis">{preview}</span>
    </span>
    <span class="match {matchTone}">{match}</span>
    <span class="time">{time}</span>
  </a>
</li>

<style>
.row {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr) 220px 72px;
  grid-template-areas: "channel what match time";
  align-items: center;
  gap: 2px 12px;
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
.channel {
  grid-area: channel;
}
.what {
  grid-area: what;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sender {
  font-size: 15px;
  font-weight: 800;
}
.preview {
  font-size: 13px;
  color: var(--color-neutral-800);
}
.match {
  grid-area: match;
  font-size: 12px;
  font-weight: 600;
}
.match.accent {
  color: var(--color-accent-700);
}
.match.muted {
  color: var(--color-neutral-600);
}
.time {
  grid-area: time;
  text-align: right;
  font-size: 12px;
}
.dim .sender,
.dim .preview {
  color: var(--color-neutral-600);
}
@media (max-width: 1199px) {
  .row {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      "channel what time"
      ". match match";
  }
}
@media (max-width: 899px) {
  .row {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      "channel sender time"
      "preview preview preview"
      "match match match";
    padding: 12px 16px;
    gap: 4px 8px;
  }
  .what {
    display: contents;
  }
  .sender {
    grid-area: sender;
  }
  .preview {
    grid-area: preview;
  }
}
</style>
