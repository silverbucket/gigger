<script lang="ts" module>
import { normalize } from "../lib/format";

export interface Option {
  id: string;
  label: string;
  sub?: string;
  badge?: string;
}
/** Ranks by name: whole match, then start of name, start of a word, anywhere; `extra` text also matches. */
export function rank<T>(
  items: T[],
  query: string,
  name: (item: T) => string,
  extra: (item: T) => string = () => "",
  limit = 8,
) {
  const needle = normalize(query);
  if (!needle) return [];
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const text = normalize(name(item));
    const more = normalize(extra(item));
    const score =
      text === needle
        ? 5
        : text.startsWith(needle)
          ? 4
          : text.split(/[\s-]+/).some((word) => word.startsWith(needle))
            ? 3
            : text.includes(needle)
              ? 2
              : more.includes(needle)
                ? 1
                : 0;
    if (score) scored.push({ item, score });
  }
  return scored
    .sort(
      (a, b) => b.score - a.score || name(a.item).localeCompare(name(b.item)),
    )
    .slice(0, limit)
    .map((entry) => entry.item);
}
</script>

<script lang="ts">
/** A search box with ranked suggestions; the last row always creates a new record. */
let {
  label,
  query = $bindable(""),
  options,
  placeholder = "",
  createLabel,
  oncreate,
  onselect,
  required = false,
  disabled = false,
  invalid = false,
  focusOnMount = false,
  hint,
}: {
  label: string;
  query?: string;
  /** Suggestions for the current query, best first. */
  options: Option[];
  placeholder?: string;
  /** e.g. q => `Create “${q}” as a new venue`. */
  createLabel?: (query: string) => string;
  oncreate?: (query: string) => void;
  onselect: (id: string) => void;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  focusOnMount?: boolean;
  hint?: string;
} = $props();
const uid = $props.id();
let focused = $state(false);
let active = $state(0);
let input = $state<HTMLInputElement>();
const rows = $derived([
  ...options.map((option) => ({ kind: "option" as const, option })),
  ...(createLabel && oncreate && query.trim()
    ? [{ kind: "create" as const, option: undefined }]
    : []),
]);
const expanded = $derived(focused && !!query.trim() && rows.length > 0);
$effect(() => {
  if (focusOnMount) input?.focus();
});
function choose(index: number) {
  const row = rows[index];
  if (!row) return;
  if (row.kind === "option") onselect(row.option.id);
  else oncreate?.(query.trim());
  focused = false;
}
function keydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    focused = true;
    const step = event.key === "ArrowDown" ? 1 : -1;
    active = (active + step + rows.length) % Math.max(rows.length, 1);
  } else if (event.key === "Enter" && expanded) {
    event.preventDefault();
    choose(active);
  } else if (event.key === "Escape") {
    focused = false;
  }
}
</script>

<div class="typeahead">
  <label for={`${uid}-input`} class="field-label">{label}</label>
  <div class="box" class:open={expanded}>
    <input
      bind:this={input}
      id={`${uid}-input`}
      class="input"
      class:invalid
      type="search"
      role="combobox"
      autocomplete="off"
      aria-expanded={expanded}
      aria-controls={`${uid}-list`}
      aria-activedescendant={expanded ? `${uid}-row-${active}` : undefined}
      aria-autocomplete="list"
      {placeholder}
      {required}
      {disabled}
      bind:value={query}
      oninput={() => {
        focused = true;
        active = 0;
      }}
      onfocus={() => {
        focused = true;
      }}
      onblur={() => {
        focused = false;
      }}
      onkeydown={keydown}
    >
    {#if expanded}
      <div class="list" id={`${uid}-list`} role="listbox" aria-label={label}>
        {#each rows as row, i (row.option?.id ?? "create")}
          <div
            id={`${uid}-row-${i}`}
            role="option"
            tabindex="-1"
            aria-selected={i === active}
            class:active={i === active}
            class:create={row.kind === "create"}
            onpointerdown={(event) => {
              // Keep focus in the box so a tap is not lost to the blur.
              event.preventDefault();
              choose(i);
            }}
            onpointerenter={() => {
              active = i;
            }}
          >
            {#if row.kind === "option"}
              <span class="text">
                <span class="name">{row.option.label}</span>
                {#if row.option.sub}
                  <span class="sub"> · {row.option.sub}</span>
                {/if}
              </span>
              {#if row.option.badge}
                <span class="badge">{row.option.badge}</span>
              {/if}
            {:else}
              <span class="text">+ {createLabel?.(query.trim())}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
  {#if hint}
    <p class="field-hint">{hint}</p>
  {/if}
</div>

<style>
.typeahead {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.field-label {
  display: block;
  font-size: 12px;
  margin-bottom: 5px;
  color: color-mix(in srgb, var(--color-text) 70%, transparent);
}
.box {
  position: relative;
}
.open .input {
  border-color: var(--color-accent);
}
.input.invalid {
  border-color: var(--color-accent);
}
.list {
  position: absolute;
  z-index: 20;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 320px;
  overflow: auto;
  background: var(--color-bg);
  border: var(--rule-ink);
  border-top: 0;
  box-shadow: var(--shadow-md);
}
[role="option"] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  border-bottom: var(--rule);
  font-size: 14px;
  cursor: pointer;
}
[role="option"]:last-child {
  border-bottom: 0;
}
.active {
  background: var(--color-neutral-200);
}
.name {
  font-weight: 800;
}
.create {
  color: var(--color-accent-700);
  font-weight: 600;
}
.badge {
  flex: none;
  font-size: 11px;
  padding: 2px 8px;
  background: var(--color-accent-100);
  color: var(--color-accent-800);
}
@media (max-width: 899px) {
  /* On a phone the suggestions push the form down instead of floating over it. */
  .list {
    position: static;
    max-height: none;
    box-shadow: none;
  }
}
</style>
