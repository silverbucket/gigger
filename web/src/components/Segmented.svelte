<script lang="ts" generics="T extends string | number">
/** Choices that exclude each other, and view switches. Radios underneath, so it is a real form control. */
let {
  options,
  value = $bindable(),
  label,
  name,
  columns,
  required = false,
  disabled = false,
  dark = false,
  size = "sm",
  onchange,
}: {
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  /** Accessible group name. */
  label: string;
  name?: string;
  /** Lay options out as a grid of equal cells (form use); omitted = inline switch. */
  columns?: number;
  required?: boolean;
  disabled?: boolean;
  /** Ink fill for the chosen option instead of accent (secondary filters). */
  dark?: boolean;
  size?: "sm" | "lg";
  onchange?: (value: T) => void;
} = $props();
const uid = $props.id();
</script>

<div
  class="seg {size}"
  class:grid={columns}
  class:dark
  role="radiogroup"
  aria-label={label}
  style:--cols={columns}
>
  {#each options as option (option.value)}
    <label class="seg-opt">
      <input
        type="radio"
        name={name ?? uid}
        value={option.value}
        checked={value === option.value}
        {required}
        {disabled}
        onchange={() => {
          value = option.value;
          onchange?.(option.value);
        }}
      >
      {option.label}
    </label>
  {/each}
</div>

<style>
.seg {
  flex: none;
  max-width: 100%;
}
.seg-opt {
  white-space: nowrap;
  user-select: none;
}
.lg .seg-opt {
  min-height: 44px;
  font-size: 14px;
}
.seg-opt:has(input:disabled) {
  cursor: not-allowed;
  opacity: 0.6;
}
.dark .seg-opt:has(input:checked) {
  background: var(--color-text);
  color: var(--color-bg);
}
.grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  width: 100%;
  border: 0;
  border-top: var(--rule);
  border-left: var(--rule);
}
.grid .seg-opt {
  border: 0;
  border-right: var(--rule);
  border-bottom: var(--rule);
  min-height: 44px;
  padding: 8px 10px;
  font-size: 14px;
  white-space: normal;
  line-height: 1.2;
}
.grid .seg-opt + .seg-opt {
  border-left: 0;
}
</style>
