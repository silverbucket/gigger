<script lang="ts">
import {
  type BandPublicProfile,
  currencyForLocale,
  defaultNewPageTheme,
  legacyLivePageTheme,
  type Member,
  normalizeSocialUrl,
  PAGE_THEME_PRESETS,
  type PublicPageContact,
  publicStatuses,
  type SocialPlatform,
  slugify,
  slugPattern,
  socialPlatforms,
  type ThemePreset,
} from "@showday/schemas";
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
import {
  isPublicPageLive,
  publicPageCouldNotPublish,
  publishUntilLive,
} from "../lib/public-page";
import { router } from "../lib/router.svelte";
import { run, ui } from "../lib/ui.svelte";
import { bands } from "../storage";

const current = $derived(data.current);
const band = $derived(current?.band);
const tab = $derived(
  (["members", "public"] as const).find((t) => t === router.parts[0]) ??
    "members",
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

// Public page drafts survive syncs until saved or another band is shown.
let slugValue = $state("");
let slugDirty = $state(false);
$effect(() => {
  if (band && !slugDirty) {
    slugValue = band.slug ?? slugify(band.name ?? "");
  }
});
const pageUrl = $derived(band?.slug ? `${location.origin}/b/${band.slug}` : "");
let pageLive = $state(false);
$effect(() => {
  const slug = band?.slug;
  const onPublic = tab === "public";
  if (!slug || !onPublic) {
    pageLive = false;
    return;
  }
  let cancelled = false;
  void isPublicPageLive(slug).then((live) => {
    if (!cancelled && band?.slug === slug) pageLive = live;
  });
  return () => {
    cancelled = true;
  };
});
const listed = $derived(
  current?.gigs.filter((g) => publicStatuses.includes(g.status)).length ?? 0,
);
const editorThemeDefault = $derived(
  band?.slug && !band.publicProfile?.theme
    ? legacyLivePageTheme
    : defaultNewPageTheme,
);
let profileDraft = $state<{
  bandId: string;
  profile: BandPublicProfile;
} | null>(null);
const publicProfile = $derived.by((): BandPublicProfile => {
  const id = band?.id;
  if (!id) return {};
  if (profileDraft?.bandId === id) return profileDraft.profile;
  return band?.publicProfile ?? {};
});
const profileContact = $derived(publicProfile.contact ?? {});
const profileTheme = $derived({
  ...editorThemeDefault,
  ...publicProfile.theme,
});
const bannerPreview = $derived(
  publicProfile.bannerDataUrl
    ? publicProfile.bannerDataUrl === ""
      ? ""
      : publicProfile.bannerDataUrl
    : band?.slug
      ? `/b/${band.slug}/banner?t=${listed}`
      : "",
);
function touchProfile(patch: Partial<BandPublicProfile>) {
  if (!band) return;
  profileDraft = {
    bandId: band.id,
    profile: { ...publicProfile, ...patch },
  };
}
function touchContact(
  field: keyof NonNullable<BandPublicProfile["contact"]>,
  value: string,
) {
  touchProfile({
    contact: { ...profileContact, [field]: value },
  });
}
function applyThemePreset(preset: Exclude<ThemePreset, "custom">) {
  touchProfile({ theme: { ...PAGE_THEME_PRESETS[preset] } });
}
function touchTheme(field: "background" | "text" | "accent", value: string) {
  touchProfile({
    theme: {
      ...profileTheme,
      [field]: value,
      preset: "custom",
    },
  });
}
const usedSocialPlatforms = $derived(
  new Set((publicProfile.socials ?? []).map((row) => row.platform)),
);
const availableSocialPlatforms = $derived(
  socialPlatforms.filter((platform) => !usedSocialPlatforms.has(platform)),
);
function addSocialLink(platform: SocialPlatform) {
  if (usedSocialPlatforms.has(platform)) return;
  touchProfile({
    socials: [...(publicProfile.socials ?? []), { platform, url: "" }],
  });
}
function updateSocialUrl(platform: SocialPlatform, url: string) {
  touchProfile({
    socials: (publicProfile.socials ?? []).map((row) =>
      row.platform === platform ? { ...row, url } : row,
    ),
  });
}
function removeSocial(platform: SocialPlatform) {
  touchProfile({
    socials: (publicProfile.socials ?? []).filter(
      (row) => row.platform !== platform,
    ),
  });
}
async function onBannerFile(event: Event) {
  const file = (event.currentTarget as HTMLInputElement).files?.[0];
  (event.currentTarget as HTMLInputElement).value = "";
  if (!file) return;
  if (file.size > 5_000_000) {
    ui.error = "Use a JPEG, PNG or WebP image under 5 MB.";
    return;
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  touchProfile({ bannerDataUrl: dataUrl });
}
function buildPublicProfile() {
  const profile = { ...publicProfile };
  const contact: PublicPageContact = {
    ...(profileContact.email?.trim()
      ? { email: profileContact.email.trim() }
      : {}),
    ...(profileContact.phone?.trim()
      ? { phone: profileContact.phone.trim() }
      : {}),
    ...(profileContact.website?.trim()
      ? { website: profileContact.website.trim() }
      : {}),
  };
  const hasContact = Object.keys(contact).length > 0;
  const theme = profileTheme;
  const base = editorThemeDefault;
  const hasCustomTheme =
    theme.background !== base.background ||
    theme.text !== base.text ||
    theme.accent !== base.accent ||
    theme.preset !== base.preset;
  const socials = (profile.socials ?? [])
    .map((row) => {
      const url = normalizeSocialUrl(row.platform, row.url);
      return url ? { platform: row.platform, url } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const next: BandPublicProfile = {
    ...(profile.bio?.trim() ? { bio: profile.bio.trim() } : {}),
    ...(profile.city?.trim() ? { city: profile.city.trim() } : {}),
    ...(profile.bannerDataUrl !== undefined
      ? { bannerDataUrl: profile.bannerDataUrl }
      : {}),
    ...(hasCustomTheme ? { theme } : {}),
    ...(hasContact ? { contact } : {}),
    ...(socials.length ? { socials } : {}),
  };
  return Object.keys(next).length ? next : undefined;
}
const publicDraft = $derived(slugDirty || profileDraft !== null);
function cancelPublicDraft() {
  slugDirty = false;
  profileDraft = null;
  if (band) slugValue = band.slug ?? slugify(band.name ?? "");
}
function savePublicPage(event: SubmitEvent) {
  event.preventDefault();
  if (!band) return;
  const previous = $state.snapshot(band);
  const slug = slugValue.trim();
  slugValue = slug;
  void run(async () => {
    const { publicProfile: _, ...bandCore } = previous;
    const locale = /^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(navigator.language)
      ? navigator.language
      : undefined;
    const savedProfile = buildPublicProfile();
    const nextBand = {
      ...bandCore,
      slug,
      ...(locale ? { locale } : {}),
      ...(savedProfile ? { publicProfile: savedProfile } : {}),
    };
    await publishUntilLive(slug, async () => {
      await api(
        "/api/public/pages",
        { method: "POST", body: { bandId: previous.id, slug } },
        publicPageCouldNotPublish,
      );
      await bands.save("band", previous.id, nextBand);
      await bands.publishBand(previous.id, previous.slug, nextBand);
    });
    if (previous.slug && previous.slug !== slug) {
      await bands.queueOldSlugCleanup(previous.id, previous.slug);
    }
    pageLive = true;
    slugDirty = false;
    profileDraft = null;
  }, publicPageCouldNotPublish);
}
function unpublishPage() {
  if (!band?.slug || !confirm("Take this public page down?")) return;
  const previous = $state.snapshot(band);
  void run(async () => {
    await bands.unpublishBand(previous.id);
    await api(
      "/api/public/pages",
      { method: "DELETE", body: { bandId: previous.id } },
      "Could not unpublish the page. Please retry.",
    );
    pageLive = false;
    slugDirty = false;
    profileDraft = null;
    slugValue = slugify(previous.name ?? "");
  }, "Could not unpublish the page. Please retry.");
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
        <strong class="big">{pageLive ? "Published" : "Not published"}</strong>
        {#if pageLive}
          <Tag kind="accent">{plural(listed, "gig")} listed</Tag>
        {/if}
      </div>
      <form class="form" onsubmit={savePublicPage}>
        <div class="field">
          <label for="page-address">Page address</label>
          <div class="prefix">
            <span aria-hidden="true">{location.host}/b/</span>
            <input
              id="page-address"
              class="input"
              name="slug"
              bind:value={slugValue}
              oninput={() => (slugDirty = true)}
              pattern={slugPattern.slice(1, -1)}
              maxlength="60"
              required
            >
          </div>
        </div>
        <p class="hint">
          Fans see confirmed and played gigs: date, start time, venue, city,
          ticket link and description. They also see the bio, city, contact
          details and social links you add below. Fees, member contacts, notes
          and earnings stay private.
        </p>
        <div class="field">
          <label for="page-bio">Bio</label>
          <textarea
            id="page-bio"
            class="input"
            rows="4"
            maxlength="5000"
            value={publicProfile.bio ?? ""}
            oninput={(event) =>
              touchProfile({ bio: event.currentTarget.value })}
          ></textarea>
        </div>
        <div class="field">
          <label for="page-banner">Banner image</label>
          {#if bannerPreview}
            <img class="banner-preview" src={bannerPreview} alt="">
            <button
              type="button"
              class="btn btn-ghost"
              onclick={() => touchProfile({ bannerDataUrl: "" })}
            >
              Remove banner
            </button>
          {/if}
          <input
            id="page-banner"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onchange={onBannerFile}
          >
        </div>
        <div class="field">
          <label for="page-city">City</label>
          <input
            id="page-city"
            class="input"
            value={publicProfile.city ?? ""}
            maxlength="200"
            oninput={(event) =>
              touchProfile({ city: event.currentTarget.value })}
          >
        </div>
        <fieldset class="field colors">
          <legend class="label">Theme</legend>
          <p class="hint">Theme presets</p>
          <div class="theme-swatches">
            {#each Object.entries(
              PAGE_THEME_PRESETS,
            ) as [preset, colors] (preset)}
              <button
                type="button"
                class="swatch"
                class:selected={profileTheme.preset === preset ||
                  (profileTheme.background === colors.background &&
                    profileTheme.text === colors.text &&
                    profileTheme.accent === colors.accent)}
                style={`background:${colors.background};color:${colors.text};border-color:${colors.accent}`}
                onclick={() =>
                  applyThemePreset(preset as Exclude<ThemePreset, "custom">)}
              >
                <span class="capitalize">{preset}</span>
              </button>
            {/each}
          </div>
          <p class="hint">Custom colors</p>
          <div class="field-row ports">
            <div class="field">
              <label for="page-bg">Background</label>
              <input
                id="page-bg"
                class="input"
                type="color"
                value={profileTheme.background}
                oninput={(event) =>
                  touchTheme("background", event.currentTarget.value)}
              >
            </div>
            <div class="field">
              <label for="page-text">Text</label>
              <input
                id="page-text"
                class="input"
                type="color"
                value={profileTheme.text}
                oninput={(event) =>
                  touchTheme("text", event.currentTarget.value)}
              >
            </div>
            <div class="field">
              <label for="page-accent">Buttons</label>
              <input
                id="page-accent"
                class="input"
                type="color"
                value={profileTheme.accent}
                oninput={(event) =>
                  touchTheme("accent", event.currentTarget.value)}
              >
            </div>
          </div>
        </fieldset>
        <div class="field-row">
          <div class="field">
            <label for="page-contact-email">Booking email</label>
            <input
              id="page-contact-email"
              class="input"
              type="email"
              value={profileContact.email ?? ""}
              oninput={(event) =>
                touchContact("email", event.currentTarget.value)}
            >
          </div>
          <div class="field">
            <label for="page-contact-phone">Contact phone</label>
            <input
              id="page-contact-phone"
              class="input"
              type="tel"
              value={profileContact.phone ?? ""}
              oninput={(event) =>
                touchContact("phone", event.currentTarget.value)}
            >
          </div>
        </div>
        <div class="field">
          <label for="page-contact-web">Website</label>
          <input
            id="page-contact-web"
            class="input"
            type="text"
            value={profileContact.website ?? ""}
            placeholder="https://"
            oninput={(event) =>
              touchContact("website", event.currentTarget.value)}
          >
        </div>
        <section class="field socials-block">
          <h4 class="label">Social links</h4>
          <p class="hint">
            These show as icons on your page, in the colors you pick.
          </p>
          <ul class="social-editor">
            {#each publicProfile.socials ?? [] as row (row.platform)}
              <li>
                <span class="platform">{row.platform}</span>
                <input
                  class="input"
                  aria-label="{row.platform} link"
                  value={row.url}
                  oninput={(event) =>
                    updateSocialUrl(row.platform, event.currentTarget.value)}
                >
                <button
                  type="button"
                  class="btn btn-ghost"
                  onclick={() => removeSocial(row.platform)}
                >
                  Remove
                </button>
              </li>
            {/each}
          </ul>
          {#if availableSocialPlatforms.length}
            <div class="social-add">
              {#each availableSocialPlatforms as platform (platform)}
                <button
                  type="button"
                  class="btn btn-ghost"
                  onclick={() => addSocialLink(platform)}
                >
                  Add {platform}
                </button>
              {/each}
            </div>
          {/if}
        </section>
        <section class="pub-actions" aria-label="Public page actions">
          <button
            type="submit"
            class="btn btn-primary"
            disabled={!data.loaded || ui.busy}
          >
            {pageLive ? "Save" : "Publish"}
          </button>
          {#if band.slug}
            <button
              type="button"
              class="btn btn-ghost"
              disabled={!data.loaded || ui.busy}
              onclick={unpublishPage}
            >
              Unpublish
            </button>
          {/if}
          {#if publicDraft}
            <button
              type="button"
              class="btn btn-ghost"
              disabled={ui.busy}
              onclick={cancelPublicDraft}
            >
              Cancel
            </button>
          {/if}
        </section>
      </form>
      {#if pageLive && band.slug}
        <section class="pub-links" aria-label="Public page links">
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
        </section>
      {/if}
    </section>
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
          ? "Choose a band to see its members and public page."
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
        columns={2}
        options={[
          { value: "members", label: "Members" },
          { value: "public", label: "Public page" },
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
    {:else}
      {@render publicPage()}
    {/if}
    {@render yourBands()}
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
.banner-preview {
  display: block;
  width: 100%;
  max-height: 10rem;
  object-fit: cover;
  margin-bottom: 8px;
  border: var(--rule);
}
.colors {
  border: 0;
  margin: 0;
  padding: 0;
}
.colors legend {
  margin-bottom: 8px;
}
.theme-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.swatch {
  flex: 1 1 4.5rem;
  min-height: 2.75rem;
  border: 2px solid transparent;
  font-size: 12px;
  font-weight: 700;
  text-transform: capitalize;
  cursor: pointer;
}
.swatch.selected {
  outline: 2px solid var(--color-accent-700);
  outline-offset: 2px;
}
.socials-block .hint {
  margin-bottom: 8px;
}
.social-editor {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.social-editor li {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}
.social-editor .platform {
  font-size: 13px;
  font-weight: 600;
  text-transform: capitalize;
}
.social-add {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}
textarea.input {
  min-height: 6rem;
  resize: vertical;
}
.pub-actions,
.pub-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 12px;
  border-top: var(--rule);
  margin-top: 12px;
}
.pub-links {
  margin-top: 8px;
  padding-top: 8px;
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
