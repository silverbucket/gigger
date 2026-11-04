<script lang="ts">
import type { Snippet } from "svelte";

/**
 * Desktop: the list beside a 600px detail pane; selecting never replaces the list.
 * Phone: the list, or the detail on its own screen when one is open.
 */
let {
  list,
  detail,
  open = false,
  wide = false,
  key = "",
}: {
  list: Snippet;
  detail: Snippet;
  /** Whether a record is open (shows the detail on phones). */
  open?: boolean;
  /** A 640px pane for forms. */
  wide?: boolean;
  /** Changes when another record opens, so the pane starts at its top. */
  key?: string;
} = $props();
let pane = $state<HTMLElement>();
$effect(() => {
  void key;
  if (pane) pane.scrollTop = 0;
  if (open && matchMedia("(max-width: 899px)").matches) window.scrollTo(0, 0);
});
</script>

<div class="layout" class:open class:wide>
  <div class="list">{@render list()}</div>
  <section class="detail" aria-label="Details" bind:this={pane}>
    {@render detail()}
  </section>
</div>

<style>
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 600px;
  height: 100%;
  min-height: 0;
}
.wide {
  grid-template-columns: minmax(0, 1fr) 640px;
}
.list,
.detail {
  min-height: 0;
  min-width: 0;
  overflow: auto;
}
.detail {
  display: flex;
  flex-direction: column;
  border-left: var(--rule-ink);
  overscroll-behavior: contain;
}
@media (max-width: 1199px) {
  .layout,
  .wide {
    grid-template-columns: minmax(0, 1fr) 520px;
  }
}
@media (max-width: 899px) {
  .layout,
  .wide {
    display: block;
    height: auto;
  }
  .list,
  .detail {
    overflow: visible;
  }
  .detail {
    border-left: 0;
    min-height: calc(100dvh - var(--topbar));
  }
  .open .list,
  .layout:not(.open) .detail {
    display: none;
  }
}
@media print {
  .layout {
    display: block;
    height: auto;
  }
  .list {
    display: none;
  }
  .detail {
    border: 0;
    overflow: visible;
  }
}
</style>
