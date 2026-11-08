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

async function saveCurrency(event: SubmitEvent) {
  event.preventDefault();
  if (!band) return;
  const form = event.currentTarget as HTMLFormElement;
  const input = form.querySelector("#band-currency");
  const bandId = band.id;
  if (currencyDraft && currencyDraft.bandId !== bandId) currencyDraft = null;
  const text = input instanceof HTMLInputElement ? input.value : currencyText;
  currencyDraft = { bandId, text };
  const value = {
    ...$state.snapshot(band),
    currency: text.toUpperCase(),
  };
  const saved = value.currency;
  const ok = await run(async () => {
    await bands.save("band", value.id, value);
  });
  if (!ok) return;
  const synced = data.current?.band;
  if (synced && (synced.currency ?? "EUR") === saved) currencyDraft = null;
  else currencyDraft = { bandId, text: saved };
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
  {#if ui.phone}
    <div class="block phone-logout">
      <button
        type="button"
        class="btn btn-secondary btn-wide"
        onclick={() => logout()}
      >
        Log out
      </button>
    </div>
  {/if}
{:else}
  <div class="settings">
    <div class="page-head">
      <div>
        <h1>Band settings</h1>
        <p>For {current.band.name}: currency, email and Meta connections.</p>
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
              if (!band) return;
              currencyDraft = {
                bandId: band.id,
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
    {#if ui.phone}
      <div class="block">
        <button
          type="button"
          class="btn btn-secondary"
          onclick={() => logout()}
        >
          Log out
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
.settings {
  max-width: 760px;
}
.block {
  padding: 20px 28px;
  border-bottom: var(--rule);
}
.phone-logout {
  padding-top: 0;
}
.inline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 360px;
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
  .settings {
    padding-bottom: calc(var(--tabbar) + 16px);
  }
  .block {
    padding-inline: 16px;
  }
  .choose {
    padding-inline: 16px;
  }
  .phone-logout {
    padding-inline: 16px;
    padding-bottom: calc(var(--tabbar) + 16px);
  }
}
</style>
