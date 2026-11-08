<script lang="ts">
import MessageTranslate from "./MessageTranslate.svelte";

let {
  messageId,
  subject,
  body,
  showSubject = false,
  onSubject,
  separateControl = false,
  displayBody = $bindable(body),
  contentLang = $bindable<string | undefined>(),
}: {
  messageId: string;
  subject?: string;
  body: string;
  showSubject?: boolean;
  onSubject?: (subject: string | undefined) => void;
  /** When true, only the control is rendered; the parent supplies the body text. */
  separateControl?: boolean;
  displayBody?: string;
  contentLang?: string | undefined;
} = $props();

let displaySubject = $state<string | undefined>();

$effect(() => {
  onSubject?.(displaySubject);
});
</script>

<MessageTranslate
  {messageId}
  {subject}
  {body}
  {showSubject}
  bind:displaySubject
  bind:displayBody
  bind:contentLang
/>
{#if !separateControl}
  <p class="pre" lang={contentLang}>{displayBody}</p>
{/if}
