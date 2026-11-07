/** Email account fields needed for inbox watch status on Bookings and Settings. */
export type MailWatchAccount = {
  bandId: string;
  imapHost?: string;
  error?: string;
  watching: boolean;
  inboxPhase?: "idle" | "connecting" | "watching" | "retrying";
};

export type BookingsInboxStatus =
  | "error"
  | "reconnecting"
  | "connecting"
  | "watching"
  | "hidden";

const rank: Record<Exclude<BookingsInboxStatus, "hidden">, number> = {
  error: 0,
  reconnecting: 1,
  connecting: 2,
  watching: 3,
};

/** Settings → Email status line (includes send-only and inbox idle). */
export function emailSettingsStatusLine(
  account: Omit<MailWatchAccount, "bandId">,
): string {
  if (!account.imapHost) return "Send only";
  if (account.error) return "Mailbox error";
  if (account.inboxPhase === "retrying") return "Reconnecting";
  if (account.inboxPhase === "connecting") return "Connecting";
  return account.watching ? "Watching inbox" : "Inbox idle";
}

/** Bookings tag label for one incoming mailbox and the list update stream. */
export function bandBookingsInboxStatus(
  account: MailWatchAccount | null | undefined,
  listStreamRetrying: boolean,
): BookingsInboxStatus {
  if (!account?.imapHost) return "hidden";
  if (account.error) return "error";
  if (listStreamRetrying || account.inboxPhase === "retrying")
    return "reconnecting";
  if (account.inboxPhase === "connecting" || !account.watching)
    return "connecting";
  return "watching";
}

export function bookingsInboxLabel(
  status: Exclude<BookingsInboxStatus, "hidden">,
): string {
  switch (status) {
    case "error":
      return "Mailbox error";
    case "reconnecting":
      return "Reconnecting";
    case "connecting":
      return "Connecting";
    case "watching":
      return "Watching inbox";
  }
}

export function bookingsInboxTagKind(
  status: Exclude<BookingsInboxStatus, "hidden">,
): "accent" | "proposed" {
  return status === "error" ? "proposed" : "accent";
}

/** Worst status across every incoming mailbox in view. */
export function aggregateBookingsInboxStatus(
  accounts: MailWatchAccount[],
  listStreamRetrying: boolean,
): { status: BookingsInboxStatus; bandId?: string } {
  let best:
    | {
        status: Exclude<BookingsInboxStatus, "hidden">;
        bandId: string;
        priority: number;
      }
    | undefined;
  for (const account of accounts) {
    const status = bandBookingsInboxStatus(account, listStreamRetrying);
    if (status === "hidden") continue;
    const priority = rank[status];
    if (!best || priority < best.priority)
      best = { status, bandId: account.bandId, priority };
  }
  if (!best) return { status: "hidden" };
  return { status: best.status, bandId: best.bandId };
}

export function hasIncomingMailbox(accounts: MailWatchAccount[]): boolean {
  return accounts.some((account) => !!account.imapHost);
}

export function showToSortSection(
  hasIncoming: boolean,
  hasListedMessages: boolean,
): boolean {
  return hasIncoming || hasListedMessages;
}

/** Applies one mailbox status refresh without dropping entries when a fetch fails. */
export function mergeMailByBandRefresh(
  previous: Record<string, MailWatchAccount>,
  bandIds: string[],
  updates: {
    bandId: string;
    ok: boolean;
    account?: Omit<MailWatchAccount, "bandId"> | null;
  }[],
): Record<string, MailWatchAccount> {
  const next = { ...previous };
  for (const id of Object.keys(next)) {
    if (!bandIds.includes(id)) delete next[id];
  }
  for (const { bandId, ok, account } of updates) {
    if (!ok) continue;
    if (!account?.imapHost) delete next[bandId];
    else next[bandId] = { bandId, ...account };
  }
  return next;
}

type MailAccountFetchResult = {
  bandId: string;
  ok: boolean;
  account?: Omit<MailWatchAccount, "bandId"> | null;
};

/** Bookings mailbox poll: keep prior status when a band refresh fails. */
export async function refreshBookingsMailByBand(
  previous: Record<string, MailWatchAccount>,
  bandIds: string[],
  fetchAccount: (
    bandId: string,
  ) => Promise<Omit<MailWatchAccount, "bandId"> | null>,
): Promise<Record<string, MailWatchAccount>> {
  const updates: MailAccountFetchResult[] = await Promise.all(
    bandIds.map(async (bandId) => {
      try {
        const account = await fetchAccount(bandId);
        return { bandId, ok: true as const, account };
      } catch {
        return { bandId, ok: false as const };
      }
    }),
  );
  return mergeMailByBandRefresh(previous, bandIds, updates);
}
