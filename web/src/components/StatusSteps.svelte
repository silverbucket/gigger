<script lang="ts">
import type { GigStatus } from "@showday/schemas";

/** enquiry → offered → confirmed → played as a four-part progress track: done and current filled, later empty. */
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
  gap: 6px;
  padding: 16px 28px 4px;
}
li {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: capitalize;
}
li::before {
  content: "";
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--color-sunken);
}
.done {
  color: var(--muted);
}
.done::before {
  background: var(--color-accent-400);
}
.current {
  color: var(--color-text);
  font-weight: 600;
}
.current::before {
  background: var(--color-accent-600);
}
li span {
  display: none;
}
.cancelled li {
  text-decoration: line-through;
}
.cancelled li::before {
  background: var(--color-sunken);
}
.cancelled-line {
  margin: 8px 28px 0;
  padding: 10px 12px;
  font-size: 13px;
  border-radius: var(--radius-md);
  background: var(--tone-cancelled-bg);
  color: var(--tone-cancelled-fg);
}
@media (max-width: 899px) {
  .steps {
    padding-inline: var(--pad);
  }
  .cancelled-line {
    margin-inline: var(--pad);
  }
}
</style>
