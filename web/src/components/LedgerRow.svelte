<script lang="ts">
import type { GigStatus } from "@showday/schemas";
import { capitalize, dayNumber, monthShort, weekday } from "../lib/format";
import Tag from "./Tag.svelte";

/** A gig row in its month group: day · title and venue · status · availability · fee or take-home. */
let {
  href,
  date,
  title,
  sub,
  status,
  availability,
  availabilityAlert = false,
  amount,
  selected = false,
  showMonth = false,
}: {
  href: string;
  date: string;
  title: string;
  sub?: string;
  status: GigStatus;
  availability?: string;
  availabilityAlert?: boolean;
  amount?: string;
  selected?: boolean;
  /** Phone rows show the month under the day instead of grouping by month. */
  showMonth?: boolean;
} = $props();
</script>

<li>
  <a
    class="row"
    class:selected
    {href}
    aria-current={selected ? "true" : undefined}
  >
    <span class="day">
      <span class="num">{dayNumber(date) || "—"}</span>
      <span class="wd">{showMonth ? monthShort(date) : weekday(date)}</span>
    </span>
    <span class="what">
      <span class="title">{title}</span>
      {#if sub}
        <span class="sub ellipsis">{sub}</span>
      {/if}
    </span>
    <span class="status"><Tag kind={status}>{capitalize(status)}</Tag></span>
    <span class="avail" class:alert-text={availabilityAlert}
      >{availability ?? ""}</span
    >
    <span class="amount">{amount || "—"}</span>
  </a>
</li>

<style>
.row {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr) 120px 72px 100px;
  align-items: center;
  gap: 0 12px;
  min-height: 64px;
  padding: 10px 24px;
  border-bottom: var(--rule);
  color: inherit;
  text-decoration: none;
}
.row:hover {
  background: var(--select-bg);
}
.selected {
  background: var(--select-bg);
  box-shadow: var(--select-mark);
}
.day {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.num {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
}
.wd {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.what {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.title {
  font-size: 15px;
  font-weight: 800;
  line-height: 1.25;
}
.sub {
  font-size: 13px;
  color: var(--color-neutral-800);
}
.avail {
  font-size: 13px;
  font-weight: 600;
}
.amount {
  text-align: right;
  font-weight: 800;
  font-size: 15px;
}
@media (max-width: 1199px) {
  .row {
    grid-template-columns: 64px minmax(0, 1fr) auto 90px;
  }
  .avail {
    display: none;
  }
}
@media (max-width: 899px) {
  .row {
    grid-template-columns: 48px minmax(0, 1fr) auto;
    padding: 10px 16px;
    min-height: 60px;
  }
  .day {
    flex-direction: column;
    gap: 2px;
  }
  .num {
    font-size: 22px;
  }
  .amount {
    display: none;
  }
}
</style>
