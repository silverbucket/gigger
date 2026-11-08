<script lang="ts">
import type { Snippet } from "svelte";
import Icon from "./Icon.svelte";

/** A phone screen's own 56px header: back link or title, and an action on the right. Hidden on desktop. */
let {
  back,
  backLabel,
  title,
  action,
  onclose,
}: {
  back?: () => void;
  backLabel?: string;
  title?: string;
  action?: Snippet;
  onclose?: () => void;
} = $props();
</script>

<div class="phone-header no-print">
  {#if back}
    <button type="button" class="back" onclick={back}>
      <Icon name="chevron-left" size={22} /> {backLabel}
    </button>
  {/if}
  {#if title}
    <h2>{title}</h2>
  {/if}
  <div class="right">
    {#if action}
      {@render action()}
    {/if}
    {#if onclose}
      <button
        type="button"
        class="btn btn-icon"
        aria-label="Close"
        onclick={onclose}
      >
        <Icon name="x" size={20} />
      </button>
    {/if}
  </div>
</div>

<style>
.phone-header {
  display: none;
}
@media (max-width: 899px) {
  .phone-header {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 56px;
    padding: 0 8px 0 4px;
    background: var(--color-surface);
    border-bottom: var(--rule);
    flex: none;
  }
  .phone-header:not(:has(.back)) {
    padding-left: 16px;
  }
}
.back {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  padding: 0 8px 0 4px;
  border: 0;
  background: transparent;
  font-weight: 500;
  font-size: 16px;
  color: var(--color-accent-600);
}
@media (prefers-color-scheme: dark) {
  .back {
    color: var(--color-accent);
  }
}
h2 {
  margin: 0;
  font-size: 17px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
