<script lang="ts">
import type { Snippet } from "svelte";

/** The sticky action footer of a detail pane or phone form. Ghost actions go in `end`. */
let {
  children,
  end,
  summary,
}: { children: Snippet; end?: Snippet; summary?: Snippet } = $props();
</script>

<div class="bar no-print">
  {#if summary}
    <div class="summary">{@render summary()}</div>
  {/if}
  <div class="actions">
    {@render children()}
    {#if end}
      <div class="end">{@render end()}</div>
    {/if}
  </div>
</div>

<style>
.bar {
  position: sticky;
  bottom: 0;
  z-index: 2;
  flex: none;
  padding: 14px 28px;
  border-top: var(--rule);
  background: var(--color-surface);
}
.summary {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-3);
  margin-bottom: 10px;
  font-size: 13px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.end {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
@media (max-width: 899px) {
  .bar {
    padding: 12px var(--pad) calc(12px + env(safe-area-inset-bottom));
  }
  .actions > :global(.btn) {
    flex: 1 1 0;
    min-width: 0;
  }
  .actions > :global(.btn-primary) {
    flex-grow: 2;
  }
  .end {
    flex-basis: 100%;
    margin-left: 0;
    justify-content: center;
  }
}
</style>
