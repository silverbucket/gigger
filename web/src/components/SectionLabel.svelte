<script lang="ts">
import type { Snippet } from "svelte";

/** 12px uppercase label with a 2px rule under it; optional right-hand note. */
let {
  children,
  aside,
  tone = "ink",
  id,
}: {
  children: Snippet;
  aside?: Snippet;
  tone?: "ink" | "accent";
  id?: string;
} = $props();
</script>

<div class="section-label" class:accent={tone === "accent"}>
  <h3 class="label" {id}>{@render children()}</h3>
  {#if aside}
    <div class="aside">{@render aside()}</div>
  {/if}
</div>

<style>
.section-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-4);
  padding: 18px 24px 8px;
  border-bottom: var(--rule-2);
}
.accent {
  border-bottom: var(--rule-ink);
}
h3 {
  margin: 0;
  font-family: var(--font-body);
}
.accent h3 {
  color: var(--color-accent-700);
}
.aside {
  font-size: 12px;
  text-align: right;
}
@media (max-width: 899px) {
  .section-label {
    padding-inline: 16px;
  }
}
</style>
