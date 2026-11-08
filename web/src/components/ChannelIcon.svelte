<script lang="ts">
import type { Channel } from "@showday/schemas";
import Icon from "./Icon.svelte";

/** The channel a conversation runs on, as a coloured icon: email, Instagram, Messenger. */
let { channel, size = 14 }: { channel: Channel | "other"; size?: number } =
  $props();
const icon = $derived(
  channel === "email"
    ? "mail"
    : channel === "instagram"
      ? "instagram"
      : "message",
);
</script>

<span class="channel-icon {channel}" aria-hidden="true"
  ><Icon name={icon} {size} stroke={2.25} /></span
>

<style>
.channel-icon {
  display: inline-grid;
  place-items: center;
  color: var(--channel-other);
}
.email {
  color: var(--channel-email);
}
.instagram {
  color: var(--channel-instagram);
}
.messenger {
  color: var(--channel-messenger);
}
</style>
