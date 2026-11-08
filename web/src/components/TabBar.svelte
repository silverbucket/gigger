<script lang="ts">
import Icon, { type IconName } from "./Icon.svelte";

/** Phone bottom bar: icon tabs with short labels; the active tab is tinted with the accent. */
let {
  items,
  active,
}: {
  items: {
    id: string;
    label: string;
    href: string;
    icon: IconName;
    count?: number;
  }[];
  active: string;
} = $props();
</script>

<nav class="tabbar no-print" aria-label="Main" style:--n={items.length}>
  {#each items as item (item.id)}
    <a
      href={item.href}
      class:active={item.id === active}
      aria-current={item.id === active ? "page" : undefined}
    >
      <span class="icon">
        <Icon
          name={item.icon}
          size={22}
          stroke={item.id === active ? 2.25 : 1.75}
        />
        {#if item.count}
          <span class="badge"
            >{item.count}<span class="sr-only"> new</span></span
          >
        {/if}
      </span>
      <span class="text">{item.label}</span>
    </a>
  {/each}
</nav>

<style>
.tabbar {
  position: fixed;
  z-index: 10;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(var(--n), minmax(0, 1fr));
  padding: 6px 4px env(safe-area-inset-bottom);
  background: var(--color-surface);
  border-top: var(--rule);
}
a {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 52px;
  font-size: 11px;
  font-weight: 500;
  color: var(--faint);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}
.active {
  color: var(--color-accent-600);
  font-weight: 600;
}
@media (prefers-color-scheme: dark) {
  .active {
    color: var(--color-accent);
  }
}
.icon {
  position: relative;
  display: grid;
  place-items: center;
}
.badge {
  position: absolute;
  top: -5px;
  left: 14px;
  min-width: 18px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  border: 2px solid var(--color-surface);
  background: var(--color-accent-600);
  color: var(--on-accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}
.text {
  white-space: nowrap;
}
</style>
