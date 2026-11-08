<script lang="ts">
import {
  type BandPublicProfile,
  currencyForLocale,
  defaultNewPageTheme,
  isPublic,
  legacyLivePageTheme,
  type Member,
  normalizeSocialUrl,
  PAGE_THEME_PRESETS,
  type PublicPageContact,
  type SocialPlatform,
  slugify,
  slugPattern,
  socialPlatforms,
  type ThemePreset,
} from "@showday/schemas";
import BottomActionBar from "../components/BottomActionBar.svelte";
import ChannelGrid from "../components/ChannelGrid.svelte";
import CurrencyOptions from "../components/CurrencyOptions.svelte";
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
  type PublicPageAction,
  publicPageControls,
  publicPageCouldNotPublish,
  publicPageCouldNotUnpublish,
  publishUntilLive,
  trackPublicPageLive,
} from "../lib/public-page";
import { router } from "../lib/router.svelte";
import { run, ui } from "../lib/ui.svelte";
import { bands, storage } from "../storage";

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
// Desktop shows the public pane next to the members, so this cannot depend on
// the phone tab.
let liveSlug = $state<string | null>(null);
const liveTracker = trackPublicPageLive((slug) => {
  liveSlug = slug;
});
const bandSlug = $derived(band?.slug);
const pageLive = $derived(!!bandSlug && liveSlug === bandSlug);
$effect(() => {
  if (bandSlug) return liveTracker.watch(bandSlug);
});
let bandPageLive = $state<Record<string, boolean>>({});
$effect(() => {
  const items = data.all;
  let cancelled = false;
  void (async () => {
    const next: Record<string, boolean> = {};
    await Promise.all(
      items.map(async (item) => {
        const slug = item.band.slug;
        next[item.band.id] = slug ? await isPublicPageLive(slug) : false;
      }),
    );
    if (!cancelled) bandPageLive = next;
  })();
  return () => {
    cancelled = true;
  };
});
const listed = $derived(current?.gigs.filter(isPublic).length ?? 0);
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
let publicPageError = $state("");
let publicPageAction = $state<PublicPageAction>("idle");
const pageControls = $derived(
  publicPageControls({
    live: pageLive,
    unsaved: publicDraft,
    action: publicPageAction,
    listed,
  }),
);
const publicPageBusy = $derived(pageControls.busy);
const slugChanging = $derived(
  pageLive && !!band?.slug && slugValue.trim() !== band.slug,
);
function cancelPublicDraft() {
  slugDirty = false;
  profileDraft = null;
  publicPageError = "";
  if (band) slugValue = band.slug ?? slugify(band.name ?? "");
}
async function savePublicPage(event: SubmitEvent) {
  event.preventDefault();
  if (!band || publicPageAction !== "idle") return;
  const previous = $state.snapshot(band);
  const slug = slugValue.trim();
  slugValue = slug;
  publicPageAction = pageControls.primaryAction;
  publicPageError = "";
  ui.error = "";
  ui.busy = true;
  try {
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
    if (previous.slug && previous.slug !== slug) {
      await bands.queueOldSlugCleanup(previous.id, previous.slug);
    }
    await publishUntilLive(slug, async () => {
      await api(
        "/api/public/pages",
        { method: "POST", body: { bandId: previous.id, slug } },
        publicPageCouldNotPublish,
      );
      await bands.save("band", previous.id, nextBand);
      await bands.publishBand(previous.id, previous.slug, nextBand);
      if (storage.remote.connected && storage.sync) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error(publicPageCouldNotPublish)),
            30_000,
          );
          const onDone = (event: unknown) => {
            clearTimeout(timeout);
            storage.removeEventListener("sync-done", onDone);
            if ((event as { completed?: boolean }).completed) resolve();
            else reject(new Error(publicPageCouldNotPublish));
          };
          storage.on("sync-done", onDone);
          void storage.startSync();
        });
      }
    });
    liveTracker.confirmed(slug);
    slugDirty = false;
    profileDraft = null;
    await data.load();
  } catch (cause) {
    ui.error = "";
    const status = (cause as { status?: number } | null)?.status;
    publicPageError =
      (status === 400 || status === 409) &&
      cause instanceof Error &&
      cause.message
        ? cause.message
        : publicPageCouldNotPublish;
  } finally {
    publicPageAction = "idle";
    ui.busy = false;
  }
}
async function unpublishPage() {
  if (!pageLive || !band?.slug || !confirm("Take this public page down?"))
    return;
  if (publicPageAction !== "idle") return;
  const previous = $state.snapshot(band);
  publicPageAction = "unpublishing";
  publicPageError = "";
  ui.error = "";
  ui.busy = true;
  try {
    await bands.unpublishBand(previous.id);
    await api(
      "/api/public/pages",
      { method: "DELETE", body: { bandId: previous.id } },
      publicPageCouldNotUnpublish,
    );
    liveTracker.takenDown();
    slugDirty = false;
    profileDraft = null;
    slugValue = slugify(previous.name ?? "");
    await data.load();
  } catch (cause) {
    ui.error = "";
    publicPageError =
      cause instanceof Error && cause.message
        ? cause.message
        : publicPageCouldNotUnpublish;
  } finally {
    publicPageAction = "idle";
    ui.busy = false;
  }
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
    <label for="member-name">Name <span class="required">Required</span></label>
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
            {(viewing ? pageLive : bandPageLive[item.band.id])
              ? "public page live"
              : "not published"}
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
            list="new-band-currency-options"
            autocomplete="off"
            required
            pattern={"[A-Za-z]{3}"}
            maxlength="3"
          >
          <CurrencyOptions
            id="new-band-currency-options"
            first={[
              currencyForLocale(navigator.language),
              ...data.all.map((item) => item.band.currency),
            ]}
          />
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
        <strong class="big">{pageControls.status}</strong>
        {#if pageControls.listedTag}
          <Tag kind="accent">{plural(listed, "gig")} listed</Tag>
        {/if}
      </div>
      <form class="form" id="band-public-page" onsubmit={savePublicPage}>
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
          {#if slugChanging}
            <p class="hint">Your old address will stop working.</p>
          {/if}
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
                style={`background:${colors.background};color:${colors.text}`}
                onclick={() =>
                  applyThemePreset(preset as Exclude<ThemePreset, "custom">)}
              >
                <span class="dot" style={`background:${colors.accent}`}></span>
                <span class="capitalize">{preset}</span>
              </button>
            {/each}
          </div>
          <div class="field-row three">
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
      </form>
    </section>
    <section class="block pub-page-actions">
      <div class="pub-actions">
        <button
          type="submit"
          form="band-public-page"
          class="btn btn-primary"
          disabled={!data.loaded || publicPageBusy}
        >
          {pageControls.primary}
        </button>
        {#if pageControls.cancel}
          <button
            type="button"
            class="btn btn-ghost"
            disabled={publicPageBusy}
            onclick={cancelPublicDraft}
          >
            Cancel
          </button>
        {/if}
      </div>
      {#if publicPageError}
        <p class="pub-error" role="alert">{publicPageError}</p>
      {/if}
      {#if pageControls.openAndExport && band.slug}
        <div class="pub-links">
          <div class="pub-links-start">
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
          </div>
          {#if pageControls.unpublish}
            <button
              type="button"
              class="btn btn-secondary pub-unpublish"
              disabled={!data.loaded || publicPageBusy}
              onclick={unpublishPage}
            >
              Unpublish
            </button>
          {/if}
        </div>
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
      <p class="visibility-note phone-note">
        <Icon name="lock" size={13} />Private. Member details are never
        published.
      </p>
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
                <span class="sub ellipsis">
                  {[member.phone, member.email, member.messenger]
                    .filter(Boolean)
                    .join(" · ") || "No contact details yet"}
                </span>
              </span>
            </a>
            {#if memberChannels(member).some((c) => c.value && c.href)}
              <ul class="reach">
                {#each memberChannels(member).filter(
                  (c) => c.value && c.href,
                ) as channel (channel.label)}
                  <li>
                    <a href={channel.href}>{channel.verb}</a>
                  </li>
                {/each}
              </ul>
            {/if}
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
      <div class="page-head keep-title">
        <div>
          <p class="kicker">You lead this band</p>
          <h1>{current.band.name}</h1>
        </div>
      </div>
      <SectionLabel>
        Members · {current.members.length}
        {#snippet aside()}
          <span class="visibility-note"
            ><Icon name="lock" size={13} />Private. Member details are never
            published.</span
          >
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
                  <span class="muted">No contact details yet</span>
                {/each}
              </span>
              <span class="row-actions">
                <button
                  type="button"
                  class="btn btn-ghost btn-icon"
                  disabled={ui.busy}
                  title="Edit"
                  onclick={() => edit(member)}
                >
                  <Icon name="pencil" />
                  <span class="sr-only">Edit {member.name}</span>
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-icon remove"
                  disabled={ui.busy}
                  title="Remove"
                  onclick={() => removeMember(member)}
                >
                  <Icon name="trash" />
                  <span class="sr-only">Remove {member.name}</span>
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
  grid-template-columns: minmax(0, 1fr) 500px;
  height: 100%;
}
.main,
.side {
  overflow: auto;
  min-height: 0;
}
.side {
  border-left: var(--rule);
  background: var(--color-bg);
}
.table-head,
.member {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) 96px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 10px 24px;
}
.table-head {
  padding-block: 8px;
  border-bottom: var(--rule);
}
.member {
  min-height: 64px;
  border-bottom: var(--rule);
}
.name {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.name strong {
  font-size: 14px;
  font-weight: 600;
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-accent-100);
  color: var(--color-accent-700);
  font-weight: 600;
  font-size: 13px;
}
.details {
  display: flex;
  flex-direction: column;
  font-size: 13px;
  color: var(--muted);
  min-width: 0;
}
.row-actions {
  display: flex;
  gap: 4px;
}
.add,
.edit-row .add {
  margin: 12px 24px;
  padding: 16px;
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
}
.add fieldset {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
  align-items: end;
}
.add-actions {
  grid-column: 1 / -1;
}
.add-actions {
  display: flex;
  gap: 4px;
}
.offer {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--color-accent-200);
  border-radius: var(--radius-md);
  background: var(--color-accent-100);
}
.offer p {
  margin: 4px 0;
  font-size: 13px;
}
.offer .btn {
  padding-inline: 0;
}
.block {
  padding: 20px 28px;
  border-bottom: var(--rule);
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
  font-size: 20px;
  font-weight: 700;
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
  border: 1px solid var(--color-border);
  border-right: 0;
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  background: var(--color-surface-2);
  white-space: nowrap;
}
.prefix :global(.input) {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
.hint {
  font-size: 13px;
  margin: 0;
  color: var(--muted);
}
.banner-preview {
  display: block;
  width: 100%;
  max-height: 10rem;
  object-fit: cover;
  margin-bottom: 8px;
  border-radius: var(--radius-md);
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
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1 1 4.5rem;
  min-height: 2.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 600;
  text-transform: capitalize;
  cursor: pointer;
}
.swatch .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.swatch.selected {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.remove:hover,
.remove:focus-visible {
  color: var(--color-danger);
  background: var(--color-danger-bg);
}
.phone-note {
  margin: 0;
  padding: 4px var(--pad) 8px;
}
.colors input[type="color"] {
  height: 40px;
  padding: 4px;
  cursor: pointer;
}
.colors input[type="color"]::-webkit-color-swatch-wrapper {
  padding: 0;
}
.colors input[type="color"]::-webkit-color-swatch {
  border: 0;
  border-radius: 5px;
}
.colors input[type="color"]::-moz-color-swatch {
  border: 0;
  border-radius: 5px;
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
.pub-page-actions {
  padding-top: 18px;
  padding-bottom: 20px;
}
.pub-actions,
.pub-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: stretch;
}
.pub-actions :global(.btn),
.pub-links :global(.btn) {
  min-height: 2.75rem;
}
.pub-links {
  margin-top: 12px;
  flex-wrap: nowrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.pub-links-start {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.pub-links .pub-unpublish {
  flex-shrink: 0;
}
.pub-error {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--color-danger);
}
.bands {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 12px;
}
.bands li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: var(--radius-lg);
}
.bands .viewing {
  background: var(--select-bg);
}
.what {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.what strong {
  font-size: 14px;
  font-weight: 600;
}
.sub {
  font-size: 12px;
  color: var(--muted);
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
  border-top: var(--rule);
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
    padding: 12px var(--pad) 8px;
  }
  .phone-members {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px var(--pad) 0;
  }
  .phone-members > li {
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    overflow: hidden;
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
    display: flex;
    gap: 8px;
    padding: 0 16px 12px 64px;
  }
  .reach a {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    padding: 0 14px;
    border-radius: var(--radius-pill);
    background: var(--color-accent-100);
    font-size: 13px;
    font-weight: 600;
    color: var(--color-accent-700);
    text-decoration: none;
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
