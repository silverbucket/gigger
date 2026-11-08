<script lang="ts" module>
import type { IconName } from "./Icon.svelte";
export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  count?: number;
  countLabel?: string;
}
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import Icon from "./Icon.svelte";

/** Desktop navigation: brand, band picker, the main sections with icons and counts, and the account at the bottom. */
let {
  picker,
  items,
  footerItems = [],
  active,
  account,
}: {
  picker: Snippet;
  items: NavItem[];
  footerItems?: NavItem[];
  active: string;
  account?: Snippet;
} = $props();
</script>

{#snippet link(item: NavItem)}
  <a
    href={item.href}
    class:active={item.id === active}
    aria-current={item.id === active ? "page" : undefined}
  >
    <Icon name={item.icon} size={18} />
    <span class="text">{item.label}</span>
    {#if item.count}
      <span class="count"
        >{item.count}<span class="sr-only">
          {item.countLabel ?? "new"}</span
        ></span
      >
    {/if}
  </a>
{/snippet}

<aside class="sidebar no-print">
  <a class="brand" href="#/bookings"
    ><span class="mark" aria-hidden="true"
      ><Icon name="music" size={14} stroke={2.5} /></span
    >Showday</a
  >
  <div class="picker">{@render picker()}</div>
  <nav aria-label="Main">
    {#each items as item (item.id)}
      {@render link(item)}
    {/each}
  </nav>
  <div class="foot">
    {#each footerItems as item (item.id)}
      {@render link(item)}
    {/each}
    {#if account}
      <div class="account">{@render account()}</div>
    {/if}
  </div>
</aside>

<style>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: var(--sidebar);
  height: 100%;
  padding: 16px 12px 12px;
  background: var(--color-bg);
  border-right: var(--rule);
  overflow-y: auto;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 14px;
  font-weight: 700;
  font-size: 17px;
  letter-spacing: -0.02em;
  color: var(--color-text);
  text-decoration: none;
}
.mark {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--color-accent-600);
  color: var(--on-accent);
}
.picker {
  margin-bottom: 12px;
}
nav,
.foot {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.foot {
  margin-top: auto;
  padding-top: 12px;
}
a:not(.brand) {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 10px;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  color: var(--muted);
  text-decoration: none;
}
a:not(.brand):hover {
  background: var(--color-surface-2);
  color: var(--color-text);
}
a.active {
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 600;
  box-shadow:
    var(--shadow-sm),
    0 0 0 1px var(--color-divider);
}
a.active :global(svg) {
  color: var(--color-accent-600);
}
.text {
  flex: 1;
}
.count {
  min-width: 20px;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: var(--color-accent-600);
  color: var(--on-accent);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}
.account {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 10px 10px 4px;
  border-top: var(--rule);
}
</style>
