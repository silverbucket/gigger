import { storage } from "../storage";

/** Opens the message-events stream; returns a cleanup. */
export function connectMessageStream(
  options: {
    username: string;
    bandId: string;
    token: string;
    aborted: () => boolean;
    onRetrying?: (retrying: boolean) => void;
  },
  fetchImpl: typeof fetch = fetch,
): () => void {
  const { username, bandId, token, aborted, onRetrying } = options;
  let events: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const setRetrying = (retrying: boolean) => onRetrying?.(retrying);
  const fail = () => {
    if (aborted()) return;
    setRetrying(true);
    reopen();
  };
  const reopen = () => {
    if (!aborted()) retry = setTimeout(() => open().catch(fail), 5000);
  };

  async function open() {
    const response = await fetchImpl("/api/messages/ticket", {
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
      if (!aborted()) setRetrying(false);
    };
    events.onmessage = () => {
      if (!aborted()) void storage.startSync();
    };
    events.onerror = () => {
      setRetrying(true);
      events?.close();
      reopen();
    };
  }

  open().catch(fail);

  return () => {
    clearTimeout(retry);
    events?.close();
    setRetrying(false);
  };
}
