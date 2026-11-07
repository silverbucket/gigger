import { connectMessageStream as connectCore } from "./message-stream-connect";

/** Whether the Bookings live update stream has failed and is retrying. */
class MessageStream {
  retrying = $state(false);
}

export const messageStream = new MessageStream();

export function connectMessageStream(options: {
  username: string;
  bandId: string;
  token: string;
  aborted: () => boolean;
}): () => void {
  return connectCore({
    ...options,
    onRetrying: (retrying) => {
      messageStream.retrying = retrying;
    },
  });
}
