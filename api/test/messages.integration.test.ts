import { expect, test } from "bun:test";
import { conversationId } from "@showday/schemas";

/** Runs against `make up-test`: the real API, Armadietto, the Sockethub container and a Mailpit sink. */
const base = process.env.MAIL_TEST_URL;
const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8025";

test.skipIf(!base)(
  "a reply from the inbox goes through the real Sockethub email platform to the mail sink, threaded under the enquiry",
  async () => {
    const username = `mail-${crypto.randomUUID()}`;
    const password = crypto.randomUUID();
    const signup = await fetch(`${base}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        email: `${username}@example.com`,
        bandName: "Integration Band",
        currency: "EUR",
      }),
    });
    expect(signup.status).toBe(201);
    const { token } = await signup.json();
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const root = `${base}/storage/storage/${username}/showday/`;
    const listing = await fetch(`${root}bands/`, { headers });
    const bandId = Object.keys((await listing.json()).items)[0].replace(
      /\/$/,
      "",
    );
    const peer = `jo-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const conversation = conversationId("email", bandId, peer);
    // Without an account the reply is refused before anything reaches Sockethub.
    const indexed = await fetch(`${root}conversations/index`, {
      method: "PUT",
      headers: { ...headers, "If-None-Match": "*" },
      body: JSON.stringify({
        "@context":
          "http://remotestorage.io/spec/modules/showday/conversations",
        [conversation]: {
          bandId,
          channel: "email",
          peer: { id: peer, name: "Jo" },
          account: "band@example.com",
          lastIn: new Date().toISOString(),
          preview: "Free in May?",
          subject: "Booking for May?",
          messageId: "<jo-2@example.com>",
          references: ["<jo-1@example.com>"],
        },
      }),
    });
    expect(indexed.ok).toBeTrue();
    const reply = (text: string) =>
      fetch(`${base}/api/messages/reply`, {
        method: "POST",
        headers,
        body: JSON.stringify({ username, bandId, conversation, text }),
      });
    expect((await reply("too early")).status).toBe(409);
    const account = {
      username,
      bandId,
      address: `${username}@example.com`,
      name: "Integration Band",
      smtpHost: "mailpit",
      smtpPort: 1025,
      login: username,
      password: "anything",
    };
    const saved = await fetch(`${base}/api/email/account`, {
      method: "PUT",
      headers,
      body: JSON.stringify(account),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      address: account.address,
      smtpHost: "mailpit",
      watching: false,
    });
    const sent = await reply("Yes, May works. What date?");
    expect(await sent.json()).toMatchObject({
      actor: { id: account.address, name: "Integration Band" },
      subject: "Re: Booking for May?",
      inReplyTo: "<jo-2@example.com>",
    });
    expect(sent.status).toBe(200);
    // Mailpit shows what the SMTP server received.
    let found: { ID: string } | undefined;
    for (let attempt = 0; attempt < 50 && !found; attempt++) {
      const search = await fetch(
        `${mailpit}/api/v1/search?${new URLSearchParams({ query: `to:${peer}` })}`,
      );
      found = ((await search.json()).messages as { ID: string }[])[0];
      if (!found) await Bun.sleep(200);
    }
    if (!found) throw new Error("The reply never reached the mail sink");
    const mail = await (
      await fetch(`${mailpit}/api/v1/message/${found.ID}/headers`)
    ).json();
    expect(mail.Subject).toEqual(["Re: Booking for May?"]);
    expect(mail.To).toEqual([peer]);
    expect(mail.From[0]).toContain(account.address);
    expect(mail.From[0]).toContain("Integration Band");
    expect(mail["In-Reply-To"]).toEqual(["<jo-2@example.com>"]);
    expect(mail.References[0]).toBe("<jo-1@example.com> <jo-2@example.com>");
    const body = await (
      await fetch(`${mailpit}/api/v1/message/${found.ID}`)
    ).json();
    expect(body.Text.trim()).toBe("Yes, May works. What date?");
    // The stored copy is marked sent, not failed.
    const months = await (
      await fetch(`${root}conversations/${conversation}/`, { headers })
    ).json();
    const month = Object.keys(months.items)[0];
    const items = await (
      await fetch(`${root}conversations/${conversation}/${month}`, { headers })
    ).json();
    const stored = await (
      await fetch(
        `${root}conversations/${conversation}/${month}${Object.keys(items.items)[0]}`,
        { headers },
      )
    ).json();
    expect(stored.error).toBeUndefined();
    expect(stored.references).toEqual([
      "<jo-1@example.com>",
      "<jo-2@example.com>",
    ]);
    // Removing the account revokes its storage token and stops replies.
    const removed = await fetch(`${base}/api/email/account`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ username, bandId }),
    });
    expect(removed.status).toBe(200);
    expect((await reply("gone")).status).toBe(409);
  },
  60000,
);
