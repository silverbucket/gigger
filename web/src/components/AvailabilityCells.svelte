<script lang="ts" module>
import type { Availability, Gig, Member } from "@showday/schemas";

export const availabilityLabel: Record<Availability | "none", string> = {
  yes: "Available",
  no: "Can't make it",
  maybe: "No reply yet",
  none: "Not asked",
};
/** "2 of 4 available · Petr can't make it" */
export function availabilitySummary(gig: Gig, members: Member[]) {
  const yes = members.filter((m) => gig.availability?.[m.id] === "yes");
  const no = members.filter((m) => gig.availability?.[m.id] === "no");
  const first = (m: Member) => m.name.split(/\s+/)[0];
  const out = no.length ? ` · ${no.map(first).join(", ")} can't make it` : "";
  return {
    line: `${yes.length} of ${members.length} available${out}`,
    short: `${yes.length}/${members.length} in`,
    alert: no.length > 0,
    complete: members.length > 0 && yes.length === members.length,
  };
}
const order: (Availability | undefined)[] = [undefined, "yes", "no", "maybe"];
export const nextAvailability = (value: Availability | undefined) =>
  order[(order.indexOf(value) + 1) % order.length] ?? null;
</script>

<script lang="ts">
/** One chip per member: Available = green, Can't make it = red, No reply = amber, Not asked = plain. Click to cycle. */
let {
  gig,
  members,
  disabled = false,
  onchange,
}: {
  gig: Gig;
  members: Member[];
  disabled?: boolean;
  onchange?: (memberId: string, value: Availability | null) => void;
} = $props();
</script>

<ul class="cells" style:--cols={Math.min(Math.max(members.length, 1), 4)}>
  {#each members as member (member.id)}
    {@const value = gig.availability?.[member.id]}
    <li class={value ?? "none"}>
      <button
        type="button"
        {disabled}
        title="Change availability"
        aria-label={`${member.name}: ${availabilityLabel[value ?? "none"]}. Change`}
        onclick={() => onchange?.(member.id, nextAvailability(value))}
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="text">
          <span class="name ellipsis">{member.name}</span>
          <span class="state">{availabilityLabel[value ?? "none"]}</span>
        </span>
      </button>
    </li>
  {/each}
</ul>

<style>
.cells {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  gap: 8px;
  padding: 0 28px 16px;
}
li {
  min-width: 0;
}
button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 100%;
  min-height: 52px;
  padding: 8px 12px;
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  text-align: left;
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}
button:hover:not(:disabled) {
  border-color: var(--color-border);
  background: var(--color-surface-2);
}
.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px dashed var(--color-neutral-500);
}
.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-weight: 600;
  font-size: 13px;
  max-width: 100%;
}
.state {
  font-size: 12px;
  color: var(--muted);
}
.yes button {
  background: var(--tone-confirmed-bg);
  border-color: transparent;
}
.yes .dot {
  border: 0;
  background: var(--tone-confirmed-fg);
}
.yes .state {
  color: var(--tone-confirmed-fg);
}
.no button {
  background: var(--tone-cancelled-bg);
  border-color: transparent;
}
.no .dot {
  border: 0;
  background: var(--tone-cancelled-fg);
}
.no .state {
  color: var(--tone-cancelled-fg);
}
.maybe .dot {
  border: 0;
  background: var(--tone-offered-fg);
}
.maybe .state {
  color: var(--tone-offered-fg);
}
</style>
