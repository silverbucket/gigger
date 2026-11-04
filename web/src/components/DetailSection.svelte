<script lang="ts">
import type { Snippet } from "svelte";

/** A 110px label column and the content beside it, with a 1px rule under. */
let {
  label,
  children,
  action,
}: { label: string; children: Snippet; action?: Snippet } = $props();
</script>

<section class="detail-section" class:has-action={action}>
  <h3 class="label">{label}</h3>
  <div class="content">{@render children()}</div>
  {#if action}
    <div class="action">{@render action()}</div>
  {/if}
</section>

<style>
.detail-section {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: var(--space-4);
  padding: 14px 28px;
  border-bottom: var(--rule);
  align-items: start;
}
.has-action {
  grid-template-columns: 110px minmax(0, 1fr) auto;
  align-items: center;
}
h3 {
  margin: 0;
  padding-top: 3px;
  font-family: var(--font-body);
}
.content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 14px;
  min-width: 0;
}
.content :global(.main) {
  font-weight: 800;
  font-size: 15px;
}
.content :global(.line) {
  color: var(--color-neutral-800);
}
.content :global(p) {
  margin: 0;
}
@media (max-width: 899px) {
  .detail-section {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    padding: 14px 16px;
  }
  .has-action {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .has-action h3 {
    grid-column: 1 / -1;
  }
}
</style>
