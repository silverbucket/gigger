import type {
  Channel,
  Contact,
  Conversation,
  ConversationIndex,
  Gig,
  Triage,
} from "@gigger/schemas";
import { normalize } from "./format";

export const channelTag: Record<Channel | "other", string> = {
  email: "MAIL",
  messenger: "MSGR",
  instagram: "IG",
  other: "OTHER",
};
export const channelName: Record<Channel | "other", string> = {
  email: "Email",
  messenger: "Messenger",
  instagram: "Instagram",
  other: "Other",
};
/** The contact field that holds this channel's handle. */
export const channelField = {
  email: "email",
  messenger: "messenger",
  instagram: "instagram",
} as const satisfies Record<Channel, keyof Contact>;

const handle = (value: string | undefined) =>
  (value ?? "").trim().replace(/^@/, "").toLocaleLowerCase();

/** A contact is picked automatically only on an exact handle or email match. */
export function exactContact(conversation: Conversation, contacts: Contact[]) {
  const peer = handle(conversation.peer.id);
  if (!peer) return undefined;
  const field = channelField[conversation.channel];
  return (
    contacts.find((c) => handle(c[field]) === peer) ??
    contacts.find((c) =>
      [c.email, c.messenger, c.instagram].some((v) => handle(v) === peer),
    )
  );
}
export function matchReason(conversation: Conversation) {
  return {
    email: "Matched by email address",
    messenger: "Matched by Messenger handle",
    instagram: "Matched by Instagram handle",
  }[conversation.channel];
}

export interface Suggestion {
  contact: Contact;
  reason: "Same name" | "Similar name" | "First name" | "Same surname";
  score: number;
}
/** Contacts whose name resembles the sender's, best first. */
export function suggestContacts(
  name: string | undefined,
  contacts: Contact[],
): Suggestion[] {
  const target = normalize(name ?? "").replace(/[^\p{L}\p{N} ]/gu, "");
  const parts = target.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const [first] = parts;
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const results: Suggestion[] = [];
  for (const contact of contacts) {
    const other = normalize(contact.name).replace(/[^\p{L}\p{N} ]/gu, "");
    const words = other.split(/\s+/).filter(Boolean);
    let suggestion: Suggestion | undefined;
    if (other === target)
      suggestion = { contact, reason: "Same name", score: 4 };
    else if (
      words[0] === first &&
      last &&
      words.length > 1 &&
      words[words.length - 1].startsWith(
        last.slice(0, Math.max(1, last.length)),
      )
    )
      suggestion = { contact, reason: "Similar name", score: 3 };
    else if (
      words[0]?.startsWith(first.slice(0, 4)) &&
      first.length >= 3 &&
      last &&
      words.some((w) => w.startsWith(last.slice(0, 3)))
    )
      suggestion = { contact, reason: "Similar name", score: 2 };
    else if (words[0] === first && first.length > 1)
      suggestion = { contact, reason: "First name", score: 1 };
    else if (last.length > 2 && words.length > 1 && words.at(-1) === last)
      suggestion = { contact, reason: "Same surname", score: 1 };
    if (suggestion) results.push(suggestion);
  }
  return results.sort(
    (a, b) => b.score - a.score || a.contact.name.localeCompare(b.contact.name),
  );
}

export type Match =
  | { kind: "matched"; contact: Contact; reason: string }
  | { kind: "ambiguous"; suggestions: Suggestion[] }
  | { kind: "new" };
export function matchSender(
  conversation: Conversation,
  contacts: Contact[],
): Match {
  const contact = exactContact(conversation, contacts);
  if (contact)
    return { kind: "matched", contact, reason: matchReason(conversation) };
  const suggestions = suggestContacts(conversation.peer.name, contacts);
  return suggestions.length
    ? { kind: "ambiguous", suggestions }
    : { kind: "new" };
}
export function matchLine(match: Match) {
  if (match.kind === "matched") return `✓ ${match.contact.name}`;
  if (match.kind === "ambiguous")
    return match.suggestions.length === 1
      ? "1 possible contact — choose one"
      : `${match.suggestions.length} possible contacts — choose one`;
  return "New sender · contact ready to create";
}

/** A contact prefilled from the sender's profile on that channel. */
export function contactFromSender(conversation: Conversation): Contact {
  const id = conversation.peer.id;
  return {
    id: "",
    name: conversation.peer.name?.trim() || id,
    [channelField[conversation.channel]]:
      conversation.channel === "instagram" ? id.replace(/^@/, "") : id,
  };
}

export type InboxState = "toSort" | "converted" | "archived";
export interface InboxItem {
  id: string;
  conversation: Conversation;
  state: InboxState;
  gig?: Gig;
  latest: string;
}
export const latestAt = (c: Conversation) =>
  [c.lastIn ?? "", c.lastOut ?? ""].sort().at(-1) ?? "";

/** Conversations for the band, newest first, with whether they still need sorting. */
export function inboxItems(
  index: ConversationIndex,
  bandIds: string[],
  gigs: Gig[],
  triage: Triage[],
): InboxItem[] {
  return Object.entries(index)
    .filter(([, c]) => bandIds.includes(c.bandId))
    .map(([id, conversation]) => {
      const gig = gigs.find((g) => g.conversationId === id);
      const archived = triage.find((t) => t.id === id);
      // A message that arrives after it was set aside puts it back to sort.
      const state: InboxState = gig
        ? "converted"
        : archived && (conversation.lastIn ?? "") <= archived.at
          ? "archived"
          : "toSort";
      return { id, conversation, state, gig, latest: latestAt(conversation) };
    })
    .sort((a, b) => b.latest.localeCompare(a.latest));
}
