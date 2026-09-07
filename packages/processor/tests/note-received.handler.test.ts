import { PermanentError, TransientError, type LogFields } from "@watcher/core";
import type { SQSEvent } from "aws-lambda";
import { describe, expect, it } from "bun:test";
import { makeNoteReceivedHandler } from "../src/handlers/note-received.handler.js";
import type { ProcessNoteService } from "../src/services/process-note.service.js";
import { memoryLogger } from "./support/fakes.js";

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
    kind: "text",
    hasMedia: false,
    receivedAt: "2026-09-07T02:22:22.000Z",
  },
};

function sqsEvent(bodies: unknown[]): SQSEvent {
  return {
    Records: bodies.map((body, index) => ({
      messageId: `sqs-${index}`,
      body: JSON.stringify(body),
      attributes: { ApproximateReceiveCount: "1" },
    })),
  } as unknown as SQSEvent;
}

function build(behaviour: () => Promise<unknown> = async () => ({})) {
  const { logger, lines, events } = memoryLogger();
  const service = { execute: behaviour } as unknown as ProcessNoteService;

  return { handler: makeNoteReceivedHandler(service, logger), lines, events };
}

describe("note received handler", () => {
  it("acknowledges a record it processed", async () => {
    const { handler } = build();

    const response = await handler(sqsEvent([envelope]));

    expect(response.batchItemFailures).toEqual([]);
  });

  it("retries a transient failure by reporting it to SQS", async () => {
    const { handler, lines } = build(async () => {
      throw new TransientError("model_unavailable", "throttled");
    });

    const response = await handler(sqsEvent([envelope]));

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "sqs-0" }]);
    expect(lines.find((line: LogFields) => line.event === "note_processing_failed")).toMatchObject({
      retryable: true,
      correlationId: "corr-from-ingest",
    });
  });

  it("acknowledges a permanent failure instead of burying the DLQ", async () => {
    const { handler, lines } = build(async () => {
      throw new PermanentError("unsupported_media", "audio is not supported yet");
    });

    const response = await handler(sqsEvent([envelope]));

    expect(response.batchItemFailures).toEqual([]);
    expect(lines.find((line: LogFields) => line.event === "note_processing_failed")).toMatchObject({
      retryable: false,
      code: "unsupported_media",
    });
  });

  it("retries an unknown failure: it may still be worth another attempt", async () => {
    const { handler } = build(async () => {
      throw new Error("something nobody classified");
    });

    const response = await handler(sqsEvent([envelope]));

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "sqs-0" }]);
  });

  it("drops a body that does not match the contract", async () => {
    const { handler, events } = build();

    const response = await handler(sqsEvent([{ nonsense: true }]));

    expect(response.batchItemFailures).toEqual([]);
    expect(events()).toContain("note_event_unreadable");
  });

  it("keeps the correlation id the ingest started", async () => {
    const { handler, lines } = build(async () => {
      throw new TransientError("boom", "boom");
    });

    await handler(sqsEvent([envelope]));

    expect(lines[0]?.correlationId).toBe("corr-from-ingest");
  });
});
