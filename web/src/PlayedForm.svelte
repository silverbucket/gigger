<script lang="ts">
import {
  calculateTakeHome,
  capacities,
  dealTypes,
  type Earnings,
  formatMoney,
  type Gig,
  paOptions,
  type SurveyInput,
  type VenueSurvey,
} from "@gigger/schemas";
import { untrack } from "svelte";

let {
  gig,
  currency,
  busy,
  onsave,
  oncancel,
}: {
  gig: Gig;
  currency: string;
  busy: boolean;
  onsave: (survey: SurveyInput, earnings: Earnings) => Promise<void>;
  oncancel: () => void;
} = $props();
let rating = $state<number | "">("");
let capacity = $state<VenueSurvey["capacity"] | "">("");
let setting = $state<VenueSurvey["setting"] | "">("");
let pa = $state<VenueSurvey["pa"] | "">("");
let stageNotes = $state("");
let playAgain = $state("");
let dealType = $state<Earnings["dealType"]>("fixed fee");
let door = $state<number>();
let hat = $state<number>();
let bar = $state<number>();
// A fixed fee pre-fills the total together with its own currency, never relabelled.
const fee = untrack(() =>
  typeof gig.fee === "object" && typeof gig.fee.amount === "number"
    ? {
        amount: gig.fee.amount,
        currency: (gig.fee.currency ?? currency).toUpperCase(),
      }
    : undefined,
);
let totalOverride = $state<number | undefined>(fee?.amount);
let split = $state("none");
let numberOfBands = $state<number>();
let handedOver = $state<number>();
let takeHomeOverride = $state<number>();
let selectedCurrency = $state(fee?.currency ?? "");
const effectiveCurrency = $derived(selectedCurrency || currency);
const total = $derived(totalOverride ?? (door ?? 0) + (hat ?? 0) + (bar ?? 0));
const calculated = $derived(
  calculateTakeHome(
    total,
    split === "bands" ? numberOfBands : undefined,
    split === "amount" ? handedOver : undefined,
  ),
);
const takeHome = $derived(takeHomeOverride ?? calculated);
const money = (amount: number) =>
  formatMoney(amount, effectiveCurrency, navigator.language);
const feeMatchesCurrency = () =>
  fee !== undefined && fee.currency === effectiveCurrency.toUpperCase();
function changeDeal(event: Event & { currentTarget: HTMLSelectElement }) {
  dealType = event.currentTarget.value as Earnings["dealType"];
  if (dealType === "fixed fee" && totalOverride === undefined)
    totalOverride = feeMatchesCurrency() ? fee?.amount : undefined;
  else if (dealType !== "fixed fee" && totalOverride === fee?.amount)
    totalOverride = undefined;
}
function changeCurrency(event: Event & { currentTarget: HTMLInputElement }) {
  selectedCurrency = event.currentTarget.value;
  if (
    selectedCurrency.length === 3 &&
    !feeMatchesCurrency() &&
    totalOverride === fee?.amount
  )
    totalOverride = undefined;
}
async function submit(event: SubmitEvent) {
  event.preventDefault();
  if (!rating || !capacity || !setting || !pa || !playAgain) return;
  await onsave(
    {
      rating,
      capacity,
      setting,
      pa,
      stageNotes,
      playAgain: playAgain === "yes",
    },
    {
      dealType,
      ...(door !== undefined ? { door } : {}),
      ...(hat !== undefined ? { hat } : {}),
      ...(bar !== undefined ? { bar } : {}),
      total,
      ...(split === "bands" && numberOfBands !== undefined
        ? { numberOfBands }
        : {}),
      ...(split === "amount" && handedOver !== undefined ? { handedOver } : {}),
      takeHome,
      currency: effectiveCurrency.toUpperCase(),
    },
  );
}
</script>
<h3>Mark played: {gig.title}</h3>
<form onsubmit={submit}>
  <fieldset disabled={busy}>
    <legend>Venue survey</legend>
    <p>Saved in your account; sharing with other bands comes later.</p>
    <label for="survey-rating">Rating</label>
    <select id="survey-rating" required bind:value={rating}>
      <option value="" disabled>Choose an option</option>
      {#each [1, 2, 3, 4, 5] as value (value)}
        <option {value}>{value} / 5</option>
      {/each}
    </select>
    <label for="survey-capacity">Capacity</label>
    <select id="survey-capacity" required bind:value={capacity}>
      <option value="" disabled>Choose an option</option>
      {#each capacities as value (value)}
        <option>{value}</option>
      {/each}
    </select>
    <label for="survey-setting">Indoor or outdoor</label>
    <select id="survey-setting" required bind:value={setting}>
      <option value="" disabled>Choose an option</option>
      <option value="indoor">Indoor</option>
      <option value="outdoor">Outdoor</option>
    </select>
    <label for="survey-pa">PA</label>
    <select id="survey-pa" required bind:value={pa}>
      <option value="" disabled>Choose an option</option>
      {#each paOptions as value (value)}
        <option>{value}</option>
      {/each}
    </select>
    <label
      >Stage notes (optional)<textarea
        bind:value={stageNotes}
      ></textarea></label
    >
    <label for="survey-play-again">Would you play here again?</label>
    <select id="survey-play-again" required bind:value={playAgain}>
      <option value="" disabled>Choose an option</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  </fieldset>
  <fieldset disabled={busy}>
    <legend>Your earnings</legend>
    <p>Private, only you can see this</p>
    <label for="deal-type">Deal type</label>
    <select id="deal-type" value={dealType} onchange={changeDeal}>
      {#each dealTypes as value (value)}
        <option>{value}</option>
      {/each}
    </select>
    <label
      >Door takings (optional)<input
        type="number"
        min="0"
        step="0.01"
        bind:value={door}
      ></label
    >
    <label
      >Hat takings (optional)<input
        type="number"
        min="0"
        step="0.01"
        bind:value={hat}
      ></label
    >
    <label
      >Bar takings (optional)<input
        type="number"
        min="0"
        step="0.01"
        bind:value={bar}
      ></label
    >
    <p>Total takings: {money(total)}</p>
    <label
      >Total including fixed fee (optional override)<input
        type="number"
        min="0"
        step="0.01"
        bind:value={totalOverride}
        placeholder={((door ?? 0) + (hat ?? 0) + (bar ?? 0)).toFixed(2)}
      ></label
    >
    <label for="split">Split with other bands</label>
    <select id="split" bind:value={split}>
      <option value="none">No split</option>
      <option value="bands">Split equally by number of bands</option>
      <option value="amount">Amount handed over</option>
    </select>
    {#if split === "bands"}
      <label
        >Number of bands (including yours)<input
          type="number"
          min="1"
          step="1"
          required
          bind:value={numberOfBands}
        ></label
      >
    {/if}
    {#if split === "amount"}
      <label
        >Amount handed over<input
          type="number"
          min="0"
          max={total}
          step="0.01"
          required
          bind:value={handedOver}
        ></label
      >
    {/if}
    <p>Your band took home: {money(takeHome)}</p>
    <label
      >Take-home amount (optional override)<input
        type="number"
        min="0"
        step="0.01"
        bind:value={takeHomeOverride}
        placeholder={calculated.toFixed(2)}
      ></label
    >
    <label
      >Currency<input
        required
        pattern={"[A-Za-z]{3}"}
        maxlength="3"
        value={effectiveCurrency}
        oninput={changeCurrency}
      ></label
    >
  </fieldset>
  <button type="submit" disabled={busy}>
    {busy ? "Saving…" : "Save and mark played"}
  </button>
  <button type="button" disabled={busy} onclick={oncancel}>Cancel</button>
</form>
<style>
form {
  max-width: 40rem;
}
fieldset {
  margin-block: 1.5rem;
  padding: 1rem;
  border: 1px solid #82958a;
  border-radius: 6px;
}
legend {
  font-weight: 700;
  font-size: 1.2rem;
}
label {
  display: grid;
  gap: 0.3rem;
  margin-block: 1rem;
}
label:has(+ select) {
  margin-bottom: 0.3rem;
}
select {
  display: block;
  width: 100%;
  margin-bottom: 1rem;
}
input,
select,
textarea,
button {
  font: inherit;
  padding: 0.65rem;
  min-height: 44px;
  box-sizing: border-box;
  max-width: 100%;
}
button {
  margin: 0.25rem;
}
</style>
