<script lang="ts">
import { currencyForLocale } from "@showday/schemas";
import Icon from "../components/Icon.svelte";
import { router } from "../lib/router.svelte";
import { startProviderSession, startSession } from "../storage";

/** Log in or sign up. Signing up creates the account and its first band. */
let {
  status,
  onsignedin,
}: { status: string; onsignedin: () => Promise<void> } = $props();
let mode = $state<"login" | "signup">(
  location.pathname === "/signup" ? "signup" : "login",
);
let username = $state("");
let email = $state("");
let password = $state("");
let bandName = $state("");
let busy = $state(false);
let error = $state("");

function switchTo(next: "login" | "signup", event: MouseEvent) {
  event.preventDefault();
  mode = next;
  error = "";
  history.replaceState(null, "", `/${next}`);
}
async function authenticate(event: SubmitEvent) {
  event.preventDefault();
  busy = true;
  error = "";
  try {
    if (mode === "login" && username.trim().includes("@")) {
      const address = username.trim();
      const leaving = await startProviderSession(address, (held) =>
        confirm(
          `Log in as ${address}? Changes made here as ${held} that have not synced yet will be lost.`,
        ),
      );
      if (leaving) password = "";
      return;
    }
    await startSession(mode, {
      username,
      email,
      password,
      ...(mode === "signup"
        ? { bandName, currency: currencyForLocale(navigator.language) }
        : {}),
    });
    password = "";
    bandName = "";
    history.replaceState(null, "", "/");
    // replaceState fires no hashchange, so the router would otherwise keep
    // showing whatever record was open under the previous session.
    router.read();
    await onsignedin();
  } catch (cause) {
    error =
      cause instanceof Error
        ? cause.message
        : "Could not log in. Please retry.";
  } finally {
    busy = false;
  }
}
</script>

<div class="auth">
  <div class="brand-side">
    <p class="brand"><span class="mark" aria-hidden="true"></span>Showday</p>
    <p class="claim">Book it, plan it, play it, post it.</p>
    <p class="sub">Enquiries, gigs, venues and the band, in one place.</p>
  </div>
  <section class="form-side" aria-labelledby="auth-title">
    <p class="kicker">{mode === "signup" ? "New here" : "Welcome back"}</p>
    <h1 id="auth-title">
      {mode === "signup" ? "Create your account" : "Log in"}
    </h1>
    {#if status}
      <p role="status" class="muted">{status}</p>
    {/if}
    <form class="form" onsubmit={authenticate}>
      <div class="field">
        <label for="auth-username">Username</label>
        <input
          id="auth-username"
          class="input"
          autocomplete="username"
          bind:value={username}
          required
          maxlength="254"
          pattern={mode === "signup"
            ? "[a-zA-Z0-9][a-zA-Z0-9._\\-]{1,63}"
            : undefined}
        >
        {#if mode === "login"}
          <p class="field-hint">
            Or user@host to use another storage provider.
          </p>
        {/if}
      </div>
      {#if mode === "signup"}
        <div class="field">
          <label for="auth-email">Email</label>
          <input
            id="auth-email"
            class="input"
            type="email"
            autocomplete="email"
            bind:value={email}
            required
            maxlength="254"
          >
        </div>
      {/if}
      {#if mode === "signup" || !username.includes("@")}
        <div class="field">
          <label for="auth-password">Password</label>
          <input
            id="auth-password"
            class="input"
            type="password"
            autocomplete={mode === "signup"
              ? "new-password"
              : "current-password"}
            bind:value={password}
            required
            minlength={mode === "signup" ? 8 : 1}
            maxlength="1024"
          >
        </div>
      {/if}
      {#if mode === "signup"}
        <div class="field">
          <label for="auth-band">Band name</label>
          <input
            id="auth-band"
            class="input"
            bind:value={bandName}
            required
            maxlength="200"
          >
        </div>
      {/if}
      {#if error}
        <p class="alert-text" role="alert">{error}</p>
      {/if}
      <button
        type="submit"
        class="btn btn-primary btn-wide submit"
        disabled={busy}
      >
        {busy ? "Please wait…" : mode === "signup" ? "Sign up" : "Log in"}
        <Icon name="arrow-right" stroke={2.5} />
      </button>
    </form>
    <p class="switch">
      {#if mode === "signup"}
        Already have an account?
        <a href="/login" onclick={(e) => switchTo("login", e)}>Log in</a>
      {:else}
        New to Showday?
        <a href="/signup" onclick={(e) => switchTo("signup", e)}
          >Create an account</a
        >
      {/if}
    </p>
  </section>
</div>

<style>
.auth {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 520px);
  min-height: 100dvh;
}
.brand-side {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 32px 48px 48px;
  background: var(--color-accent-600);
  color: #fff;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-weight: 800;
  font-size: 22px;
}
.mark {
  width: 14px;
  height: 14px;
  background: var(--color-bg);
}
.claim {
  margin: auto 0 12px;
  font-size: clamp(48px, 7vw, 96px);
  font-weight: 800;
  line-height: 0.95;
  letter-spacing: -0.04em;
  max-width: 10ch;
}
.sub {
  margin: 0;
  font-size: 17px;
}
.form-side {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 48px;
  border-left: var(--rule-ink);
}
h1 {
  font-size: 48px;
  margin: 4px 0 24px;
}
.submit {
  margin-top: 8px;
  min-height: 48px;
}
.switch {
  margin-top: 24px;
  padding-top: 16px;
  border-top: var(--rule-2);
  font-size: 14px;
}
.switch a {
  color: var(--color-accent-700);
  font-weight: 600;
}
@media (max-width: 899px) {
  .auth {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .brand-side {
    padding: 20px 16px 24px;
  }
  .claim {
    margin-top: 32px;
    font-size: 44px;
  }
  .form-side {
    justify-content: flex-start;
    padding: 24px 16px 40px;
    border-left: 0;
  }
  h1 {
    font-size: 36px;
  }
}
</style>
