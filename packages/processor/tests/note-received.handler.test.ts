import { runWithLogContext, type LogFields } from "@watcher/core";
import { JsonLogger } from "@watcher/core";
import type { SQSEvent } from "aws-lambda";
import { describe, expect, it } from "bun:test";
import { makeNoteReceivedHandler } from "../src/handlers/note-received.handler.js";
import { ProcessNoteService } from "../src/services/process-note.service.js";

function collect() {
  const lines: LogFields[] = [];
  const logger = new JsonLogger({ service: "processor" }, (line) => {
    lines.push(JSON.parse(line) as LogFields);
  });

  return { logger, lines };
}

function sqsEvent(bodies: unknown[]): SQSEvent {
  return {
    Records: bodies.map((body, index) => ({
      messageId: `sqs-${index}`,
      body: JSON.stringify(body),
      attributes: { ApproximateReceiveCount: "1" },
    })),
  } as unknown as SQSEvent;
}

const envelope = {
  source: "watcher.ingest",
  "detail-type": "note.received",
  detail: {
    correlationId: "corr-from-ingest",
    conversationId: "conv-1",
    messageId: "wamid.1",
    pk: "USER#+51999000001",
    sk: "RAW#wamid.1",
    from: "+51999000001",
    kind: "image",
    hasMedia: true,
    mediaKey: "inbound/wamid.1.jpg",
    receivedAt: "2026-09-07T02:22:25.185Z",
    duplicate: false,
  },
};

describe("note received handler", () => {
  it("keeps the correlation id the ingest started", async () => {
    const { logger, lines } = collect();
    const handler = makeNoteReceivedHandler(new ProcessNoteService(logger), logger);

    const response = await handler(sqsEvent([envelope]));

    expect(response.batchItemFailures).toEqual([]);
    expect(lines[0]).toMatchObject({
      event: "note_processing_started",
      correlationId: "corr-from-ingest",
      conversationId: "conv-1",
      messageId: "wamid.1",
      mediaKey: "inbound/wamid.1.jpg",
    });
  });

  it("fails only the bad record of a batch", async () => {
    const { logger, lines } = collect();
    const handler = makeNoteReceivedHandler(new ProcessNoteService(logger), logger);

    const response = await handler(sqsEvent([{ nonsense: true }, envelope]));

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "sqs-0" }]);
    expect(lines.some((line) => line.event === "note_processing_started")).toBe(true);
  });

  it("does not leak a context between records", async () => {
    const { logger, lines } = collect();
    const handler = makeNoteReceivedHandler(new ProcessNoteService(logger), logger);
    const second = { ...envelope, detail: { ...envelope.detail, correlationId: "corr-2", messageId: "wamid.2" } };

    await runWithLogContext({ correlationId: "outer" }, () => handler(sqsEvent([envelope, second])));

    expect(lines.map((line) => line.correlationId)).toEqual(["corr-from-ingest", "corr-2"]);
  });
});
