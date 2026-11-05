<script lang="ts">
import type { Snippet } from "svelte";

/** Desktop 64px bar: brand · band picker · nav cells · account and the screen's main action. */
let {
  picker,
  items,
  active,
  account,
  action,
}: {
  picker: Snippet;
  items: { id: string; label: string; href: string; count?: number }[];
  active: string;
  account?: Snippet;
  action?: Snippet;
} = $props();
</script>

<header class="topbar no-print">
  <a class="brand" href="#/bookings"
    ><span class="mark" aria-hidden="true"></span>Showday</a
  >
  <div class="picker">{@render picker()}</div>
  <nav aria-label="Main">
    {#each items as item (item.id)}
      <a
        href={item.href}
        class:active={item.id === active}
        aria-current={item.id === active ? "page" : undefined}
      >
        {item.label}
        {#if item.count}
          <span class="count"
            >{item.count}<span class="sr-only"> to sort</span></span
          >
        {/if}
      </a>
    {/each}
  </nav>
  <div class="right">
    {#if account}
      {@render account()}
    {/if}
    {#if action}
      {@render action()}
    {/if}
  </div>
</header>

<style>
.topbar {
  display: flex;
  align-items: stretch;
  height: 64px;
  border-bottom: var(--rule-ink);
  background: var(--color-bg);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 24px;
  font-weight: 800;
  font-size: 22px;
  letter-spacing: -0.02em;
  color: inherit;
  text-decoration: none;
  flex: none;
}
.mark {
  width: 14px;
  height: 14px;
  background: var(--color-accent);
}
.picker {
  display: flex;
  padding: 0 24px;
  border-left: var(--rule-2);
  border-right: var(--rule-2);
  width: 190px;
  flex: none;
}
nav {
  display: flex;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
nav a {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px;
  font-size: 14px;
  color: inherit;
  text-decoration: none;
  white-space: nowrap;
  border-right: var(--rule);
}
nav a:hover {
  color: var(--color-accent);
}
nav a.active {
  color: var(--color-accent);
  box-shadow: inset 0 -4px 0 var(--color-accent);
}
.count {
  background: var(--color-accent-600);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  padding: 1px 6px;
}
.right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  flex: none;
}
@media (max-width: 1199px) {
  .brand,
  .picker,
  nav a,
  .right {
    padding-inline: 14px;
  }
  .picker {
    width: 160px;
  }
}
</style>
