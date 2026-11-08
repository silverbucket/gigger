<script lang="ts">
/** Five rating squares, filled up to the (rounded) value. */
let { value }: { value: number } = $props();
const filled = $derived(Math.round(value));
</script>

<span
  class="rating"
  role="img"
  aria-label={value ? `${value.toFixed(1)} out of 5` : "Not rated"}
>
  {#each [1, 2, 3, 4, 5] as n (n)}
    <span class:on={n <= filled}></span>
  {/each}
</span>

<style>
.rating {
  display: inline-flex;
  gap: 2px;
}
span span {
  width: 6px;
  height: 12px;
  border-radius: 2px;
  background: var(--color-neutral-300);
}
span span.on {
  background: var(--color-warning);
}
</style>
