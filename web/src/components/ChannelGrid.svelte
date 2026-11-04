<script lang="ts">
/** How to reach someone. Compact = a strip for lists; large = tappable cells for a person's page. */
type Channel = {
  label: string;
  short: string;
  value?: string;
  href?: string;
  verb: string;
};
let {
  channels,
  size = "compact",
  onadd,
}: {
  channels: Channel[];
  size?: "compact" | "large";
  onadd?: (label: string) => void;
} = $props();
</script>

{#if size === "compact"}
  <ul
    class="strip"
    aria-label={`Reach on: ${
      channels
        .filter((c) => c.value)
        .map((c) => c.label)
        .join(", ") || "nothing yet"
    }`}
    style:--cols={channels.length}
  >
    {#each channels as channel (channel.label)}
      <li class:on={channel.value} aria-hidden="true">{channel.short}</li>
    {/each}
  </ul>
{:else}
  <ul class="large" style:--cols={Math.min(channels.length, 2)}>
    {#each channels as channel (channel.label)}
      <li class:off={!channel.value}>
        {#if channel.value && channel.href}
          <a
            href={channel.href}
            target={channel.href.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
          >
            <span class="head"
              ><span class="small-label">{channel.label}</span
              ><span class="verb">{channel.verb} ↗</span></span
            >
            <strong>{channel.value}</strong>
          </a>
        {:else if channel.value}
          <div class="cell">
            <span class="small-label">{channel.label}</span>
            <strong>{channel.value}</strong>
          </div>
        {:else}
          <button
            type="button"
            class="cell"
            onclick={() => onadd?.(channel.label)}
          >
            <span class="head"
              ><span class="small-label">{channel.label}</span
              ><span class="verb">+ Add</span></span
            >
            <strong>Not added</strong>
          </button>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
.strip {
  display: inline-grid;
  grid-template-columns: repeat(var(--cols), minmax(44px, auto));
  border: 1px solid var(--color-neutral-500);
}
.strip li {
  font-size: 10px;
  font-weight: 600;
  padding: 3px 6px;
  white-space: nowrap;
  color: var(--color-neutral-500);
  border-right: 1px solid var(--color-neutral-400);
}
.strip li:last-child {
  border-right: 0;
}
.strip li.on {
  background: var(--color-text);
  color: var(--color-bg);
  border-right-color: var(--color-text);
}
.large {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  border-bottom: var(--rule-2);
}
.large li {
  border-right: var(--rule);
  border-bottom: var(--rule);
  min-width: 0;
}
.large li:nth-child(2n) {
  border-right: 0;
}
.large a,
.large .cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-height: 72px;
  padding: 14px 28px;
  color: inherit;
  text-decoration: none;
  text-align: left;
  background: transparent;
  border: 0;
}
.large a:hover,
.large button.cell:hover {
  background: var(--color-neutral-200);
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.verb {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
strong {
  font-size: 16px;
  font-weight: 800;
}
.off {
  background: var(--color-neutral-200);
}
.off strong {
  color: var(--color-neutral-600);
}
@media (max-width: 899px) {
  .large a,
  .large .cell {
    padding: 14px 16px;
  }
}
</style>
