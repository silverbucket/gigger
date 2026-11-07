<script lang="ts">
import SectionLabel from "../components/SectionLabel.svelte";
import { data } from "../lib/data.svelte";
import { run, ui } from "../lib/ui.svelte";
import { bands, logout } from "../storage";
import Connections from "./Connections.svelte";

const current = $derived(data.current);
const band = $derived(current?.band);

let currencyDraft = $state<{ bandId: string; text: string } | null>(null);
const currencyText = $derived(
  currencyDraft && currencyDraft.bandId === band?.id
    ? currencyDraft.text
    : (band?.currency ?? "EUR"),
);

function saveCurrency(event: SubmitEvent) {
  event.preventDefault();
  if (!band) return;
  const value = {
    ...$state.snapshot(band),
    currency: currencyText.toUpperCase(),
  };
  void run(async () => {
    await bands.save("band", value.id, value);
    currencyDraft = null;
  });
}
</script>

{#if !current}
  <div class="page-head">
    <div>
      <h1>Settings</h1>
      <p>Choose a band to change currency, connections and email.</p>
    </div>
  </div>
  <ul class="choose">
    {#each data.all as item (item.band.id)}
      <li>
        <button
          type="button"
          class="btn btn-secondary btn-wide"
          onclick={() => data.choose(item.band.id)}
        >
          {item.band.name}
        </button>
      </li>
    {:else}
      <li class="empty">
        Create a band on the <a href="#/band">Band page</a> first.
      </li>
    {/each}
  </ul>
{:else}
  <div class="page-head">
    <div>
      <p class="kicker">Settings · {current.band.name}</p>
      <h1>Band settings</h1>
    </div>
  </div>
  <SectionLabel>
    Currency and connections
    {#snippet aside()}
      These apply to the band shown in the picker above.
    {/snippet}
  </SectionLabel>
  <form class="block currency" onsubmit={saveCurrency}>
    <div class="field">
      <label for="band-currency">Band currency · fees and earnings</label>
      <div class="inline">
        <input
          id="band-currency"
          class="input"
          name="currency"
          disabled={ui.busy}
          value={currencyText}
          oninput={(event) => {
            currencyDraft = {
              bandId: band?.id ?? "",
              text: event.currentTarget.value,
            };
          }}
          pattern={"[A-Za-z]{3}"}
          maxlength="3"
          required
        >
        <button type="submit" class="btn btn-secondary" disabled={ui.busy}>
          Save<span class="sr-only"> currency</span>
        </button>
      </div>
    </div>
  </form>
  {#if band}
    <Connections {band} />
  {/if}
  <div class="block">
    <button type="button" class="btn btn-secondary" onclick={() => logout()}>
      Log out
    </button>
  </div>
{/if}

<style>
.block {
  padding: 18px 28px 20px;
  border-bottom: var(--rule-2);
}
.inline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.inline .input {
  flex: 1;
}
.choose {
  list-style: none;
  margin: 0;
  padding: 0 24px;
}
.choose li {
  margin-bottom: 8px;
}
.choose .empty {
  padding: 24px 0;
}
@media (max-width: 899px) {
  .block {
    padding-inline: 16px;
  }
  .choose {
    padding-inline: 16px;
  }
}
</style>
