import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { Message } from "@gigger/schemas";
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
      access_token: "page-token",
    });
    expect(stub.received.map((r) => r.event)).toEqual([
      "credentials",
      "message",
    ]);
    expect(stub.received[0].payload.object).toEqual({
      type: "credentials",
      access_token: "page-token",
    });
    expect(stub.received[1].payload).toMatchObject({
      type: "send",
      actor: { id: "page-1" },
      target: { id: "psid-1" },
      object: {
        type: "message",
        content: "See you Friday",
        tag: "HUMAN_AGENT",
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
