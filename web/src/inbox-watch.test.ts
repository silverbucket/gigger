import { expect, test } from "bun:test";
import {
  aggregateBookingsInboxStatus,
  bandBookingsInboxStatus,
  bookingsInboxLabel,
  hasIncomingMailbox,
  mergeMailByBandRefresh,
  showToSortSection,
} from "./lib/inbox-watch";
import { connectMessageStream } from "./lib/message-stream-connect";

const band = (
  id: string,
  patch: Partial<Parameters<typeof bandBookingsInboxStatus>[0]> = {},
) => ({
  bandId: id,
  imapHost: "imap.example.com",
  watching: true,
  inboxPhase: "watching" as const,
  ...patch,
});

test("status priority picks the worst case across bands", () => {
  const watching = band("a");
  const connecting = band("b", { watching: false, inboxPhase: "connecting" });
  const error = band("c", { error: "problem", inboxPhase: "retrying" });
  expect(
    aggregateBookingsInboxStatus([watching, connecting, error], false),
  ).toEqual({
    status: "error",
    bandId: "c",
  });
  expect(
    aggregateBookingsInboxStatus([watching, connecting], false),
  ).toMatchObject({ status: "connecting", bandId: "b" });
  expect(aggregateBookingsInboxStatus([watching], false)).toMatchObject({
    status: "watching",
    bandId: "a",
  });
});

test("no incoming mailbox hides the watch status", () => {
  expect(
    bandBookingsInboxStatus(
      { bandId: "a", watching: false, inboxPhase: "idle" },
      false,
    ),
  ).toBe("hidden");
  expect(hasIncomingMailbox([])).toBeFalse();
  expect(showToSortSection(false, false)).toBeFalse();
});

test("incoming mailbox shows the To sort section even when empty", () => {
  expect(hasIncomingMailbox([band("a")])).toBeTrue();
  expect(showToSortSection(true, false)).toBeTrue();
  expect(showToSortSection(false, true)).toBeTrue();
});

test("a retrying list stream downgrades watching to Reconnecting", () => {
  expect(bandBookingsInboxStatus(band("a"), false)).toBe("watching");
  expect(bandBookingsInboxStatus(band("a"), true)).toBe("reconnecting");
  expect(bookingsInboxLabel("reconnecting")).toBe("Reconnecting");
});

test("mailbox error label matches Settings email tag copy", () => {
  expect(bookingsInboxLabel("error")).toBe("Mailbox error");
});

test("mergeMailByBandRefresh keeps the previous status when a band fetch fails", () => {
  const previous = {
    a: band("a", { error: "problem" }),
    b: band("b"),
  };
  const merged = mergeMailByBandRefresh(
    previous,
    ["a", "b"],
    [
      { bandId: "a", ok: false },
      {
        bandId: "b",
        ok: true,
        account: {
          imapHost: "imap.example.com",
          watching: false,
          inboxPhase: "connecting",
        },
      },
    ],
  );
  expect(merged.a).toEqual(previous.a);
  expect(merged.b?.inboxPhase).toBe("connecting");
});

test("failed ticket request sets the list stream retrying state", async () => {
  let retrying = false;
  const stop = connectMessageStream(
    {
      username: "sam",
      bandId: "band1",
      token: "token",
      aborted: () => false,
      onRetrying: (value) => {
        retrying = value;
      },
    },
    async () => new Response("", { status: 503 }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(retrying).toBeTrue();
  stop();
  expect(retrying).toBeFalse();
});

test("the mailbox error alert copy warns without technical detail", () => {
  const alert = "New email may not arrive. Open email settings to fix this.";
  expect(alert).toContain("Open email settings");
  expect(alert.toLowerCase()).not.toContain("imap");
  expect(alert.toLowerCase()).not.toContain("sync");
});
