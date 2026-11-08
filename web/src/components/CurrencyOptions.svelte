<script lang="ts">
import { currencyChoices } from "../lib/format";

/** A datalist for a currency input; `first` codes are suggested before common ones. */
let { id, first = [] }: { id: string; first?: (string | undefined)[] } =
  $props();
const choices = $derived(currencyChoices(first));
</script>

<datalist {id}>
  {#each choices as choice (choice.code)}
    <option value={choice.code}>{choice.name ?? choice.code}</option>
  {/each}
</datalist>
