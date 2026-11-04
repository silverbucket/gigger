<script lang="ts" module>
import type { GigStatus } from "@gigger/schemas";
export type TagKind =
  | GigStatus
  | "private"
  | "proposed"
  | "channel"
  | "accent"
  | "neutral";
</script>

<script lang="ts">
import type { Snippet } from "svelte";

/** Status, privacy, proposed and channel tags. */
let { kind = "neutral", children }: { kind?: TagKind; children: Snippet } =
  $props();
</script>

<span class="tag {kind}">{@render children()}</span>

<style>
.tag {
  display: inline-flex;
  align-items: center;
  flex: none;
  font-size: 11px;
  line-height: 1.3;
  letter-spacing: 0.02em;
  padding: 3px 10px;
  white-space: nowrap;
  background: var(--color-neutral-100);
  color: var(--color-neutral-800);
  border: 1px solid transparent;
}
.enquiry,
.played,
.private,
.neutral {
  background: var(--color-neutral-100);
  color: var(--color-neutral-800);
}
.cancelled {
  background: var(--color-neutral-100);
  color: var(--color-neutral-600);
}
.confirmed,
.accent {
  background: var(--color-accent-100);
  color: var(--color-accent-800);
}
.offered,
.proposed {
  background: transparent;
  border-color: var(--color-accent);
  color: var(--color-accent-700);
}
.channel {
  background: transparent;
  border-color: var(--color-text);
  color: var(--color-text);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 2px 6px;
}
</style>
