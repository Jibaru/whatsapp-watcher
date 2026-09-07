import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { runWithLogContext, type Logger } from "@watcher/core";
import type { DynamoDBBatchResponse, DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import type { PublishNoteReceivedService } from "../services/publish-note-received.service.js";

const RAW_PREFIX = "RAW#";

export function makeStreamHandler(service: PublishNoteReceivedService, logger: Logger) {
  return async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
    const batchItemFailures: { itemIdentifier: string }[] = [];

    for (const record of event.Records) {
      try {
        await handleRecord(record, service, logger);
      } catch {
        // Already logged inside the record's trace; here we only rewind the shard to it.
        batchItemFailures.push({ itemIdentifier: record.dynamodb?.SequenceNumber ?? "" });
      }
    }

    return { batchItemFailures };
  };
}

async function handleRecord(
  record: DynamoDBRecord,
  service: PublishNoteReceivedService,
  logger: Logger,
): Promise<void> {
  const image = record.dynamodb?.NewImage;

  if (record.eventName !== "INSERT" || image === undefined) {
    return;
  }

  // The stream carries every entity of the single table; only raw messages start the pipeline.
  const item = unmarshall(image as Record<string, AttributeValue>);

  if (typeof item.sk !== "string" || !item.sk.startsWith(RAW_PREFIX)) {
    return;
  }

  await runWithLogContext(
    {
      correlationId: String(item.correlationId ?? item.messageId ?? "unknown"),
      conversationId: typeof item.conversationId === "string" ? item.conversationId : undefined,
      messageId: typeof item.messageId === "string" ? item.messageId : undefined,
    },
    async () => {
      try {
        await service.execute({ item });
      } catch (error) {
        // Logged here, inside the scope, so the failure carries the note's trace.
        logger.error("outbox_publish_failed", {
          sequenceNumber: record.dynamodb?.SequenceNumber,
          message: error instanceof Error ? error.message : String(error),
        });

        throw error;
      }
    },
  );
}
