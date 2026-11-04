import type { Channel, Message } from "@gigger/schemas";
import SockethubClient from "@sockethub/client";

export interface Sender {
  send(message: Message, credentials?: Record<string, unknown>): Promise<void>;
}

/** One headless Sockethub connection per channel; the platform name is the channel name. */
export function sockethubSender(
  platform: Channel,
  url = process.env.SOCKETHUB_URL ?? "http://sockethub:10550",
): Sender {
  let client: Promise<SockethubClient> | undefined;
  const emit = (sc: SockethubClient, event: string, payload: unknown) =>
    new Promise<void>((resolve, reject) =>
      sc.socket.emit(
        event,
        payload,
        (result: { error?: string } | undefined) =>
          result?.error ? reject(new Error(result.error)) : resolve(),
      ),
    );
  return {
    async send(message, credentials) {
      client ??= SockethubClient.connect(url, { initTimeoutMs: 10000 }).then(
        async (sc) => {
          await sc.ready();
          return sc;
        },
      );
      const sc = await client.catch((error) => {
        client = undefined;
        throw error;
      });
      if (!sc.getRegisteredPlatforms().some((p) => p.id === platform))
        throw new Error(
          `${platform[0].toUpperCase()}${platform.slice(1)} isn't set up on this server yet.`,
        );
      if (credentials)
        await emit(sc, "credentials", {
          "@context": sc.contextFor(platform),
          type: "credentials",
          actor: { id: message.actor.id },
          object: { type: "credentials", ...credentials },
        });
      await emit(sc, "message", {
        "@context": sc.contextFor(platform),
        type: "send",
        actor: { id: message.actor.id, type: "person" },
        target: { id: message.target.id, type: "person" },
        object: {
          type: "message",
          content: message.object.content,
          ...(message.tag ? { tag: message.tag } : {}),
        },
      });
    },
  };
}
