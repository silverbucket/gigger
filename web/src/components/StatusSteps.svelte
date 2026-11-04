<script lang="ts">
import type { GigStatus } from "@gigger/schemas";

/** enquiry → offered → confirmed → played as four equal cells: done = ink, current = accent, later = empty. */
let { status }: { status: GigStatus } = $props();
const steps = ["enquiry", "offered", "confirmed", "played"] as const;
const current = $derived(steps.indexOf(status as (typeof steps)[number]));
</script>

<ol class="steps" class:cancelled={status === "cancelled"} aria-label="Status">
  {#each steps as step, i (step)}
    <li
      class:done={current >= 0 && i < current}
      class:current={i === current}
      aria-current={i === current ? "step" : undefined}
    >
      <span>{String(i + 1).padStart(2, "0")}</span> {step}
    </li>
  {/each}
</ol>
{#if status === "cancelled"}
  <p class="cancelled-line">
    Cancelled. This gig no longer moves through the steps.
  </p>
{/if}

<style>
.steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-bottom: var(--rule-2);
}
li {
  padding: 9px 12px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-right: var(--rule);
  color: var(--color-neutral-700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
li:last-child {
  border-right: 0;
}
.done {
  background: var(--color-text);
  color: var(--color-bg);
  border-right-color: transparent;
}
.current {
  background: var(--color-accent);
  color: var(--color-bg);
}
.cancelled li {
  text-decoration: line-through;
  color: var(--color-neutral-500);
}
.cancelled-line {
  margin: 0;
  padding: 10px 28px;
  font-size: 14px;
  border-bottom: var(--rule-2);
}
@media (max-width: 899px) {
  li {
    font-size: 10px;
    padding: 9px 8px;
    letter-spacing: 0.04em;
  }
  li span {
    display: none;
  }
  .cancelled-line {
    padding-inline: 16px;
  }
}
</style>
