import type {
  Attachment,
  Contact,
  Conversation,
  EnquirySource,
  Message,
} from "@gigger/schemas";
import { bands, storage } from "../storage";
import type { BandData } from "./data.svelte";
import { type Extracted, enquiryTitle, extractEnquiry } from "./extract";
import { messageTime } from "./format";
import {
  channelName,
  contactFromSender,
  type InboxItem,
  matchSender,
} from "./inbox";

/** What a new enquiry starts with when it comes from a message or a contact. */
export interface Prefill {
  conversationId?: string;
  enquiryText?: string;
  source?: EnquirySource;
  title?: string;
  contactId?: string;
  /** Why the contact was picked, e.g. "Matched by Instagram handle". */
  contactReason?: string;
  /** A contact started from the sender's profile. */
  newContact?: Contact;
  /** Ranked guesses when the sender matches no contact exactly. */
  suggestions?: { contact: Contact; reason: string }[];
  /** Original "from" line, e.g. "Messenger · Mon". */
  from?: string;
  extracted?: Extracted;
}

/** Threads read so far, by conversation ID; refreshed after each sync. */
class Threads {
  byId = $state<Record<string, Message[]>>({});
  files: Record<string, string> = {};
  async load(conversationId: string) {
    const messages = await bands.messages(conversationId);
    this.byId[conversationId] = messages;
    return messages;
  }
  async refresh() {
    await Promise.all(
      Object.keys(this.byId).map((id) => this.load(id).catch(() => {})),
    );
  }
  reset() {
    this.byId = {};
    for (const url of Object.values(this.files)) URL.revokeObjectURL(url);
    this.files = {};
  }
  /** Copied attachments live in private storage, so they are read through remoteStorage, not a URL. */
  async fileUrl(attachment: Attachment) {
    if (!attachment.url.startsWith("gigger/")) return attachment.url;
    if (!this.files[attachment.url]) {
      const file = (await storage
        .scope("/gigger/")
        .getFile(attachment.url.slice(7))) as {
        data: BlobPart;
        mimeType: string;
      };
      this.files[attachment.url] = URL.createObjectURL(
        new Blob([file.data], { type: file.mimeType }),
      );
    }
    return this.files[attachment.url];
  }
}
export const threads = new Threads();

export const latestIncoming = (messages: Message[] | undefined) =>
  [...(messages ?? [])].reverse().find((m) => m.direction === "in");

export function senderName(conversation: Conversation, data?: BandData) {
  const match = data ? matchSender(conversation, data.contacts) : undefined;
  return match?.kind === "matched"
    ? match.contact.name
    : conversation.peer.name || conversation.peer.id;
}

/** What the enquiry form starts with for a conversation. */
export function prefillFrom(item: InboxItem, data: BandData): Prefill {
  const conversation = item.conversation;
  const text =
    latestIncoming(threads.byId[item.id])?.object.content ??
    conversation.preview;
  const extracted: Extracted = extractEnquiry(
    text,
    data.venues,
    data.band.currency ?? "EUR",
  );
  const match = matchSender(conversation, data.contacts);
  const sender = senderName(conversation, data);
  return {
    conversationId: item.id,
    enquiryText: text,
    source: conversation.channel,
    title: enquiryTitle(extracted, data.venues, sender),
    from: `${channelName[conversation.channel]} · ${messageTime(conversation.lastIn ?? item.latest)}`,
    extracted,
    ...(match.kind === "matched"
      ? { contactId: match.contact.id, contactReason: match.reason }
      : {
          newContact: contactFromSender(conversation),
          ...(match.kind === "ambiguous"
            ? {
                suggestions: match.suggestions.map((s) => ({
                  contact: s.contact,
                  reason: s.reason,
                })),
              }
            : {}),
        }),
  };
}

/** Sends a reply through the API; a 502 means it was saved but not delivered. */
export async function sendReply(
  conversationId: string,
  bandId: string,
  text: string,
) {
  const { userAddress, token } = storage.remote;
  const username = decodeURIComponent(
    userAddress.slice(0, userAddress.lastIndexOf("@")),
  );
  const response = await fetch("/api/messages/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      username,
      bandId,
      conversation: conversationId,
      text,
    }),
  });
  const result = await response.json();
  if (response.ok || response.status === 502) {
    await storage.startSync();
    await threads.load(conversationId);
  }
  if (!response.ok)
    throw new Error(result.error ?? "Could not send. Please retry.");
}
