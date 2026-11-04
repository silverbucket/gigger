<script lang="ts">
/** Phone bottom bar with four tabs; the active one has a 4px red inset on top. */
let {
  items,
  active,
}: {
  items: { id: string; label: string; href: string; count?: number }[];
  active: string;
} = $props();
</script>

<nav class="tabbar no-print" aria-label="Main">
  {#each items as item (item.id)}
    <a
      href={item.href}
      class:active={item.id === active}
      aria-current={item.id === active ? "page" : undefined}
      >{item.label}
      {#if item.count}
        <span> · {item.count}</span>
      {/if}</a
    >
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: var(--rule-ink);
  background: var(--color-bg);
  padding-bottom: env(safe-area-inset-bottom);
}
a {
  display: flex;
  align-items: center;
  min-height: 56px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: inherit;
  text-decoration: none;
  border-right: var(--rule);
  white-space: nowrap;
}
a:last-child {
  border-right: 0;
}
.active {
  color: var(--color-accent);
  box-shadow: inset 0 4px 0 var(--color-accent);
}
</style>
