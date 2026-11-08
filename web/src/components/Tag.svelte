<script lang="ts" module>
import type { GigStatus } from "@showday/schemas";
export type TagKind =
  | GigStatus
  | "private"
  | "public"
  | "shared"
  | "danger"
  | "proposed"
  | "channel"
  | "accent"
  | "neutral";
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import Icon from "./Icon.svelte";

/** Status, visibility, proposed and channel tags. Statuses get a coloured dot; Private, Public and Shared get a lock, globe or people. */
let { kind = "neutral", children }: { kind?: TagKind; children: Snippet } =
  $props();
const statuses = ["enquiry", "offered", "confirmed", "played", "cancelled"];
</script>

<span class="tag {kind}" class:status={statuses.includes(kind)}
  >{#if kind === "private"}
    <Icon name="lock" size={11} stroke={2.5} />
  {:else if kind === "public"}
    <Icon name="globe" size={11} stroke={2.5} />
  {:else if kind === "shared"}
    <Icon name="users" size={11} stroke={2.5} />
  {/if}
  {@render children()}</span
>

<style>
.tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  padding: 2px 8px;
  white-space: nowrap;
  border-radius: var(--radius-pill);
  background: var(--color-surface-2);
  color: var(--muted);
}
.tag.status::before,
.tag.dot::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.enquiry {
  background: var(--tone-enquiry-bg);
  color: var(--tone-enquiry-fg);
}
.offered,
.proposed {
  background: var(--tone-offered-bg);
  color: var(--tone-offered-fg);
}
.confirmed {
  background: var(--tone-confirmed-bg);
  color: var(--tone-confirmed-fg);
}
.played {
  background: var(--tone-played-bg);
  color: var(--tone-played-fg);
}
.cancelled {
  background: var(--tone-cancelled-bg);
  color: var(--tone-cancelled-fg);
}
.accent {
  background: var(--color-accent-100);
  color: var(--color-accent-700);
}
.private {
  background: var(--color-surface-2);
  color: var(--muted);
}
.public {
  background: var(--public-bg);
  color: var(--public-fg);
}
.shared {
  background: var(--color-accent-100);
  color: var(--color-accent-700);
}
.danger {
  background: var(--color-danger-bg);
  color: var(--color-danger);
}
.channel {
  background: transparent;
  padding: 0;
  color: var(--muted);
}
</style>
