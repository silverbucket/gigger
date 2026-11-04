<script lang="ts">
import {
  currencyForLocale,
  type Member,
  publicStatuses,
  slugify,
  slugPattern,
} from "@gigger/schemas";
import BottomActionBar from "../components/BottomActionBar.svelte";
import ChannelGrid from "../components/ChannelGrid.svelte";
import Icon from "../components/Icon.svelte";
import PhoneHeader from "../components/PhoneHeader.svelte";
import SectionLabel from "../components/SectionLabel.svelte";
import Segmented from "../components/Segmented.svelte";
import Tag from "../components/Tag.svelte";
import { api } from "../lib/account.svelte";
import { data } from "../lib/data.svelte";
import { initials, normalize, plural } from "../lib/format";
import { router } from "../lib/router.svelte";
import { run, ui } from "../lib/ui.svelte";
import { bands, logout } from "../storage";
import Connections from "./Connections.svelte";

const current = $derived(data.current);
const band = $derived(current?.band);
const tab = $derived(
  (["members", "public", "settings"] as const).find(
    (t) => t === router.parts[0],
  ) ?? "members",
);
const memberRoute = $derived(
  router.parts[0] === "member" ? (router.parts[1] ?? "new") : "",
);

// Member form: the always-visible add row, or the row being edited.
let editingId = $state("");
let form = $state({ name: "", email: "", phone: "", messenger: "" });
const resetForm = () => {
  editingId = "";
  form = { name: "", email: "", phone: "", messenger: "" };
};
function edit(member: Member) {
  editingId = member.id;
  form = {
    name: member.name,
    email: member.email ?? "",
    phone: member.phone ?? "",
    messenger: member.messenger ?? "",
  };
}
$effect(() => {
  // Phone: the member screen edits the member in its route.
  const id = memberRoute;
  if (!id) return;
  const member = data.current?.members.find((m) => m.id === id);
  if (member) edit(member);
  else resetForm();
});
const editedMember = $derived(current?.members.find((m) => m.id === editingId));
/** A contact with the same name whose details could be copied over. */
const contactMatch = $derived.by(() => {
  const name = normalize(form.name);
  if (!name || !current) return undefined;
  const contact = current.contacts.find((c) => normalize(c.name) === name);
  if (!contact) return undefined;
  const extra =
    (contact.email && contact.email !== form.email) ||
    (contact.phone && contact.phone !== form.phone) ||
    (contact.messenger && contact.messenger !== form.messenger);
  return extra ? contact : undefined;
});
function useContact() {
  const c = contactMatch;
  if (!c) return;
  form = {
    name: form.name,
    email: c.email ?? form.email,
    phone: c.phone ?? form.phone,
    messenger: c.messenger ?? form.messenger,
  };
}
async function saveMember(event: SubmitEvent) {
  event.preventDefault();
  if (!band || !form.name.trim()) return;
  // Keep the generated id, not just the saved value, so a retry after a
  // save that succeeded but failed to reload reuses it instead of
  // creating a duplicate member.
  editingId ||= crypto.randomUUID();
  const value: Member = {
    id: editingId,
    name: form.name.trim(),
    ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
    ...(form.email.trim() ? { email: form.email.trim() } : {}),
    ...(form.messenger.trim() ? { messenger: form.messenger.trim() } : {}),
  };
  const bandId = band.id;
  if (await run(() => bands.save("member", bandId, value))) {
    resetForm();
    if (memberRoute) router.back("band");
  }
}
function removeMember(member: Member) {
  if (!band || !confirm(`Remove ${member.name} from this band?`)) return;
  const bandId = band.id;
  void run(async () => {
    await bands.removeMember(bandId, member.id);
    if (editingId === member.id) resetForm();
  });
}
const memberChannels = (m: {
  email?: string;
  phone?: string;
  messenger?: string;
}) => [
  {
    label: "Email",
    short: "Email",
    verb: "Email",
    value: m.email,
    href: m.email && `mailto:${m.email}`,
  },
  {
    label: "Phone",
    short: "Phone",
    verb: "Call",
    value: m.phone,
    href: m.phone && `tel:${m.phone.replace(/\s/g, "")}`,
  },
  {
    label: "Messenger",
    short: "Messenger",
    verb: "Message",
    value: m.messenger,
    href: m.messenger && `https://m.me/${encodeURIComponent(m.messenger)}`,
  },
];

// Currency and public page drafts survive syncs until saved or another band is shown.
let currencyDraft = $state<{ bandId: string; text: string } | null>(null);
const currencyText = $derived(
  currencyDraft && currencyDraft.bandId === band?.id
    ? currencyDraft.text
    : (band?.currency ?? "EUR"),
);
let slugDraft = $state<{ bandId: string; text: string } | null>(null);
const slugText = $derived(
  slugDraft && slugDraft.bandId === band?.id
    ? slugDraft.text
    : (band?.slug ?? slugify(band?.name ?? "")),
);
const pageUrl = $derived(band?.slug ? `${location.origin}/b/${band.slug}` : "");
const listed = $derived(
  current?.gigs.filter((g) => publicStatuses.includes(g.status)).length ?? 0,
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
function publish(event: SubmitEvent) {
  event.preventDefault();
  if (!band) return;
  const previous = $state.snapshot(band);
  const slug = slugText.trim();
  void run(async () => {
    await api(
      "/api/public/pages",
      { method: "POST", body: { bandId: previous.id, slug } },
      "Could not publish the page. Please retry.",
    );
    if (previous.slug && previous.slug !== slug)
      await bands.queueOldSlugCleanup(previous.id, previous.slug);
    await bands.save("band", previous.id, {
      ...previous,
      slug,
      locale: navigator.language,
    });
    await bands.publishBand(previous.id, previous.slug);
    slugDraft = null;
  }, "Could not publish the page. Please retry.");
}

// New band.
let creating = $state(data.all.length === 0);
let newName = $state("");
let newCurrency = $state(currencyForLocale(navigator.language));
function createBand(event: SubmitEvent) {
  event.preventDefault();
  const value = {
    id: crypto.randomUUID(),
    name: newName.trim(),
    currency: newCurrency.toUpperCase(),
  };
  if (!value.name) return;
  void run(async () => {
    await bands.save("band", value.id, value);
    data.choose(value.id);
    newName = "";
    creating = false;
  });
}
</script>

{#snippet memberFields(compact: boolean)}
  <div class="field">
    <label for="member-name">Name <span class="required">*</span></label>
    <input
      id="member-name"
      class="input"
      bind:value={form.name}
      required
      placeholder={compact ? "New member" : ""}
    >
  </div>
  {#if !compact}
    <p class="label optional">Optional</p>
  {/if}
  <div class="field">
    <label for="member-email">Email{compact ? "" : " address"}</label>
    <input id="member-email" class="input" type="email" bind:value={form.email}>
  </div>
  <div class="field">
    <label for="member-phone">Phone{compact ? "" : " number"}</label>
    <input id="member-phone" class="input" type="tel" bind:value={form.phone}>
  </div>
  <div class="field">
    <label for="member-messenger">Messenger{compact ? "" : " handle"}</label>
    <input id="member-messenger" class="input" bind:value={form.messenger}>
  </div>
{/snippet}

{#snippet contactOffer()}
  {#if contactMatch}
    <div class="offer" role="status">
      <strong>Already a contact?</strong>
      <p>
        {contactMatch.name}
        is in your contacts ({[
          contactMatch.email,
          contactMatch.phone,
          contactMatch.messenger,
        ]
          .filter(Boolean)
          .join(" · ")}). Copy their details across?
      </p>
      <button type="button" class="btn btn-ghost" onclick={useContact}>
        Use contact details
      </button>
    </div>
  {/if}
{/snippet}

{#snippet yourBands()}
  <section class="block">
    <h3 class="label">Your bands</h3>
  </section>
  <ul class="bands">
    {#each data.all as item (item.band.id)}
      {@const viewing = item.band.id === band?.id}
      <li class:viewing>
        <span class="what">
          <strong>{item.band.name}</strong>
          <span class="sub">
            {plural(item.members.length, "member")}
            · {item.band.currency ?? "EUR"} ·
            {item.band.slug ? "public page live" : "not published"}
          </span>
        </span>
        {#if viewing}
          <span class="viewing-label">Viewing</span>
        {:else}
          <button
            type="button"
            class="btn"
            onclick={() => data.choose(item.band.id)}
          >
            Switch <Icon name="arrow-right" />
          </button>
        {/if}
      </li>
    {/each}
  </ul>
  {#if creating}
    <form id="new-band" class="block form" onsubmit={createBand}>
      <h3 class="label">Create a band</h3>
      <fieldset class="field-row ports" disabled={ui.busy}>
        <div class="field">
          <label for="new-band-name">Band name</label>
          <input
            id="new-band-name"
            class="input"
            bind:value={newName}
            required
            maxlength="200"
          >
        </div>
        <div class="field">
          <label for="new-band-currency">Currency</label>
          <input
            id="new-band-currency"
            class="input"
            bind:value={newCurrency}
            required
            pattern={"[A-Za-z]{3}"}
            maxlength="3"
          >
        </div>
      </fieldset>
      <div class="actions">
        <button type="submit" class="btn btn-primary" disabled={ui.busy}>
          Create band
        </button>
        {#if data.all.length}
          <button
            type="button"
            class="btn btn-ghost"
            onclick={() => (creating = false)}
          >
            Cancel
          </button>
        {/if}
      </div>
    </form>
  {:else}
    <button
      type="button"
      class="btn btn-ghost new-band"
      aria-expanded={creating}
      onclick={() => (creating = true)}
    >
      <Icon name="plus" />
      New band
    </button>
  {/if}
{/snippet}

{#snippet publicPage()}
  {#if band}
    <section class="block">
      <h3 class="label">Public page</h3>
      <div class="pub-head">
        <strong class="big">{band.slug ? "Published" : "Not published"}</strong>
        {#if band.slug}
          <Tag kind="accent">{plural(listed, "gig")} listed</Tag>
        {/if}
      </div>
      <form class="form" onsubmit={publish}>
        <div class="field">
          <label for="page-address">Page address</label>
          <div class="prefix">
            <span aria-hidden="true">{location.host}/b/</span>
            <input
              id="page-address"
              class="input"
              name="slug"
              value={slugText}
              oninput={(event) => {
                slugDraft = {
                  bandId: band.id,
                  text: event.currentTarget.value,
                };
              }}
              pattern={slugPattern.slice(1, -1)}
              maxlength="60"
              required
            >
          </div>
        </div>
        <p class="hint">
          Fans see confirmed and played gigs: date, start time, venue, city,
          ticket link and description. Fees, contacts, notes and earnings stay
          private.
        </p>
        <div class="actions">
          {#if pageUrl}
            <a
              class="btn btn-secondary"
              href={pageUrl}
              target="_blank"
              rel="noreferrer"
              >Open page <Icon name="arrow-up-right" /></a
            >
            <a
              class="btn btn-secondary"
              href={`/b/${band.slug}/export.zip`}
              download
              >Export static page (.zip)</a
            >
            <button
              type="submit"
              class="btn btn-ghost"
              disabled={!data.loaded || ui.busy}
            >
              Save address
            </button>
          {:else}
            <button
              type="submit"
              class="btn btn-primary"
              disabled={!data.loaded || ui.busy}
            >
              Publish page
            </button>
          {/if}
        </div>
      </form>
    </section>
  {/if}
{/snippet}

{#snippet settings()}
  {#if band}
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
    <Connections {band} />
  {/if}
{/snippet}

{#if memberRoute && ui.phone}
  <PhoneHeader
    title={editingId ? "Edit member" : "Add member"}
    onclose={() => router.back("band")}
  />
  <form class="member-screen" onsubmit={saveMember}>
    <fieldset class="form block" disabled={ui.busy}>
      {@render memberFields(false)}
      {@render contactOffer()}
    </fieldset>
    <div class="spacer"></div>
    <BottomActionBar>
      <button type="submit" class="btn btn-primary btn-wide" disabled={ui.busy}>
        {editingId ? "Save member" : `Add to ${band?.name ?? "the band"}`}
        <Icon name="arrow-right" stroke={2.5} />
      </button>
      {#snippet end()}
        {#if editedMember}
          <button
            type="button"
            class="btn btn-ghost"
            onclick={() => {
              if (editedMember) removeMember(editedMember);
              router.back("band");
            }}
          >
            Remove
          </button>
        {/if}
      {/snippet}
    </BottomActionBar>
  </form>
{:else if !current}
  <div class="page-head">
    <div>
      <h1>{data.all.length ? "Your bands" : "Start a band"}</h1>
      <p>
        {data.all.length
          ? "Choose a band to see its members and settings."
          : "Create your first band to get started."}
      </p>
    </div>
  </div>
  <div class="narrow">{@render yourBands()}</div>
{:else if ui.phone}
  <div class="phone">
    <div class="phone-tabs">
      <Segmented
        label="Band page"
        columns={3}
        options={[
          { value: "members", label: "Members" },
          { value: "public", label: "Public page" },
          { value: "settings", label: "Settings" },
        ]}
        value={tab}
        onchange={(value) =>
          router.go(value === "members" ? "band" : `band/${value}`, {
            replace: true,
          })}
      />
    </div>
    {#if tab === "members"}
      <ul class="phone-members">
        {#each current.members as member (member.id)}
          <li>
            <a
              class="phone-member"
              href={`#/band/member/${encodeURIComponent(member.id)}`}
            >
              <span class="avatar">{initials(member.name)}</span>
              <span class="what">
                <strong>{member.name}</strong>
                <span class="sub">
                  {[member.email, member.phone, member.messenger].filter(
                    Boolean,
                  ).length
                    ? plural(
                        [member.email, member.phone, member.messenger].filter(
                          Boolean,
                        ).length,
                        "way to reach",
                        "ways to reach",
                      )
                    : "No contact details yet"}
                </span>
              </span>
            </a>
            <ul class="reach">
              {#each memberChannels(member) as channel (channel.label)}
                <li>
                  {#if channel.value && channel.href}
                    <a href={channel.href}>{channel.verb}</a>
                  {:else}
                    <span
                      >—<span class="sr-only"
                        >No {channel.label.toLowerCase()}</span
                      ></span
                    >
                  {/if}
                </li>
              {/each}
            </ul>
          </li>
        {:else}
          <li class="empty">
            No members yet. Only a name is needed to add one.
          </li>
        {/each}
      </ul>
      <div class="block">
        <a class="btn btn-secondary btn-block" href="#/band/member/new"
          ><span><Icon name="plus" /> Add member</span></a
        >
      </div>
    {:else if tab === "public"}
      {@render publicPage()}
    {:else}
      {@render settings()}
      {@render yourBands()}
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
{:else}
  <div class="desktop">
    <div class="main">
      <div class="page-head">
        <div>
          <p class="kicker">Band · you lead this band</p>
          <h1>{current.band.name}</h1>
        </div>
      </div>
      <SectionLabel>
        Members · {current.members.length}
        {#snippet aside()}
          Only a name is required. Contact details are optional.
        {/snippet}
      </SectionLabel>
      <div class="table-head" aria-hidden="true">
        <span>Name</span><span>Reach on</span><span>Details</span><span></span>
      </div>
      <ul>
        {#each current.members as member (member.id)}
          {#if editingId === member.id}
            <li class="edit-row">
              <form
                class="add"
                onsubmit={saveMember}
                aria-label={`Edit ${member.name}`}
              >
                <fieldset disabled={ui.busy}>
                  {@render memberFields(true)}
                  <div class="add-actions">
                    <button type="submit" class="btn btn-primary">
                      Save member
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost"
                      onclick={resetForm}
                    >
                      Cancel
                    </button>
                  </div>
                </fieldset>
                {@render contactOffer()}
              </form>
            </li>
          {:else}
            <li class="member">
              <span class="name"
                ><span class="avatar">{initials(member.name)}</span
                ><strong>{member.name}</strong></span
              >
              <ChannelGrid channels={memberChannels(member)} />
              <span class="details">
                {#each [member.email, member.phone, member.messenger].filter(
                  Boolean,
                ) as line (line)}
                  <span>{line}</span>
                {:else}
                  <span class="muted">Name only — no contact details</span>
                {/each}
              </span>
              <span class="row-actions">
                <button
                  type="button"
                  class="btn btn-ghost"
                  disabled={ui.busy}
                  onclick={() => edit(member)}
                >
                  Edit<span class="sr-only"> {member.name}</span>
                </button>
                <button
                  type="button"
                  class="btn"
                  disabled={ui.busy}
                  onclick={() => removeMember(member)}
                >
                  Remove<span class="sr-only"> {member.name}</span>
                </button>
              </span>
            </li>
          {/if}
        {:else}
          <li class="empty">No members yet. Add the first one below.</li>
        {/each}
      </ul>
      {#if !editingId}
        <form class="add" onsubmit={saveMember} aria-label="Add a member">
          <fieldset disabled={ui.busy || !data.loaded}>
            {@render memberFields(true)}
            <div class="add-actions">
              <button type="submit" class="btn btn-primary">
                <Icon name="plus" stroke={2.5} />
                Add member
              </button>
            </div>
          </fieldset>
          {@render contactOffer()}
        </form>
      {/if}
    </div>
    <aside class="side">
      {@render publicPage()}
      {@render settings()}
      {@render yourBands()}
    </aside>
  </div>
{/if}

<style>
.desktop {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 560px;
  height: 100%;
}
.main,
.side {
  overflow: auto;
  min-height: 0;
}
.side {
  border-left: var(--rule-ink);
}
.table-head,
.member {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 230px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 10px 24px;
}
.table-head {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-bottom: var(--rule);
}
.member {
  min-height: 68px;
  border-bottom: var(--rule);
}
.name {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.name strong {
  font-size: 16px;
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  background: var(--color-text);
  color: var(--color-bg);
  font-weight: 800;
  font-size: 14px;
}
.details {
  display: flex;
  flex-direction: column;
  font-size: 13px;
  min-width: 0;
}
.row-actions {
  display: flex;
  gap: 4px;
}
.add,
.edit-row .add {
  padding: 16px 24px;
  background: var(--color-surface);
  border-bottom: var(--rule-2);
}
.add fieldset {
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr 1fr auto;
  gap: 8px;
  align-items: end;
}
.add-actions {
  display: flex;
  gap: 4px;
}
.offer {
  margin-top: 12px;
  padding: 12px 14px;
  border: var(--rule-ink);
  background: var(--color-bg);
}
.offer p {
  margin: 4px 0;
  font-size: 13px;
}
.offer .btn {
  padding-inline: 0;
}
.block {
  padding: 18px 28px 20px;
  border-bottom: var(--rule-2);
}
.block h3 {
  margin: 0 0 8px;
  font-family: var(--font-body);
}
.pub-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.big {
  font-size: 22px;
  font-weight: 800;
}
.prefix {
  display: flex;
  align-items: stretch;
}
.prefix span {
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 14px;
  color: var(--muted);
  border: 1px solid var(--color-divider);
  border-right: 0;
  background: var(--color-neutral-200);
  white-space: nowrap;
}
.hint {
  font-size: 13px;
  margin: 0;
}
.actions,
.inline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.inline .input {
  flex: 1;
}
.bands li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 28px;
  border-bottom: var(--rule);
}
.bands .viewing {
  background: var(--select-bg);
  box-shadow: var(--select-mark);
}
.what {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.what strong {
  font-size: 15px;
  font-weight: 800;
}
.sub {
  font-size: 12px;
}
.viewing-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-accent-700);
}
.new-band {
  margin: 12px 28px 24px;
}
.ports {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px;
  gap: 8px;
}
.narrow {
  max-width: 640px;
}
.optional {
  margin: 8px 0 0;
  padding-top: 12px;
  border-top: var(--rule-2);
}
.member-screen {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 56px);
}
.spacer {
  flex: 1;
}
@media (max-width: 1199px) {
  .desktop {
    grid-template-columns: minmax(0, 1fr) 440px;
  }
  .table-head,
  .member {
    grid-template-columns: minmax(160px, 1fr) minmax(0, 1fr) auto;
  }
  .table-head span:nth-child(3),
  .details {
    display: none;
  }
  .add fieldset {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 899px) {
  .phone {
    padding-bottom: calc(var(--tabbar) + 16px);
  }
  .phone-tabs {
    border-bottom: var(--rule-2);
  }
  .phone-tabs :global(.seg) {
    border-top: 0;
    border-left: 0;
  }
  .phone-members > li {
    border-bottom: var(--rule-2);
  }
  .phone-member {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 12px 16px;
    color: inherit;
    text-decoration: none;
  }
  .reach {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-top: var(--rule);
  }
  .reach li {
    border-right: var(--rule);
  }
  .reach li:last-child {
    border-right: 0;
  }
  .reach a,
  .reach span {
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 0 16px;
    font-size: 13px;
    font-weight: 800;
    color: var(--color-accent-700);
    text-decoration: none;
  }
  .reach span {
    color: var(--color-neutral-500);
    font-weight: 400;
  }
  .block,
  .bands li {
    padding-inline: 16px;
  }
  .new-band {
    margin-inline: 16px;
  }
}
</style>
