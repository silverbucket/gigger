<script lang="ts" module>
/** Lucide icon paths (lucide.dev), drawn with currentColor. */
const paths = {
  "chevron-down": ["m6 9 6 6 6-6"],
  "chevron-left": ["m15 18-6-6 6-6"],
  "chevron-right": ["m9 18 6-6-6-6"],
  plus: ["M5 12h14", "M12 5v14"],
  "arrow-right": ["M5 12h14", "m12 5 7 7-7 7"],
  "arrow-up-right": ["M7 7h10v10", "M7 17 17 7"],
  printer: [
    "M6 9V2h12v7",
    "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2",
    "M6 14h12v8H6z",
  ],
  "map-pin": [
    "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",
    "M12 7a3 3 0 1 0 0 6 3 3 0 1 0 0-6",
  ],
  search: ["m21 21-4.34-4.34", "M11 3a8 8 0 1 0 0 16 8 8 0 1 0 0-16"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  check: ["M20 6 9 17l-5-5"],
  send: [
    "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
    "m21.854 2.147-10.94 10.939",
  ],
} as const;
export type IconName = keyof typeof paths;
</script>

<script lang="ts">
let {
  name,
  size = 16,
  stroke = 2,
}: { name: IconName; size?: number; stroke?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#each paths[name] as d (d)}
    <path {d}></path>
  {/each}
</svg>
