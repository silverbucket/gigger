import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { Message } from "@showday/schemas";
import { Server } from "socket.io";
import { sockethubSender } from "../src/sender";

/** A Sockethub lookalike: service descriptor, schema registry and acks, with only the given platforms loaded. */
function stubSockethub(platforms: string[]) {
  const http = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        name: "sockethub",
        apiVersion: 1,
        endpoints: { socketIO: "/sockethub" },
        platforms: platforms.map((id) => ({ id, apiVersion: 1 })),
      }),
    );
  });
  const io = new Server(http, { path: "/sockethub", transports: ["polling"] });
  const received: { event: string; payload: Record<string, unknown> }[] = [];
  io.on("connection", (socket) => {
    socket.on("schemas", (_fingerprint, ack) =>
      ack({
        apiVersion: 1,
        contexts: {
          as: "https://www.w3.org/ns/activitystreams",
          sockethub: "https://sockethub.org/ns/context/v1.jsonld",
        },
        platforms: platforms.map((id) => ({
          id,
          apiVersion: 1,
          contextUrl: `https://sockethub.org/ns/context/platform/${id}/v1.jsonld`,
          contextVersion: "1",
          schemaVersion: "1",
          types: ["send"],
          schemas: { credentials: {}, messages: {} },
        })),
      }),
    );
    for (const event of ["credentials", "message"])
      socket.on(event, (payload, ack) => {
        received.push({ event, payload });
        ack({});
      });
  });
  return {
    received,
    start: () =>
      new Promise<string>((resolve) =>
        http.listen(0, () =>
          resolve(
            `http://127.0.0.1:${(http.address() as { port: number }).port}`,
          ),
        ),
      ),
    stop: () => io.close(),
  };
}
const message: Message = {
  id: "m1",
  channel: "messenger",
  direction: "out",
  conversation: "c",
  bandId: "b",
  actor: { id: "page-1" },
  target: { id: "psid-1" },
  object: { type: "Note", content: "See you Friday" },
  published: "2025-01-01T00:00:00.000Z",
  tag: "HUMAN_AGENT",
};

test("the Sockethub sender delivers credentials and the message through the real client", async () => {
  const stub = stubSockethub(["messenger"]);
  try {
    await sockethubSender("messenger", await stub.start()).send(message, {
      token: "page-token",
      apiVersion: "v26.0",
    });
    expect(stub.received.map((r) => r.event)).toEqual([
      "credentials",
      "message",
    ]);
    expect(stub.received[0].payload.object).toEqual({
      type: "credentials",
      token: "page-token",
      apiVersion: "v26.0",
    });
    expect(stub.received[1].payload).toMatchObject({
      type: "send",
      actor: { id: "page-1" },
      target: { id: "psid-1" },
      object: {
        type: "message",
        content: "See you Friday",
        humanAgent: true,
      },
    });
  } finally {
    stub.stop();
  }
});

test("a channel whose platform Sockethub has not loaded fails with a clear message", async () => {
  const stub = stubSockethub(["irc"]);
  try {
    expect(
      sockethubSender("instagram", await stub.start()).send(message),
    ).rejects.toThrow("Instagram isn't set up on this server yet.");
    expect(stub.received).toHaveLength(0);
  } finally {
    stub.stop();
  }
});

test("an email reply is addressed to the mailbox with its threading headers and the band's sender name", async () => {
  const stub = stubSockethub(["email"]);
  try {
    await sockethubSender("email", await stub.start()).send(
      {
        ...message,
        channel: "email",
        actor: { id: "band@example.com", name: "The Band" },
        target: { id: "jo@example.com" },
        tag: undefined,
        subject: "Re: Booking for May?",
        inReplyTo: "<jo-2@example.com>",
        references: ["<jo-1@example.com>", "<jo-2@example.com>"],
      },
      {
        from: "band@example.com",
        smtp: {
          host: "smtp.example.com",
          port: 587,
          secure: false,
          username: "band@example.com",
          password: "mail-secret",
        },
      },
    );
    expect(stub.received[0].payload.object).toEqual({
      type: "credentials",
      from: "band@example.com",
      smtp: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        username: "band@example.com",
        password: "mail-secret",
      },
    });
    expect(stub.received[1].payload).toEqual({
      "@context": expect.any(Array),
      type: "send",
      actor: { id: "band@example.com", type: "person", name: "The Band" },
      object: {
        type: "message",
        to: ["jo@example.com"],
        subject: "Re: Booking for May?",
        content: "See you Friday",
        inReplyTo: "<jo-2@example.com>",
        references: ["<jo-1@example.com>", "<jo-2@example.com>"],
      },
    });
    expect(stub.received[1].payload).not.toHaveProperty("target");
  } finally {
    stub.stop();
  }
});
