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
  /** Kept for callers; every switch now uses the same raised style. */
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
  min-height: 40px;
  font-size: 14px;
}
.seg-opt:has(input:disabled) {
  cursor: not-allowed;
  opacity: 0.6;
}
.grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  width: 100%;
}
.grid .seg-opt {
  min-height: 38px;
  padding: 6px 10px;
  font-size: 14px;
  white-space: normal;
  line-height: 1.2;
  text-align: center;
}
@media (max-width: 899px) {
  .seg-opt {
    min-height: 38px;
  }
  .lg .seg-opt {
    min-height: 44px;
  }
  .grid .seg-opt {
    min-height: 44px;
  }
}
</style>
