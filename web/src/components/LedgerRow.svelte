<script lang="ts">
import type { GigStatus } from "@showday/schemas";
import { capitalize, dayNumber, monthShort, weekday } from "../lib/format";
import Icon from "./Icon.svelte";
import Tag from "./Tag.svelte";

/** A gig row in its month group: date tile · title and venue · status · availability · fee or take-home. */
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
    <span class="day" class:soon={status === "confirmed"}>
      <span class="wd">{showMonth ? monthShort(date) : weekday(date)}</span>
      <span class="num">{dayNumber(date) || "—"}</span>
    </span>
    <span class="what">
      <span class="title">{title}</span>
      {#if sub}
        <span class="sub ellipsis">{sub}</span>
      {/if}
    </span>
    <span class="status"><Tag kind={status}>{capitalize(status)}</Tag></span>
    <span class="avail" class:alert={availabilityAlert}
      >{#if availability}
        <Icon name="users" size={14} />{availability}
      {/if}</span
    >
    <span class="amount">{amount || "—"}</span>
  </a>
</li>

<style>
.row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 110px 84px 96px;
  align-items: center;
  gap: 0 16px;
  min-height: 68px;
  margin: 0 12px;
  padding: 10px 12px;
  border-radius: var(--radius-lg);
  color: inherit;
  text-decoration: none;
}
.row:hover {
  background: var(--hover-bg);
}
.selected,
.selected:hover {
  background: var(--select-bg);
}
.day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-divider);
  box-shadow: var(--shadow-sm);
  line-height: 1;
}
.wd {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-accent-700);
}
.num {
  margin-top: 3px;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.what {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
}
.sub {
  font-size: 13px;
  color: var(--muted);
}
.avail {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.avail.alert {
  color: var(--color-warning);
  font-weight: 600;
}
.amount {
  text-align: right;
  font-weight: 600;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 1199px) {
  .row {
    grid-template-columns: 48px minmax(0, 1fr) auto 80px;
  }
  .avail {
    display: none;
  }
}
@media (max-width: 899px) {
  .row {
    grid-template-columns: 48px minmax(0, 1fr) auto;
    gap: 0 12px;
    margin: 0 4px;
    padding: 10px 12px;
  }
  .amount {
    display: none;
  }
}
</style>
