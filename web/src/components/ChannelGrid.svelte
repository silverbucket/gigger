<script lang="ts">
import Icon from "./Icon.svelte";

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
const iconFor = (label: string) =>
  label === "Email"
    ? ("mail" as const)
    : label === "Phone"
      ? ("phone" as const)
      : label === "Instagram"
        ? ("instagram" as const)
        : ("message" as const);
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
      <li class:on={channel.value} aria-hidden="true">
        <Icon name={iconFor(channel.label)} size={14} />
      </li>
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
              ><span class="verb">{channel.verb}</span></span
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
              ><span class="verb add">Add</span></span
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
  display: inline-flex;
  gap: 4px;
}
.strip li {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--color-neutral-400);
}
.strip li.on {
  background: var(--color-accent-100);
  color: var(--color-accent-700);
}
.large {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  gap: 8px;
  padding: 16px 28px;
}
.large li {
  min-width: 0;
}
.large a,
.large .cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  height: 100%;
  min-height: 64px;
  padding: 10px 14px;
  color: inherit;
  text-decoration: none;
  text-align: left;
  background: var(--color-surface);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-md);
}
.large a:hover,
.large button.cell:hover {
  border-color: var(--color-accent-300);
  background: var(--color-accent-100);
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.verb {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-accent-700);
}
strong {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.off .cell {
  border-style: dashed;
  background: transparent;
}
.off strong {
  color: var(--faint);
  font-weight: 500;
}
@media (max-width: 899px) {
  .large {
    padding: 12px var(--pad);
  }
}
</style>
