<script lang="ts">
import {
  type Contact,
  formatFee,
  type Gig,
  type Venue,
} from "@showday/schemas";
import { longDate, mapUrl } from "../lib/format";
import { placeOf, privateShowName } from "../lib/gigs";

/** The printable gig sheet. Hidden on screen; Print shows only this. */
let {
  gig,
  bandName,
  currency,
  venue,
  contacts,
}: {
  gig: Gig;
  bandName: string;
  currency: string;
  venue?: Venue;
  contacts: Contact[];
} = $props();
const place = $derived(
  gig.privateShow ? privateShowName : (venue?.name ?? gig.venue),
);
const address = $derived(
  [(venue?.address ?? gig.address)?.trim(), placeOf(venue)]
    .filter(Boolean)
    .join(", "),
);
const fee = $derived(formatFee(gig.fee, currency, navigator.language));
</script>

<article class="gig-sheet" aria-label="Gig sheet">
  <p class="kicker">Gig sheet</p>
  <h1>{gig.title}</h1>
  <p class="date"><time datetime={gig.date}>{longDate(gig.date)}</time></p>
  <dl>
    {#if bandName.trim()}
      <dt>Band</dt>
      <dd>{bandName}</dd>
    {/if}
    {#if place}
      <dt>Venue</dt>
      <dd>{place}</dd>
    {/if}
    {#if address}
      <dt>Address</dt>
      <dd class="address">
        {address}
        <a href={mapUrl(address)} target="_blank" rel="noreferrer"
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
      <dd class="pre">{gig.notes}</dd>
    {/if}
  </dl>
</article>

<style>
.address {
  white-space: pre-line;
}
.gig-sheet {
  display: none;
}
h1 {
  font-size: 36px;
  margin: 4px 0;
}
.date {
  font-size: 16px;
  margin: 0 0 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid #201e1d;
}
dl {
  display: grid;
  grid-template-columns: 140px 1fr;
  margin: 0;
}
dt,
dd {
  margin: 0;
  padding: 8px 0;
  border-bottom: 1px solid #999;
}
dt {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
dd p {
  margin: 0 0 4px;
}
a {
  color: inherit;
  margin-left: 8px;
}
/* App.svelte hides everything else when printing. */
@media print {
  .gig-sheet {
    display: block;
    padding: 1cm;
    background: white;
  }
  dt {
    break-after: avoid;
  }
  dd {
    break-inside: avoid;
  }
}
</style>
