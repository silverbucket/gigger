import { expect, test } from "bun:test";
import type { Contact, Conversation, Gig, Triage } from "@showday/schemas";
import {
  contactFromSender,
  inboxItems,
  matchLine,
  matchSender,
  suggestContacts,
} from "./lib/inbox";

const contacts: Contact[] = [
  { id: "t", name: "Tomáš Kříž", instagram: "@kabinetmuz" },
  { id: "ms", name: "Marek Svoboda", email: "events@lucerna.example" },
  { id: "mk", name: "Marek Sýkora" },
  { id: "p", name: "Petra Nová", email: "Petra@vlese.cz" },
];
const conversation = (
  channel: Conversation["channel"],
  id: string,
  name?: string,
): Conversation => ({
  bandId: "b",
  channel,
  peer: { id, name },
  preview: "Hi",
  lastIn: "2026-11-04T10:00:00Z",
});

test("picks a contact only on an exact handle or email match", () => {
  const ig = matchSender(
    conversation("instagram", "kabinetmuz", "Tomas"),
    contacts,
  );
  expect(ig).toMatchObject({
    kind: "matched",
    reason: "Matched by Instagram handle",
  });
  const mail = matchSender(conversation("email", "petra@vlese.cz"), contacts);
  expect(mail.kind === "matched" && mail.contact.id).toBe("p");
});

test("never matches a handle against a different channel's field", () => {
  // Tomáš's Instagram handle is "kabinetmuz"; a Messenger peer with the same
  // id is a different person and must not be auto-matched to him.
  const messenger = matchSender(
    conversation("messenger", "kabinetmuz"),
    contacts,
  );
  expect(messenger.kind).not.toBe("matched");
});

test("ranks similar names and offers a new contact from the sender otherwise", () => {
  const unclear = matchSender(
    conversation("email", "marek.s@gmail.com", "Marek S."),
    contacts,
  );
  expect(unclear.kind).toBe("ambiguous");
  expect(matchLine(unclear)).toBe("2 possible contacts — choose one");
  expect(suggestContacts("Marek Svoboda", contacts)[0]).toMatchObject({
    reason: "Same name",
    contact: { id: "ms" },
  });
  const fresh = conversation("messenger", "ondra.pesek", "Ondra Pešek");
  expect(matchSender(fresh, contacts).kind).toBe("new");
  expect(contactFromSender(fresh)).toEqual({
    id: "",
    name: "Ondra Pešek",
    messenger: "ondra.pesek",
  });
});

test("a conversation is to sort until it becomes a gig or is set aside, and returns when they write again", () => {
  const index = {
    a: conversation("email", "a@x.cz"),
    b: { ...conversation("email", "b@x.cz"), lastIn: "2026-11-05T10:00:00Z" },
    c: conversation("email", "c@x.cz"),
    other: { ...conversation("email", "d@x.cz"), bandId: "elsewhere" },
  };
  const gigs = [{ id: "g", conversationId: "a" } as Gig];
  const triage: Triage[] = [
    { id: "b", status: "archived", at: "2026-11-04T12:00:00Z" },
    { id: "c", status: "archived", at: "2026-11-04T12:00:00Z" },
  ];
  const items = inboxItems(index, ["b"], gigs, triage);
  expect(Object.fromEntries(items.map((i) => [i.id, i.state]))).toEqual({
    a: "converted",
    b: "toSort",
    c: "archived",
  });
});
