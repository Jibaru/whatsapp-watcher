import { EventBridgeEnvelopeSchema, runWithLogContext, type Logger } from "@watcher/core";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import type { ProcessNoteService } from "../services/process-note.service.js";

export function makeNoteReceivedHandler(service: ProcessNoteService, logger: Logger) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: { itemIdentifier: string }[] = [];

    for (const record of event.Records) {
      try {
        await handleRecord(record, service);
      } catch (error) {
        logger.error("note_processing_failed", {
          messageId: record.messageId,
          message: error instanceof Error ? error.message : String(error),
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  };
}

async function handleRecord(record: SQSRecord, service: ProcessNoteService): Promise<void> {
  const envelope = EventBridgeEnvelopeSchema.parse(JSON.parse(record.body));
  const note = envelope.detail;

  // Reopens the trace the ingest started, so both lambdas share one correlation id.
  await runWithLogContext(
    {
      correlationId: note.correlationId,
      conversationId: note.conversationId,
      messageId: note.messageId,
    },
    () =>
      service.execute({
        note,
        receiveCount: Number(record.attributes.ApproximateReceiveCount ?? "1"),
      }),
  );
}
