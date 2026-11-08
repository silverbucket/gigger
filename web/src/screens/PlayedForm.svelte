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
} from "@showday/schemas";
import { untrack } from "svelte";
import BottomActionBar from "../components/BottomActionBar.svelte";
import CurrencyOptions from "../components/CurrencyOptions.svelte";
import Icon from "../components/Icon.svelte";
import PhoneHeader from "../components/PhoneHeader.svelte";
import Segmented from "../components/Segmented.svelte";
import Tag from "../components/Tag.svelte";

/** Mark played as one long form: the room, then the money, with the total always in view. */
let {
  gig,
  venueName = "",
  currency,
  used = [],
  busy,
  onsave,
  oncancel,
}: {
  gig: Gig;
  venueName?: string;
  currency: string;
  /** Currencies the band has used, suggested first. */
  used?: string[];
  busy: boolean;
  onsave: (survey: SurveyInput, earnings: Earnings) => Promise<void>;
  oncancel: () => void;
} = $props();
let rating = $state<number>();
let capacity = $state<VenueSurvey["capacity"]>();
let attendance = $state<number>();
let setting = $state<VenueSurvey["setting"]>();
let pa = $state<VenueSurvey["pa"]>();
let stageNotes = $state("");
let playAgain = $state<"yes" | "no">();
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
let split = $state<"none" | "bands" | "amount">("none");
let numberOfBands = $state<number>();
let handedOver = $state<number>();
let takeHomeOverride = $state<number>();
// A prefilled fee is an override already, so its fields start open.
let overriding = $state(fee !== undefined);
// The input owns the currency outright: an empty field fails validation rather
// than silently falling back to the band's currency.
let effectiveCurrency = $state(
  untrack(() => fee?.currency ?? currency.toUpperCase()),
);
let attempted = $state(false);
const cents = (amount: number) => Math.round(amount * 100) / 100;
const num = (value: number | undefined | null) =>
  typeof value === "number" && !Number.isNaN(value) ? value : undefined;
const summed = $derived(
  cents((num(door) ?? 0) + (num(hat) ?? 0) + (num(bar) ?? 0)),
);
const total = $derived(num(totalOverride) ?? summed);
const calculated = $derived(
  calculateTakeHome(
    total,
    split === "bands" ? num(numberOfBands) : undefined,
    split === "amount" ? num(handedOver) : undefined,
  ),
);
const takeHome = $derived(num(takeHomeOverride) ?? calculated);
const money = (amount: number) =>
  formatMoney(amount, effectiveCurrency, navigator.language);
const feeMatchesCurrency = () =>
  fee !== undefined && fee.currency === effectiveCurrency.toUpperCase();
const splitLine = $derived(
  split === "bands" && num(numberOfBands)
    ? `${money(total)} total ÷ ${numberOfBands} bands`
    : split === "amount" && num(handedOver) !== undefined
      ? `${money(total)} total − ${money(handedOver ?? 0)} handed over`
      : `${money(total)} total`,
);
const missing = $derived(
  [
    !rating && "rating",
    !capacity && "capacity",
    !setting && "setting",
    !playAgain && "play again",
    !pa && "PA",
  ].filter(Boolean),
);
function changeDeal(value: Earnings["dealType"]) {
  dealType = value;
  if (dealType === "fixed fee" && totalOverride === undefined)
    totalOverride = feeMatchesCurrency() ? fee?.amount : undefined;
  else if (dealType !== "fixed fee" && totalOverride === fee?.amount)
    totalOverride = undefined;
}
function changeCurrency(event: Event & { currentTarget: HTMLInputElement }) {
  effectiveCurrency = event.currentTarget.value;
  if (!feeMatchesCurrency() && totalOverride === fee?.amount)
    totalOverride = undefined;
}
const keepFocus = (event: PointerEvent) => event.preventDefault();
async function submit(event: SubmitEvent) {
  event.preventDefault();
  attempted = true;
  if (!rating || !capacity || !setting || !pa || !playAgain) return;
  await onsave(
    {
      rating,
      capacity,
      setting,
      pa,
      stageNotes,
      playAgain: playAgain === "yes",
      ...(num(attendance) !== undefined
        ? { attendance: Math.round(attendance ?? 0) }
        : {}),
    },
    {
      dealType,
      ...(num(door) !== undefined ? { door } : {}),
      ...(num(hat) !== undefined ? { hat } : {}),
      ...(num(bar) !== undefined ? { bar } : {}),
      total,
      ...(split === "bands" && num(numberOfBands) !== undefined
        ? { numberOfBands }
        : {}),
      ...(split === "amount" && num(handedOver) !== undefined
        ? { handedOver }
        : {}),
      takeHome,
      currency: effectiveCurrency.toUpperCase(),
    },
  );
}
const dealLabels: Record<Earnings["dealType"], string> = {
  "fixed fee": "Fixed fee",
  door: "Door",
  "pass the hat": "Pass the hat",
  "bar percentage": "Bar %",
  mixed: "Mixed",
};
const paLabels: Record<VenueSurvey["pa"], string> = {
  "venue provided": "Venue provided",
  "we brought our own": "We brought ours",
  mixed: "Mixed",
};
</script>

<PhoneHeader title="Mark played" onclose={oncancel} />

<form
  class="played"
  onsubmit={submit}
  oninvalidcapture={() => {
    attempted = true;
  }}
>
  <div class="detail-head head">
    <p class="kicker">Mark played</p>
    <h2>{gig.title}</h2>
    <p>{venueName}</p>
    <button
      type="button"
      class="btn btn-icon close"
      aria-label="Close"
      onclick={oncancel}
    >
      <Icon name="x" size={20} />
    </button>
  </div>

  <fieldset disabled={busy} class="part">
    <legend class="part-head">
      <span class="title">The room</span>
      <span class="muted"
        >Venue survey · saved in your account; sharing with other bands comes
        later</span
      >
    </legend>
    <div class="field">
      <span class="field-label">Rating</span>
      <Segmented
        label="Rating"
        options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))}
        bind:value={rating}
        columns={5}
        required
      />
    </div>
    <div class="field">
      <span class="field-label">Capacity</span>
      <Segmented
        label="Capacity"
        options={capacities.map((c) => ({
          value: c,
          label: c === "under 50" ? "<50" : c,
        }))}
        bind:value={capacity}
        columns={5}
        required
      />
    </div>
    <div class="field">
      <label for="survey-attendance">Attendance on the night</label>
      <input
        id="survey-attendance"
        class="input"
        type="number"
        min="0"
        step="1"
        inputmode="numeric"
        placeholder="People in the room"
        bind:value={attendance}
      >
    </div>
    <div class="field-row two">
      <div class="field">
        <span class="field-label">Setting</span>
        <Segmented
          label="Indoor or outdoor"
          options={[
            { value: "indoor", label: "Indoor" },
            { value: "outdoor", label: "Outdoor" },
          ]}
          bind:value={setting}
          columns={2}
          required
        />
      </div>
      <div class="field">
        <span class="field-label">Play again?</span>
        <Segmented
          label="Would you play here again?"
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
          bind:value={playAgain}
          columns={2}
          required
        />
      </div>
    </div>
    <div class="field">
      <span class="field-label">PA</span>
      <Segmented
        label="PA"
        options={paOptions.map((p) => ({ value: p, label: paLabels[p] }))}
        bind:value={pa}
        columns={3}
        required
      />
    </div>
    <div class="field">
      <label for="survey-notes">Stage notes · optional</label>
      <textarea
        id="survey-notes"
        class="input"
        bind:value={stageNotes}
      ></textarea>
    </div>
  </fieldset>

  <fieldset disabled={busy} class="part">
    <legend class="part-head">
      <span class="title">The money</span>
      <Tag kind="private">Private</Tag>
    </legend>
    <div class="field">
      <span class="field-label">Deal type</span>
      <Segmented
        label="Deal type"
        options={dealTypes.map((d) => ({ value: d, label: dealLabels[d] }))}
        value={dealType}
        onchange={changeDeal}
        columns={3}
      />
    </div>
    <div class="field-row three">
      <div class="field">
        <label for="earn-door">Door takings</label>
        <input
          id="earn-door"
          class="input"
          type="number"
          min="0"
          step="0.01"
          inputmode="decimal"
          bind:value={door}
        >
      </div>
      <div class="field">
        <label for="earn-hat">Hat takings</label>
        <input
          id="earn-hat"
          class="input"
          type="number"
          min="0"
          step="0.01"
          inputmode="decimal"
          bind:value={hat}
        >
      </div>
      <div class="field">
        <label for="earn-bar">Bar takings</label>
        <input
          id="earn-bar"
          class="input"
          type="number"
          min="0"
          step="0.01"
          inputmode="decimal"
          bind:value={bar}
        >
      </div>
    </div>
    <p class="total-row">
      <span>Total takings</span><strong>{money(total)}</strong>
    </p>
    <div class="field">
      <span class="field-label">Split with other bands</span>
      <Segmented
        label="Split with other bands"
        options={[
          { value: "none", label: "No split" },
          {
            value: "bands",
            label: num(numberOfBands)
              ? `Equally · ${numberOfBands}`
              : "Equally",
          },
          { value: "amount", label: "Handed over" },
        ]}
        bind:value={split}
        columns={3}
      />
    </div>
    {#if split === "bands"}
      <div class="field">
        <label for="earn-bands">Number of bands, including yours</label>
        <input
          id="earn-bands"
          class="input"
          type="number"
          min="1"
          step="1"
          required
          bind:value={numberOfBands}
        >
      </div>
    {/if}
    {#if split === "amount"}
      <div class="field">
        <label for="earn-handed">Amount handed over</label>
        <input
          id="earn-handed"
          class="input"
          type="number"
          min="0"
          max={total}
          step="0.01"
          required
          bind:value={handedOver}
        >
      </div>
    {/if}
    {#if overriding}
      <div class="field-row">
        <div class="field">
          <label for="earn-total">Total including fixed fee</label>
          <input
            id="earn-total"
            class="input"
            type="number"
            min="0"
            step="0.01"
            placeholder={String(summed)}
            bind:value={totalOverride}
          >
        </div>
        <div class="field">
          <label for="earn-take-home">Take-home amount</label>
          <input
            id="earn-take-home"
            class="input"
            type="number"
            min="0"
            step="0.01"
            placeholder={String(calculated)}
            bind:value={takeHomeOverride}
          >
        </div>
      </div>
    {:else}
      <button
        type="button"
        class="btn btn-ghost override"
        onclick={() => {
          overriding = true;
        }}
      >
        Override total or take-home
      </button>
    {/if}
    <div class="field currency">
      <label for="earn-currency">Currency</label>
      <input
        id="earn-currency"
        class="input"
        required
        pattern={"[A-Za-z]{3}"}
        maxlength="3"
        list="earn-currency-options"
        autocomplete="off"
        value={effectiveCurrency}
        oninput={changeCurrency}
      >
      <CurrencyOptions
        id="earn-currency-options"
        first={[fee?.currency, currency, ...used]}
      />
    </div>
  </fieldset>

  <div class="spacer"></div>
  <BottomActionBar>
    {#snippet summary()}
      <span>{splitLine}</span>
      <span class="took"
        >Your band took home <strong>{money(takeHome)}</strong></span
      >
    {/snippet}
    <!-- Pressing a button must not blur the focused field: closing a phone
         keyboard reflows the page mid-tap and swallows the first click. -->
    <button
      type="submit"
      class="btn btn-primary btn-wide"
      disabled={busy}
      onpointerdown={keepFocus}
    >
      {busy ? "Saving…" : "Save and mark played"}
      <Icon name="arrow-right" stroke={2.5} />
    </button>
    <button
      type="button"
      class="btn btn-secondary"
      disabled={busy}
      onpointerdown={keepFocus}
      onclick={oncancel}
    >
      Cancel
    </button>
    {#if attempted && missing.length}
      <p class="missing alert-text" role="alert">
        Still to fill in: {missing.join(", ")}.
      </p>
    {/if}
  </BottomActionBar>
</form>

<style>
.played {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.head {
  position: relative;
  padding-right: 72px;
}
.close {
  position: absolute;
  top: 18px;
  right: 20px;
}
.part {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 28px 24px;
  border-bottom: var(--rule);
}
.part-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  width: 100%;
  float: left;
  margin-bottom: 4px;
}
.part-head .muted {
  font-size: 12px;
  text-align: right;
}
.title {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.total-row {
  display: flex;
  justify-content: space-between;
  margin: 0;
  padding-top: 10px;
  border-top: var(--rule);
  font-size: 14px;
}
.override {
  align-self: flex-start;
  padding-inline: 0;
}
.currency {
  max-width: 140px;
}
.took strong {
  font-size: 26px;
  font-weight: 600;
  color: var(--color-accent-700);
  letter-spacing: -0.02em;
  margin-left: 4px;
}
.missing {
  flex-basis: 100%;
  margin: 4px 0 0;
  font-size: 13px;
}
.spacer {
  flex: 1;
}
@media (max-width: 899px) {
  .head {
    display: none;
  }
  .part {
    padding-inline: 16px;
  }
  .part-head {
    flex-direction: column;
  }
  .part-head .muted {
    text-align: left;
  }
}
</style>
