<script lang="ts">
import type { BandData } from "../lib/data.svelte";
import Icon from "./Icon.svelte";

/** The band in view. A native select styled as a button, so it works with every input method. */
let {
  bands,
  value,
  onchange,
  allowAll = true,
}: {
  bands: BandData[];
  value: string;
  onchange: (bandId: string) => void;
  allowAll?: boolean;
} = $props();
const name = $derived(
  bands.find((b) => b.band.id === value)?.band.name ?? "All bands",
);
</script>

<label class="picker">
  <span class="sr-only">View band</span>
  <span class="shown" aria-hidden="true"
    ><span class="avatar">{name.slice(0, 1).toUpperCase()}</span
    ><span class="ellipsis name">{name}</span><Icon name="chevron-down" /></span
  >
  <select
    aria-label="View band"
    {value}
    onchange={(event) => onchange(event.currentTarget.value)}
  >
    {#if allowAll || !value}
      <option value="">All bands</option>
    {/if}
    {#each bands as { band } (band.id)}
      <option value={band.id}>{band.name}</option>
    {/each}
  </select>
</label>

<style>
.picker {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  width: 100%;
  min-height: 44px;
  padding: 6px 10px 6px 6px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-divider);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
}
.shown {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  font-weight: 600;
  font-size: 14px;
  min-width: 0;
  pointer-events: none;
}
.shown :global(svg) {
  margin-left: auto;
  color: var(--faint);
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--color-accent-100);
  color: var(--color-accent-700);
  font-size: 13px;
  font-weight: 700;
}
.name {
  min-width: 0;
}
select {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  cursor: pointer;
  font-size: 16px;
}
.picker:has(select:focus-visible) {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
.picker:hover {
  background: var(--color-surface-2);
}
</style>
