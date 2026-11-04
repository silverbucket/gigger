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
    ><span class="ellipsis">{name}</span><Icon name="chevron-down" /></span
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
  cursor: pointer;
}
.shown {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 800;
  font-size: 15px;
  min-width: 0;
  pointer-events: none;
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
  color: var(--color-accent-700);
}
</style>
