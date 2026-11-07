<script lang="ts">
import type { Band } from "@showday/schemas";
import Tag from "../components/Tag.svelte";
import { api, meta } from "../lib/account.svelte";
import { ui } from "../lib/ui.svelte";

/** Where enquiries arrive from: the band's Facebook Page (Messenger, Instagram) and mailbox. */
let { band }: { band: Band } = $props();

type MailAccount = {
  address: string;
  name?: string;
  inboxAddress?: string;
  imapHost?: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  login: string;
  watching: boolean;
  error?: string;
};
let metaPage = $state<{ pageId: string; instagram: boolean } | null>(null);
let metaPages = $state<{ id: string; name: string; token: string }[]>([]);
let mailAccount = $state<MailAccount | null>(null);
let mailEditing = $state(false);
let mailForm = $state({
  address: "",
  name: "",
  inboxAddress: "",
  imapHost: "",
  imapPort: "993",
  smtpHost: "",
  smtpPort: "587",
  login: "",
  password: "",
});
let error = $state("");
let loadedFor = "";

$effect(() => {
  const bandId = band.id;
  if (bandId === loadedFor) return;
  loadedFor = bandId;
  metaPage = null;
  metaPages = [];
  mailAccount = null;
  mailEditing = false;
  error = "";
  void api<typeof metaPage>("/api/meta/page", { query: { bandId } })
    .then((page) => {
      if (loadedFor === bandId) metaPage = page;
    })
    .catch(() => {});
  void api<MailAccount | null>("/api/email/account", { query: { bandId } })
    .then((account) => {
      if (loadedFor === bandId) mailAccount = account;
    })
    .catch(() => {});
});

async function act(action: () => Promise<void>, fallback: string) {
  ui.busy = true;
  error = "";
  try {
    await action();
  } catch (cause) {
    error = cause instanceof Error && cause.message ? cause.message : fallback;
  } finally {
    ui.busy = false;
  }
}

type FacebookSdk = {
  init(options: object): void;
  login(
    callback: (response: { authResponse?: { accessToken?: string } }) => void,
    options: object,
  ): void;
};
const fb = () => (window as Window & { FB?: FacebookSdk }).FB;
function facebookSdk() {
  return new Promise<FacebookSdk>((resolve, reject) => {
    const loaded = fb();
    if (loaded) return resolve(loaded);
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.onload = () => {
      const sdk = fb();
      sdk?.init({
        appId: meta.config?.appId,
        version: meta.config?.graphVersion,
      });
      sdk ? resolve(sdk) : reject(new Error("Facebook SDK failed"));
    };
    script.onerror = () =>
      reject(new Error("Could not load the Facebook SDK."));
    document.head.append(script);
  });
}
function connectPage(pageId?: string, accessToken?: string) {
  const bandId = band.id;
  return act(async () => {
    if (!accessToken) {
      const FB = await facebookSdk();
      accessToken = await new Promise<string>((resolve, reject) =>
        FB.login(
          (response) =>
            response.authResponse?.accessToken
              ? resolve(response.authResponse.accessToken)
              : reject(new Error("Facebook login was cancelled.")),
          { config_id: meta.config?.configId },
        ),
      );
    }
    try {
      const page = await api<typeof metaPage>(
        "/api/meta/connect",
        { method: "POST", body: { bandId, accessToken, pageId } },
        "Could not connect the page.",
      );
      if (band.id !== bandId) return; // moved to another band meanwhile
      metaPages = [];
      metaPage = page;
    } catch (cause) {
      const failure = cause as Error & {
        status?: number;
        result?: { pages?: { id: string; name: string }[] };
      };
      // Several pages: remember the token and let the user pick one.
      if (
        failure.status === 409 &&
        failure.result?.pages?.length &&
        band.id === bandId
      ) {
        const token = accessToken;
        metaPages = failure.result.pages.map((p) => ({ ...p, token }));
        return;
      }
      throw cause;
    }
  }, "Could not connect the page.");
}
function disconnectPage() {
  if (
    !confirm("Disconnect this Facebook Page? New messages will stop arriving.")
  )
    return;
  const bandId = band.id;
  return act(async () => {
    await api(
      "/api/meta/disconnect",
      { method: "POST", body: { bandId } },
      "Could not disconnect. Please retry.",
    );
    if (band.id === bandId) metaPage = null;
  }, "Could not disconnect.");
}
function editMail() {
  const a = mailAccount;
  mailForm = {
    address: a?.address ?? "",
    name: a?.name ?? "",
    inboxAddress: a?.inboxAddress ?? "",
    imapHost: a?.imapHost ?? "",
    imapPort: String(a?.imapPort ?? 993),
    smtpHost: a?.smtpHost ?? "",
    smtpPort: String(a?.smtpPort ?? 587),
    login: a?.login ?? "",
    password: "",
  };
  mailEditing = true;
}
function saveMail(event: SubmitEvent) {
  event.preventDefault();
  const bandId = band.id;
  return act(async () => {
    const saved = await api<MailAccount>(
      "/api/email/account",
      { method: "PUT", body: { bandId, ...mailForm } },
      "Could not save the email settings.",
    );
    if (band.id === bandId) {
      mailAccount = saved;
      mailEditing = false;
    }
  }, "Could not save the settings.");
}
function removeMail() {
  if (
    !confirm(
      "Remove this email account? New enquiries by email will stop arriving.",
    )
  )
    return;
  const bandId = band.id;
  return act(async () => {
    await api(
      "/api/email/account",
      { method: "DELETE", body: { bandId } },
      "Could not remove the account.",
    );
    if (band.id === bandId) {
      mailAccount = null;
      mailEditing = false;
    }
  }, "Could not remove the account.");
}
</script>

<section class="block" aria-labelledby="meta-title">
  <div class="block-head">
    <h3 class="label" id="meta-title">Messenger and Instagram</h3>
    {#if metaPage}
      <Tag kind="accent">Connected</Tag>
    {/if}
  </div>
  {#if metaPage}
    <p>
      Connected to Facebook Page {metaPage.pageId}{metaPage.instagram
        ? " and its Instagram account"
        : ""}. Messages arrive in Bookings under To sort.
    </p>
    <div class="actions">
      <button
        type="button"
        class="btn btn-secondary"
        disabled={ui.busy}
        onclick={disconnectPage}
      >
        Disconnect page
      </button>
    </div>
  {:else if metaPages.length}
    <p>Which page should this band use?</p>
    <div class="actions">
      {#each metaPages as page (page.id)}
        <button
          type="button"
          class="btn btn-secondary"
          disabled={ui.busy}
          onclick={() => connectPage(page.id, page.token)}
        >
          {page.name}
        </button>
      {/each}
    </div>
  {:else if meta.config?.appId}
    <p>
      Connect the band's Facebook Page to answer Messenger and Instagram
      enquiries from Bookings.
    </p>
    <div class="actions">
      <button
        type="button"
        class="btn btn-secondary"
        disabled={ui.busy}
        onclick={() => connectPage()}
      >
        Connect Facebook Page
      </button>
    </div>
  {:else}
    <p class="muted">Facebook is not configured on this server.</p>
  {/if}
</section>

<section class="block" aria-labelledby="mail-title">
  <div class="block-head">
    <h3 class="label" id="mail-title">Email</h3>
    {#if mailAccount && !mailEditing}
      <Tag kind={mailAccount.error ? "proposed" : "accent"}
        >{mailAccount.watching ? "Watching" : "Send only"}</Tag
      >
    {/if}
  </div>
  {#if mailEditing}
    <p>
      Enquiries sent to this address appear in Bookings and replies go out from
      it. Use an app password if your provider offers one.
    </p>
    <form class="form" onsubmit={saveMail}>
      <fieldset class="form" disabled={ui.busy}>
        <div class="field-row">
          <div class="field">
            <label for="mail-address">Email address</label>
            <input
              id="mail-address"
              class="input"
              type="email"
              bind:value={mailForm.address}
              required
            >
          </div>
          <div class="field">
            <label for="mail-name">Display name</label>
            <input id="mail-name" class="input" bind:value={mailForm.name}>
          </div>
        </div>
        <div class="field">
          <label for="mail-inbox">Pull mail addressed to</label>
          <input
            id="mail-inbox"
            class="input"
            type="email"
            bind:value={mailForm.inboxAddress}
            placeholder="Leave empty to pull everything in the mailbox"
          >
          <p class="hint">
            For a shared inbox with aliases, enter the band’s address so only
            mail to that alias is pulled in.
          </p>
        </div>
        <div class="field-row ports">
          <div class="field">
            <label for="mail-imap">Incoming (IMAP) server</label>
            <input
              id="mail-imap"
              class="input"
              bind:value={mailForm.imapHost}
              placeholder="Leave empty to only send"
            >
          </div>
          <div class="field">
            <label for="mail-imap-port">IMAP port</label>
            <input
              id="mail-imap-port"
              class="input"
              type="number"
              min="1"
              max="65535"
              bind:value={mailForm.imapPort}
            >
          </div>
        </div>
        <div class="field-row ports">
          <div class="field">
            <label for="mail-smtp">Outgoing (SMTP) server</label>
            <input
              id="mail-smtp"
              class="input"
              bind:value={mailForm.smtpHost}
              required
            >
          </div>
          <div class="field">
            <label for="mail-smtp-port">SMTP port</label>
            <input
              id="mail-smtp-port"
              class="input"
              type="number"
              min="1"
              max="65535"
              bind:value={mailForm.smtpPort}
            >
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="mail-login">Login</label>
            <input
              id="mail-login"
              class="input"
              bind:value={mailForm.login}
              required
            >
          </div>
          <div class="field">
            <label for="mail-password">Password</label>
            <input
              id="mail-password"
              class="input"
              type="password"
              bind:value={mailForm.password}
              placeholder={mailAccount ? "Unchanged" : ""}
              required={!mailAccount}
            >
          </div>
        </div>
      </fieldset>
      <div class="actions">
        <button type="submit" class="btn btn-secondary" disabled={ui.busy}>
          Save email settings
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          onclick={() => (mailEditing = false)}
        >
          Cancel
        </button>
      </div>
    </form>
  {:else if mailAccount}
    <p>
      {mailAccount.watching ? "Watching" : "Sending as"}
      <strong>{mailAccount.address}</strong>
      {mailAccount.watching
        ? ". New enquiries arrive in Bookings."
        : ". Replies go out by email; no mailbox is watched."}
    </p>
    {#if mailAccount.error}
      <p class="alert-text" role="alert">
        Mailbox problem: {mailAccount.error}
      </p>
    {/if}
    <div class="actions">
      <button
        type="button"
        class="btn btn-secondary"
        disabled={ui.busy}
        onclick={editMail}
      >
        Change email settings
      </button>
      <button
        type="button"
        class="btn btn-ghost"
        disabled={ui.busy}
        onclick={removeMail}
      >
        Remove email account
      </button>
    </div>
  {:else}
    <p>Add the band's mailbox to answer email enquiries from Bookings.</p>
    <div class="actions">
      <button
        type="button"
        class="btn btn-secondary"
        disabled={ui.busy}
        onclick={editMail}
      >
        Set up email
      </button>
    </div>
  {/if}
  {#if error}
    <p class="alert-text" role="alert">{error}</p>
  {/if}
</section>

<style>
.block {
  padding: 18px 28px 20px;
  border-bottom: var(--rule-2);
}
.block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
h3 {
  margin: 0;
  font-family: var(--font-body);
}
.hint {
  font-size: 13px;
  margin: 4px 0 0;
  color: var(--muted);
}
p {
  font-size: 14px;
  margin: 0 0 10px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ports {
  grid-template-columns: minmax(0, 1fr) 100px;
}
@media (max-width: 899px) {
  .block {
    padding-inline: 16px;
  }
}
</style>
