import { expect, test } from "bun:test";
import {
  type ConversationIndex,
  conversationId,
  type Message,
  messagePath,
  Showday,
  type ShowdayStore,
  type Triage,
} from "@showday/schemas";
import RemoteStorage from "remotestoragejs";
import { inboxItems } from "./lib/inbox";

test("discarded and reviewed inbox states are distinct from to sort", () => {
  const index: ConversationIndex = {
    reviewed: {
      bandId: "b",
      channel: "email",
      peer: { id: "a@x.cz" },
      preview: "Maybe",
      lastIn: "2026-11-04T10:00:00Z",
    },
    discarded: {
      bandId: "b",
      channel: "email",
      peer: { id: "d@x.cz" },
      preview: "Spam",
      lastIn: "2026-11-04T10:00:00Z",
    },
    fresh: {
      bandId: "b",
      channel: "email",
      peer: { id: "n@x.cz" },
      preview: "New",
      lastIn: "2026-11-06T10:00:00Z",
    },
  };
  const triage: Triage[] = [
    { id: "reviewed", status: "archived", at: "2026-11-04T12:00:00Z" },
    { id: "discarded", status: "discarded", at: "2026-11-04T12:00:00Z" },
  ];
  expect(
    Object.fromEntries(
      inboxItems(index, ["b"], [], triage).map((i) => [i.id, i.state]),
    ),
  ).toEqual({
    reviewed: "archived",
    discarded: "discarded",
    fresh: "toSort",
  });
});

test("discarded threads with a newer lastIn are not purged and show as to sort", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  const store = (storage as RemoteStorage & { showday: ShowdayStore }).showday;
  const client = storage.scope("/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  try {
    await store.save("band", "a", { id: "a", name: "Band" });
    const convo = conversationId("email", "a", "returned@example.com");
    const first: Message = {
      id: "old",
      channel: "email",
      direction: "in",
      conversation: convo,
      bandId: "a",
      actor: { id: "returned@example.com" },
      target: { id: "band@example.com" },
      object: { type: "Note", content: "Spam" },
      published: "2030-01-01T10:00:00.000Z",
    };
    await client.storeObject("message", messagePath(first), first);
    await client.storeObject("conversations", "conversations/index", {
      [convo]: {
        bandId: "a",
        channel: "email",
        peer: first.actor,
        lastIn: first.published,
        preview: "Spam",
      },
    });
    await store.discardConversation("a", convo, "2030-01-02T10:00:00.000Z");
    const followUp: Message = {
      ...first,
      id: "new",
      object: { type: "Note", content: "Real enquiry" },
      published: "2030-02-15T10:00:00.000Z",
    };
    await client.storeObject("message", messagePath(followUp), followUp);
    await client.storeObject("conversations", "conversations/index", {
      [convo]: {
        bandId: "a",
        channel: "email",
        peer: first.actor,
        lastIn: followUp.published,
        preview: "Real enquiry",
      },
    });
    await store.purgeExpiredDiscarded(Date.parse("2030-03-10T10:00:00.000Z"));
    expect((await store.conversations())[convo]?.preview).toBe("Real enquiry");
    expect((await store.messages(convo)).map((m) => m.id).sort()).toEqual([
      "new",
      "old",
    ]);
    expect(
      inboxItems(
        await store.conversations(),
        ["a"],
        [],
        await store.list("triage", "a"),
      )[0]?.state,
    ).toBe("toSort");
  } finally {
    storage.disconnect();
  }
});

test("only discarded threads older than 30 days are purged", async () => {
  const storage = new RemoteStorage();
  storage.addModule(Showday);
  storage.access.claim("showday", "rw");
  storage.caching.enable("/showday/");
  const store = (storage as RemoteStorage & { showday: ShowdayStore }).showday;
  const client = storage.scope("/showday/");
  await new Promise<void>((resolve) => storage.on("ready", () => resolve()));
  try {
    await store.save("band", "a", { id: "a", name: "Band" });
    const oldDiscarded = conversationId("email", "a", "old-spam@example.com");
    const kept = conversationId("email", "a", "booker@example.com");
    let conversationIndex = await store.conversations();
    for (const [convo, id, published] of [
      [oldDiscarded, "old", "2030-01-01T10:00:00.000Z"],
      [kept, "keep", "2030-01-05T10:00:00.000Z"],
    ] as const) {
      const message: Message = {
        id,
        channel: "email",
        direction: "in",
        conversation: convo,
        bandId: "a",
        actor: { id: `${id}@example.com` },
        target: { id: "band@example.com" },
        object: { type: "Note", content: "Hello" },
        published,
      };
      await client.storeObject("message", messagePath(message), message);
      conversationIndex = {
        ...conversationIndex,
        [convo]: {
          bandId: "a",
          channel: "email",
          peer: message.actor,
          lastIn: message.published,
          preview: "Hello",
        },
      };
      await client.storeObject(
        "conversations",
        "conversations/index",
        conversationIndex,
      );
    }
    await store.discardConversation(
      "a",
      oldDiscarded,
      "2030-01-02T10:00:00.000Z",
    );
    await store.archiveConversation("a", kept, "2030-01-06T10:00:00.000Z");
    await store.save("gig", "a", {
      id: "g",
      title: "Gig",
      venue: "Club",
      address: "Street",
      contacts: [],
      date: "2030-06-01",
      status: "confirmed",
      conversationId: kept,
    });
    await store.markPlayed(
      "a",
      "g",
      {
        rating: 4,
        capacity: "50–100",
        setting: "indoor",
        pa: "venue provided",
        playAgain: true,
      },
      { dealType: "fixed fee", total: 100, takeHome: 100, currency: "EUR" },
    );
    await store.purgeExpiredDiscarded(Date.parse("2030-02-10T10:00:00.000Z"));
    expect((await store.conversations())[oldDiscarded]).toBeUndefined();
    expect(await store.messages(oldDiscarded)).toEqual([]);
    expect((await store.conversations())[kept]?.preview).toBe("Hello");
    expect(await store.list("triage", "a")).toMatchObject([
      { id: kept, status: "archived" },
    ]);
  } finally {
    storage.disconnect();
  }
});
