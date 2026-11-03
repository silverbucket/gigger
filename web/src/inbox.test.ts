import { expect, test } from "bun:test";
import {
  attachmentPath,
  conversationId,
  Gigger,
  type GiggerStore,
  type Message,
  messagePath,
} from "@gigger/schemas";
import RemoteStorage from "remotestoragejs";

test("the app reads server-written messages and the conversation index through the real module", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Gigger);
  storage.access.claim("gigger", "rw");
  storage.caching.enable("/gigger/");
  const store = (storage as RemoteStorage & { gigger: GiggerStore }).gigger;
  const client = storage.scope("/gigger/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  try {
    expect(await store.conversations()).toEqual({});
    const conversation = conversationId("email", "jo@example.com");
    expect(conversation).toBe("email-am9AZXhhbXBsZS5jb20");
    const first: Message = {
      id: "m1",
      channel: "email",
      direction: "in",
      conversation,
      bandId: "a",
      actor: { id: "jo@example.com", name: "Jo" },
      target: { id: "band@example.com" },
      object: {
        type: "Note",
        content: "Free on the 5th?",
        attachment: [
          { type: "image", url: "gigger/x", mediaType: "image/png" },
        ],
      },
      published: "2025-01-31T23:00:00.000Z",
    };
    const second: Message = {
      ...first,
      id: "m2",
      direction: "out",
      actor: first.target,
      target: first.actor,
      object: { type: "Note", content: "Yes!" },
      published: "2025-02-01T09:00:00.000Z",
    };
    await client.storeObject("message", messagePath(first), first);
    await client.storeObject("message", messagePath(second), second);
    await client.storeFile("image/png", attachmentPath(first, 0), "PNG");
    await client.storeObject("conversations", "conversations/index", {
      [conversation]: {
        bandId: "a",
        channel: "email",
        peer: first.actor,
        lastIn: first.published,
        lastOut: second.published,
        preview: "Yes!",
      },
    });
    expect((await store.messages(conversation)).map((m) => m.id)).toEqual([
      "m1",
      "m2",
    ]);
    expect((await store.conversations())[conversation]?.preview).toBe("Yes!");
    await expect(
      client.storeObject("message", "conversations/c/2025-01/bad", {
        ...first,
        channel: "pigeon",
      }),
    ).rejects.toBeDefined();
    await expect(store.messages("../x")).rejects.toThrow("Invalid ID");
  } finally {
    storage.disconnect();
  }
});
