<script lang="ts">
import { untrack } from "svelte";
import {
  alreadyMatchesCopy,
  detectEmailLanguage,
  firstActions,
  languageAlreadyMatches,
  readTranslationCache,
  requestTranslation,
  showInLabel,
  sourceForTarget,
  type TranslateTarget,
  targetLabel,
  writeTranslationCache,
} from "../lib/message-translate";
import {
  readInboxLangUi,
  writeInboxLangUi,
} from "../lib/message-translate-ui-session";
import { ui } from "../lib/ui.svelte";
import Segmented from "./Segmented.svelte";

let {
  messageId,
  subject,
  body,
  showSubject = false,
  conversationId,
  displaySubject = $bindable<string | undefined>(),
  displayBody = $bindable(""),
  contentLang = $bindable<string | undefined>(),
}: {
  messageId: string;
  subject?: string;
  body: string;
  showSubject?: boolean;
  /** When set (latest email), restore the in-session control across reactive refresh. */
  conversationId?: string;
  displaySubject?: string | undefined;
  displayBody?: string;
  contentLang?: string | undefined;
} = $props();

const hint = $derived(detectEmailLanguage(subject, body));
const actions = $derived(firstActions(hint));

let chosen: TranslateTarget | undefined = $state();
let segmented = $state(false);
let view: "original" | TranslateTarget = $state("original");
let busy = $state(false);
let failed = $state(false);
let already: TranslateTarget | undefined = $state();
let requestId = 0;
let abort: AbortController | undefined;

// Re-init only when this incoming message changes — not when thread sync refreshes
// subject/body. In-memory UI state survives remount for the same conversation.
$effect(() => {
  const id = messageId;
  const restored = untrack(() => {
    const convo = conversationId;
    if (!convo || !showSubject) return undefined;
    const saved = readInboxLangUi(convo);
    if (!saved || saved.messageId !== id || !saved.chosen || !saved.segmented)
      return undefined;
    return saved;
  });
  if (restored) {
    chosen = restored.chosen;
    segmented = true;
    view = restored.view;
    busy = false;
    failed = false;
    already = undefined;
  } else {
    chosen = undefined;
    segmented = false;
    view = "original";
    busy = false;
    failed = false;
    already = undefined;
  }
  abort?.abort();
  untrack(() => {
    if (!restored || restored.view === "original") {
      displaySubject = subject;
      displayBody = body;
      contentLang = undefined;
    }
  });
  return () => {
    abort?.abort();
    if (messageId === id) requestId++;
  };
});

$effect(() => {
  if (!conversationId || !showSubject || !segmented || !chosen) return;
  messageId;
  view;
  const convo = conversationId;
  writeInboxLangUi(convo, {
    messageId,
    chosen,
    segmented,
    view,
  });
});

function applyView() {
  if (view === "original" || !chosen) {
    displaySubject = subject;
    displayBody = body;
    contentLang = hint === "en" || hint === "cs" ? hint : undefined;
    return;
  }
  const cached = readTranslationCache(messageId, chosen);
  if (!cached) {
    displaySubject = subject;
    displayBody = body;
    contentLang = undefined;
    return;
  }
  displaySubject = showSubject ? (cached.subject ?? subject) : subject;
  displayBody = cached.body;
  contentLang = chosen;
}

$effect(() => {
  view;
  chosen;
  subject;
  body;
  applyView();
});

async function runTranslate(target: TranslateTarget, force = false) {
  failed = false;
  already = undefined;
  chosen = target;
  if (!force && languageAlreadyMatches(hint, target, subject, body)) {
    segmented = false;
    already = target;
    view = "original";
    return;
  }
  segmented = true;
  view = "original";
  const cached = readTranslationCache(messageId, target);
  if (cached) {
    view = target;
    applyView();
    return;
  }
  busy = true;
  const id = ++requestId;
  const activeId = messageId;
  abort?.abort();
  abort = new AbortController();
  try {
    const source = sourceForTarget(hint);
    const result = await requestTranslation(
      {
        subject: showSubject ? subject : undefined,
        body,
        target,
        source,
      },
      abort.signal,
    );
    if (id !== requestId || activeId !== messageId) return;
    if (showSubject && subject?.trim() && !result.subject?.trim()) {
      throw new Error("Could not translate this message.");
    }
    writeTranslationCache(activeId, target, result);
    view = target;
    applyView();
  } catch (error) {
    if (id !== requestId || activeId !== messageId) return;
    if ((error as Error).name === "AbortError") return;
    failed = true;
    view = "original";
  } finally {
    if (id === requestId) busy = false;
  }
}

function pick(target: TranslateTarget) {
  runTranslate(target);
}

function translateAnyway() {
  if (!already) return;
  runTranslate(already, true);
}

function retry() {
  if (!chosen) return;
  failed = false;
  runTranslate(chosen, true);
}

function onSegment(value: "original" | TranslateTarget) {
  if (busy) return;
  view = value;
  failed = false;
  applyView();
}

const segmentValue = $derived(
  busy || view === "original" || !chosen ? "original" : view,
);
const targetOptionLabel = $derived(
  busy ? "Translating…" : chosen ? targetLabel(chosen) : "English",
);
const note = $derived(
  view !== "original" && chosen && !failed && !busy && !already
    ? "Check names, dates, venues, and amounts in the original."
    : "",
);
</script>

<div class="translate">
  {#if !segmented && !already}
    <div class="first-actions">
      {#each actions as target (target)}
        <button
          type="button"
          class="pick"
          disabled={busy}
          onclick={() => pick(target)}
        >
          {showInLabel(target)}
        </button>
      {/each}
    </div>
  {:else if already && !segmented}
    <p class="status">{alreadyMatchesCopy(already)}</p>
    <button type="button" class="pick" onclick={translateAnyway}>
      Translate anyway
    </button>
    {#if actions.length > 1}
      <div class="first-actions">
        {#each actions.filter((t) => t !== already) as target (target)}
          <button
            type="button"
            class="pick"
            disabled={busy}
            onclick={() => pick(target)}
          >
            {showInLabel(target)}
          </button>
        {/each}
      </div>
    {/if}
  {:else if chosen}
    <Segmented
      label="Message language"
      name={`message-language-${messageId}`}
      size="lg"
      columns={ui.phone ? 2 : undefined}
      options={[
        { value: "original", label: "Original" },
        { value: chosen, label: targetOptionLabel },
      ]}
      value={segmentValue}
      disabled={busy}
      onchange={(value) => onSegment(value as "original" | TranslateTarget)}
    />
    <span class="live" aria-live="polite">{busy ? "Translating…" : ""}</span>
  {/if}

  {#if failed}
    <p class="status alert-text" role="alert">
      Couldn't translate this message.
    </p>
    <button type="button" class="pick" onclick={retry}>Try again</button>
  {:else if note}
    <p class="status">{note}</p>
  {/if}
</div>

<style>
.translate {
  padding: 12px 0 8px;
}
.first-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.pick {
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-accent-700);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.pick:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.pick:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
.status {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.live {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
