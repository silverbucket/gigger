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
/** One cell per member: Available = ink, Can't make it = accent tint, No reply / Not asked = empty. */
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
        <span class="name ellipsis">{member.name}</span>
        <span class="state">{availabilityLabel[value ?? "none"]}</span>
      </button>
    </li>
  {/each}
</ul>

<style>
.cells {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  border-bottom: var(--rule-2);
}
li {
  border-right: var(--rule);
  border-bottom: var(--rule);
  min-width: 0;
}
button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  height: 100%;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  text-align: left;
  min-height: 52px;
}
button:hover:not(:disabled) {
  background: var(--color-neutral-200);
}
.name {
  font-weight: 800;
  font-size: 14px;
  max-width: 100%;
}
.state {
  font-size: 12px;
}
.yes button {
  background: var(--color-text);
  color: var(--color-bg);
}
.yes button:hover:not(:disabled) {
  background: var(--color-neutral-900);
}
.no button {
  background: var(--color-accent-100);
  color: var(--color-accent-800);
}
.no button:hover:not(:disabled) {
  background: var(--color-accent-200);
}
</style>
