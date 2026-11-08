<script lang="ts">
import MessageTranslate from "./MessageTranslate.svelte";

let {
  messageId,
  subject,
  body,
  showSubject = false,
  conversationId,
  onSubject,
  separateControl = false,
  displayBody = $bindable(body),
  contentLang = $bindable<string | undefined>(),
}: {
  messageId: string;
  subject?: string;
  body: string;
  showSubject?: boolean;
  conversationId?: string;
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

{#if !separateControl}
  <p class="pre" lang={contentLang}>{displayBody}</p>
{/if}
<div class:after={!separateControl}>
  <MessageTranslate
    {messageId}
    {subject}
    {body}
    {showSubject}
    {conversationId}
    bind:displaySubject
    bind:displayBody
    bind:contentLang
  />
</div>

<style>
.after {
  margin: 8px 0 -4px;
}
</style>
