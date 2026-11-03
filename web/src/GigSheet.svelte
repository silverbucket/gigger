<script lang="ts">
import { type Contact, formatFee, type Gig, type Venue } from "@gigger/schemas";

let {
  gig,
  bandName,
  currency,
  venue,
  contacts,
  onback,
}: {
  gig: Gig;
  bandName: string;
  currency: string;
  venue?: Venue;
  contacts: Contact[];
  onback: () => void;
} = $props();
const address = $derived((venue?.address ?? gig.address)?.trim());
const fee = $derived(formatFee(gig.fee, currency, navigator.language));
</script>
<article class="gig-sheet">
  <div class="actions">
    <button type="button" onclick={onback}>Back to gig</button
    ><button type="button" onclick={() => window.print()}>
      Print gig sheet
    </button>
  </div>
  <h3>Gig sheet — {gig.title}</h3>
  <dl>
    {#if bandName.trim()}
      <dt>Band</dt>
      <dd>{bandName}</dd>
    {/if}
    {#if gig.date}
      <dt>Date</dt>
      <dd><time datetime={gig.date}>{gig.date}</time></dd>
    {/if}
    {#if venue?.name || gig.venue}
      <dt>Venue</dt>
      <dd>{venue?.name ?? gig.venue}</dd>
    {/if}
    {#if address}
      <dt>Address</dt>
      <dd>
        {address}
        <a
          href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`}
          target="_blank"
          rel="noreferrer"
          >Map and directions</a
        >
      </dd>
    {/if}
    {#if contacts.length || gig.contacts?.length}
      <dt>Contact</dt>
      <dd>
        {#each contacts as contact (contact.id)}
          <p>
            {[
              contact.name,
              contact.phone,
              contact.email,
              contact.messenger,
              contact.instagram,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        {/each}
        {#each gig.contacts ?? [] as contact, i (i)}
          {#if contact.trim()}
            <p>{contact}</p>
          {/if}
        {/each}
      </dd>
    {/if}
    {#if gig.loadIn}
      <dt>Arrival time</dt>
      <dd>{gig.loadIn}</dd>
    {/if}
    {#if gig.soundcheck}
      <dt>Soundcheck</dt>
      <dd>{gig.soundcheck}</dd>
    {/if}
    {#if gig.setTimes?.length}
      <dt>Set start</dt>
      <dd>{gig.setTimes.join(", ")}</dd>
    {/if}
    {#if gig.setLength}
      <dt>Set length</dt>
      <dd>{gig.setLength} minutes</dd>
    {/if}
    {#if fee}
      <dt>Fee</dt>
      <dd>{fee}</dd>
    {/if}
    {#if typeof gig.fee === "object" &&
      gig.fee.extras.some((extra) => extra.trim())}
      <dt>Extras</dt>
      <dd>{gig.fee.extras.filter((extra) => extra.trim()).join(", ")}</dd>
    {/if}
    {#if gig.notes?.trim()}
      <dt>Notes</dt>
      <dd class="notes">{gig.notes}</dd>
    {/if}
  </dl>
</article>
<style>
.gig-sheet {
  max-width: 44rem;
  overflow-wrap: anywhere;
}
dt {
  font-weight: 700;
  margin-top: 1rem;
}
dd {
  margin: 0.25rem 0 1rem;
}
dd p {
  margin-block: 0.4rem;
}
.notes {
  white-space: pre-wrap;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
button {
  min-height: 44px;
  padding: 0.65rem;
  font: inherit;
}
@media print {
  :global(body *) {
    visibility: hidden;
  }
  .gig-sheet,
  .gig-sheet :global(*) {
    visibility: visible;
  }
  .gig-sheet {
    position: absolute;
    inset: 0;
    max-width: none;
    padding: 1cm;
  }
  .actions {
    display: none;
  }
  dt {
    break-after: avoid;
  }
  dd {
    break-inside: avoid;
  }
}
</style>
