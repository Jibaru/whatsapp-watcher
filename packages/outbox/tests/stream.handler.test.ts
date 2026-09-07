import { JsonLogger, type LogFields, type NoteReceivedDetail } from "@watcher/core";
import type { DynamoDBStreamEvent } from "aws-lambda";
import { describe, expect, it } from "bun:test";
import { makeStreamHandler } from "../src/handlers/stream.handler.js";
import type { NoteEventPublisher } from "../src/repositories/note-event.publisher.js";
import { PublishNoteReceivedService } from "../src/services/publish-note-received.service.js";

class FakePublisher implements NoteEventPublisher {
  readonly published: NoteReceivedDetail[] = [];

  constructor(private readonly fails = false) {}

  async publishNoteReceived(detail: NoteReceivedDetail): Promise<void> {
    if (this.fails) {
      throw new Error("PutEvents rejected the entry");
    }

    this.published.push(detail);
  }
}

function build(options: { fails?: boolean } = {}) {
  const lines: LogFields[] = [];
  const logger = new JsonLogger({ service: "outbox" }, (line) => {
    lines.push(JSON.parse(line) as LogFields);
  });
  const publisher = new FakePublisher(options.fails);
  const handler = makeStreamHandler(new PublishNoteReceivedService(publisher, logger), logger);

  return { handler, publisher, lines };
}

function record(overrides: { eventName?: string; image?: Record<string, unknown> } = {}) {
  const image = overrides.image ?? {
    pk: { S: "USER#+51999000001" },
    sk: { S: "RAW#wamid.1" },
    messageId: { S: "wamid.1" },
    from: { S: "+51999000001" },
    kind: { S: "image" },
    mediaKey: { S: "inbound/wamid.1.jpg" },
    correlationId: { S: "corr-from-ingest" },
    conversationId: { S: "conv-1" },
    receivedAtEpoch: { N: "1788747742" },
  };

  return {
    eventName: overrides.eventName ?? "INSERT",
    dynamodb: { SequenceNumber: "111", NewImage: image },
  };
}

function streamEvent(records: unknown[]): DynamoDBStreamEvent {
  return { Records: records } as unknown as DynamoDBStreamEvent;
}

describe("outbox stream handler", () => {
  it("turns a committed raw item into a note.received detail", async () => {
    const { handler, publisher } = build();

    const response = await handler(streamEvent([record()]));

    expect(response.batchItemFailures).toEqual([]);
    expect(publisher.published[0]).toEqual({
      correlationId: "corr-from-ingest",
      conversationId: "conv-1",
      messageId: "wamid.1",
      pk: "USER#+51999000001",
      sk: "RAW#wamid.1",
      from: "+51999000001",
      kind: "image",
      hasMedia: true,
      mediaKey: "inbound/wamid.1.jpg",
      receivedAt: "2026-09-07T02:22:22.000Z",
    });
  });

  it("ignores anything that is not a new raw message", async () => {
    const { handler, publisher } = build();

    await handler(
      streamEvent([
        record({ eventName: "MODIFY" }),
        record({ image: { pk: { S: "USER#x" }, sk: { S: "NOTE#1" }, messageId: { S: "n1" } } }),
      ]),
    );

    expect(publisher.published).toHaveLength(0);
  });

  it("reports the sequence number so the shard rewinds to it", async () => {
    const { handler, lines } = build({ fails: true });

    const response = await handler(streamEvent([record()]));

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "111" }]);
    expect(lines.some((line) => line.event === "outbox_publish_failed")).toBe(true);
  });

  it("drops an unreadable item instead of blocking the shard forever", async () => {
    const { handler, publisher, lines } = build();

    const response = await handler(
      streamEvent([record({ image: { sk: { S: "RAW#broken" }, pk: { S: "USER#x" } } })]),
    );

    expect(response.batchItemFailures).toEqual([]);
    expect(publisher.published).toHaveLength(0);
    expect(lines.some((line) => line.event === "outbox_item_not_publishable")).toBe(true);
  });

  it("keeps the correlation id the ingest stored on the item", async () => {
    const { handler, lines } = build({ fails: true });

    await handler(streamEvent([record()]));

    expect(lines.find((line) => line.event === "outbox_publish_failed")).toMatchObject({
      correlationId: "corr-from-ingest",
      conversationId: "conv-1",
      messageId: "wamid.1",
    });
  });
});
