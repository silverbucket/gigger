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
  gap: 8px;
  margin: 0;
  padding: 16px 28px;
}
.cell {
  padding: 10px 14px;
  min-width: 0;
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}
dt {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
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
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}
.sm .value {
  font-size: 16px;
}
.note {
  font-size: 12px;
  color: var(--muted);
}
.hot {
  background: var(--color-accent-100);
}
.hot .value {
  color: var(--color-accent-700);
}
.accent {
  padding: 0;
}
.accent .cell {
  background: rgb(255 255 255 / 0.14);
  color: inherit;
}
.accent dt,
.accent .note {
  color: inherit;
  opacity: 0.8;
}
@media (max-width: 899px) {
  .cells {
    grid-template-columns: repeat(var(--phone-cols), minmax(0, 1fr));
    padding: 12px var(--pad);
  }
  .accent {
    padding: 0;
  }
  .cell {
    padding: 8px 12px;
  }
  .value {
    font-size: 17px;
  }
}
</style>
