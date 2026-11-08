<script lang="ts">
import { countryCodes, countryName } from "@showday/schemas";

/** A country picked by name in the viewer's language; the value is its ISO code. */
let {
  id,
  value = $bindable(),
  disabled = false,
}: { id: string; value?: string; disabled?: boolean } = $props();
const countries = countryCodes
  .map((code) => ({ code, name: countryName(code, navigator.language) }))
  .sort((a, b) => a.name.localeCompare(b.name, navigator.language));
</script>

<select {id} class="input" {disabled} bind:value>
  <option value={undefined}>Not set</option>
  {#each countries as country (country.code)}
    <option value={country.code}>{country.name}</option>
  {/each}
</select>
