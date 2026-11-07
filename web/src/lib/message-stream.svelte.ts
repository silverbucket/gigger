import { storage } from "../storage";

/** Whether the Bookings live update stream has failed and is retrying. */
class MessageStream {
  retrying = $state(false);
}

export const messageStream = new MessageStream();

/** Opens the message-events stream; returns a cleanup. */
export function connectMessageStream(options: {
  username: string;
  bandId: string;
  token: string;
  aborted: () => boolean;
}): () => void {
  const { username, bandId, token, aborted } = options;
  let events: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const reopen = () => {
    if (!aborted()) retry = setTimeout(() => open().catch(reopen), 5000);
  };

  async function open() {
    const response = await fetch("/api/messages/ticket", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ username, bandId }),
    });
    if (!response.ok) throw new Error("No ticket");
    const { ticket } = await response.json();
    if (aborted()) return;
    events = new EventSource(
      `/api/messages/events?${new URLSearchParams({ ticket })}`,
    );
    events.onopen = () => {
      if (!aborted()) messageStream.retrying = false;
    };
    events.onmessage = () => {
      if (!aborted()) void storage.startSync();
    };
    events.onerror = () => {
      messageStream.retrying = true;
      events?.close();
      reopen();
    };
  }

  open().catch(reopen);

  return () => {
    clearTimeout(retry);
    events?.close();
    messageStream.retrying = false;
  };
}
