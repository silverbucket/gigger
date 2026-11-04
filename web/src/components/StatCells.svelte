<script lang="ts">
/** Equal cells for key numbers and times: small uppercase label over a big value. */
let {
  cells,
  size = "md",
  tone = "plain",
  phoneColumns,
}: {
  cells: { label: string; value: string; note?: string; accent?: boolean }[];
  size?: "sm" | "md";
  /** "accent" sits inside the red next-gig block. */
  tone?: "plain" | "accent";
  /** Columns on a phone; defaults to one row. */
  phoneColumns?: number;
} = $props();
</script>

{#if cells.length}
  <dl
    class="cells {size} {tone}"
    style:--cols={Math.min(cells.length, 4)}
    style:--phone-cols={phoneColumns ?? Math.min(cells.length, 4)}
  >
    {#each cells as cell, i (i)}
      <div class="cell" class:hot={cell.accent}>
        <dt>{cell.label}</dt>
        <dd>
          <span class="value">{cell.value}</span>
          {#if cell.note}
            <span class="note">{cell.note}</span>
          {/if}
        </dd>
      </div>
    {/each}
  </dl>
{/if}

<style>
.cells {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  margin: 0;
  border-bottom: var(--rule-2);
}
.cell {
  padding: 12px 16px;
  border-right: var(--rule);
  border-bottom: var(--rule);
  min-width: 0;
}
.cell:nth-child(4n),
.cell:last-child {
  border-right: 0;
}
dt {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-neutral-700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
dd {
  margin: 0;
  display: flex;
  flex-direction: column;
}
.value {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.15;
}
.sm .value {
  font-size: 20px;
}
.note {
  font-size: 12px;
}
.hot {
  background: var(--color-accent-600);
  color: #fff;
}
.hot dt {
  color: inherit;
}
.accent {
  background: var(--color-accent-600);
  color: #fff;
  border-bottom: 0;
}
.accent .cell {
  border-color: color-mix(in srgb, var(--color-bg) 40%, transparent);
}
.accent dt {
  color: inherit;
}
@media (max-width: 899px) {
  .cells {
    grid-template-columns: repeat(var(--phone-cols), minmax(0, 1fr));
  }
  .cell {
    padding: 10px 12px;
  }
  .value {
    font-size: 20px;
  }
}
</style>
